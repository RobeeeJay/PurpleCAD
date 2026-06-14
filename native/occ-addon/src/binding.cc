#include <napi.h>

// ── Primitives ───────────────────────────────────────────────────────────
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepPrimAPI_MakePrism.hxx>

// ── Wire / face builders (extrude) ──────────────────────────────────────
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_Transform.hxx>

// ── Boolean ops ──────────────────────────────────────────────────────────
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>

// ── Chamfer / fillet ────────────────────────────────────────────────────
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <ChFi3d_FilletShape.hxx>

// ── Meshing + tessellation access ────────────────────────────────────────
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>

// ── Topology traversal ──────────────────────────────────────────────────
#include <TopExp_Explorer.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopLoc_Location.hxx>

// ── Face-normal + edge-distance helpers ─────────────────────────────────
#include <BRepAdaptor_Surface.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <Extrema_ExtFlag.hxx>
#include <Extrema_ExtAlgo.hxx>

// ── Math types ───────────────────────────────────────────────────────────
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Trsf.hxx>

// ── STEP export ─────────────────────────────────────────────────────────
#include <STEPControl_Writer.hxx>
#include <STEPControl_StepModelType.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

// ════════════════════════════════════════════════════════════════════════
// Shape store
// ════════════════════════════════════════════════════════════════════════

static std::unordered_map<int, TopoDS_Shape> g_shapes;
static std::atomic<int> g_nextId{1};
static std::mutex g_mu;

static int StoreShape(const TopoDS_Shape& s) {
  int id = g_nextId.fetch_add(1, std::memory_order_relaxed);
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes[id] = s;
  return id;
}

static TopoDS_Shape FetchShape(int id) {
  std::lock_guard<std::mutex> lk(g_mu);
  auto it = g_shapes.find(id);
  if (it == g_shapes.end())
    throw std::runtime_error("unknown shape id: " + std::to_string(id));
  return it->second;
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

static double GetDouble(const Napi::Value& v, double fallback = 0.0) {
  return v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : fallback;
}

// Build the T·Rz·Ry·Rx compound transform used by transformShape in
// operations.js.  gp_Trsf::Multiply(T) means this = this * T, so to get
// T·Rz·Ry·Rx we set the translation first, then multiply each rotation.
static gp_Trsf BuildTransform(double tx, double ty, double tz,
                               double rx, double ry, double rz,
                               double scale = 1.0) {
  gp_Trsf trsf;
  if (std::abs(scale - 1.0) > 1e-12) {
    trsf.SetScaleFactor(scale);
  }
  if (tx != 0 || ty != 0 || tz != 0) {
    gp_Trsf t;
    t.SetTranslation(gp_Vec(tx, ty, tz));
    trsf.Multiply(t);
  }
  // Apply rotations X, then Y, then Z so the composed rotation is Rx·Ry·Rz,
  // matching THREE.Euler's default 'XYZ' order — which is how every
  // item.rotation in the app is expressed.  The previous Z,Y,X order gave
  // Rz·Ry·Rx, which only coincides for single-axis rotations; a compound
  // gizmo rotation came out in a different orientation, so a boolean on a
  // gizmo-rotated object appeared to reset its orientation.
  if (rx != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), rx);
    trsf.Multiply(r);
  }
  if (ry != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), ry);
    trsf.Multiply(r);
  }
  if (rz != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rz);
    trsf.Multiply(r);
  }
  return trsf;
}

// Tessellate a shape and populate position/index vectors.
// Mirrors tessellate.js logic exactly (same deflection formula, same
// REVERSED-orientation winding flip).
static void TessellateInto(const TopoDS_Shape& shape, double linearDeflection,
                            std::vector<float>& positions,
                            std::vector<uint32_t>& indices) {
  BRepMesh_IncrementalMesh mesher(shape, linearDeflection, false, 0.3, false);

  TopExp_Explorer explorer(shape, TopAbs_FACE);
  for (; explorer.More(); explorer.Next()) {
    TopoDS_Face face = TopoDS::Face(explorer.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;

    gp_Trsf trsf;
    if (!loc.IsIdentity()) trsf = loc.Transformation();
    bool reversed = (face.Orientation() == TopAbs_REVERSED);

    auto baseVert = static_cast<uint32_t>(positions.size() / 3);
    for (int i = 1; i <= tri->NbNodes(); i++) {
      gp_Pnt p = tri->Node(i).Transformed(trsf);
      positions.push_back(static_cast<float>(p.X()));
      positions.push_back(static_cast<float>(p.Y()));
      positions.push_back(static_cast<float>(p.Z()));
    }
    for (int i = 1; i <= tri->NbTriangles(); i++) {
      Standard_Integer n1, n2, n3;
      tri->Triangle(i).Get(n1, n2, n3);
      n1--; n2--; n3--;
      if (reversed) std::swap(n2, n3);
      indices.push_back(baseVert + static_cast<uint32_t>(n1));
      indices.push_back(baseVert + static_cast<uint32_t>(n2));
      indices.push_back(baseVert + static_cast<uint32_t>(n3));
    }
  }
}

// ── Chamfer / fillet edge-matching helpers ───────────────────────────────

// Returns the rounded endpoint-pair key for deduplication.
static std::string EdgeKey(const TopoDS_Edge& edge) {
  std::vector<std::string> pts;
  TopExp_Explorer vexp(edge, TopAbs_VERTEX);
  for (; vexp.More(); vexp.Next()) {
    TopoDS_Vertex v = TopoDS::Vertex(vexp.Current());
    gp_Pnt p = BRep_Tool::Pnt(v);
    char buf[80];
    snprintf(buf, sizeof(buf), "%.0f,%.0f,%.0f",
             std::round(p.X() * 1000), std::round(p.Y() * 1000),
             std::round(p.Z() * 1000));
    pts.push_back(buf);
  }
  std::sort(pts.begin(), pts.end());
  std::string key;
  for (const auto& s : pts) { if (!key.empty()) key += "|"; key += s; }
  return key;
}

// Mirrors edgeMatchesEndpoints() from operations.js.
// Returns true when the edge's vertices (or, for curved edges, the edge
// curve itself) pass through both posA and posB.
struct Vec3d { double x, y, z; };

static bool EdgeMatchesEndpoints(const TopoDS_Edge& edge,
                                  const Vec3d& posA, const Vec3d& posB,
                                  double eps = 1e-3) {
  std::vector<Vec3d> pts;
  TopExp_Explorer vexp(edge, TopAbs_VERTEX);
  for (; vexp.More(); vexp.Next()) {
    TopoDS_Vertex v = TopoDS::Vertex(vexp.Current());
    gp_Pnt p = BRep_Tool::Pnt(v);
    pts.push_back({p.X(), p.Y(), p.Z()});
  }
  auto close = [eps](const Vec3d& a, const Vec3d& b) {
    return std::abs(a.x - b.x) < eps && std::abs(a.y - b.y) < eps &&
           std::abs(a.z - b.z) < eps;
  };
  if (pts.size() >= 2 &&
      ((close(pts[0], posA) && close(pts[1], posB)) ||
       (close(pts[0], posB) && close(pts[1], posA)))) {
    return true;
  }
  // Curved-edge fallback: check that both points lie ON the edge curve.
  const double curveEps = 0.05;
  auto pointOnEdge = [&](const Vec3d& p) {
    gp_Pnt pnt(p.x, p.y, p.z);
    BRepBuilderAPI_MakeVertex vMk(pnt);
    BRepExtrema_DistShapeShape dist(vMk.Vertex(), edge,
                                    Extrema_ExtFlag_MIN, Extrema_ExtAlgo_Grad);
    dist.Perform();
    return dist.IsDone() && dist.NbSolution() >= 1 && dist.Value() < curveEps;
  };
  return pointOnEdge(posA) && pointOnEdge(posB);
}

// Compute the outward face normal at the UV midpoint.
// Mirrors computeFaceNormal() from operations.js.
struct FaceNormal { double x, y, z; bool valid; };

static FaceNormal ComputeFaceNormal(const TopoDS_Face& face) {
  try {
    BRepAdaptor_Surface adaptor(face, false);
    double u = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2.0;
    double v = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2.0;
    gp_Pnt pnt;
    gp_Vec du, dv;
    adaptor.D1(u, v, pnt, du, dv);
    gp_Vec cross = du.Crossed(dv);
    double mag = cross.Magnitude();
    if (mag < 1e-9) return {0, 0, 0, false};
    bool reversed = (face.Orientation() == TopAbs_REVERSED);
    double sign = reversed ? -1.0 : 1.0;
    return {cross.X() / mag * sign, cross.Y() / mag * sign,
            cross.Z() / mag * sign, true};
  } catch (...) {
    return {0, 0, 0, false};
  }
}

struct EdgeFaceSpec {
  // Edge endpoints (for edge selection), plus an optional resize-invariant
  // identifier: the two adjacent face normals (n1, n2).  When present these
  // are matched in preference to the endpoints, so a chamfer/fillet follows
  // its edge through a parametric resize that moves the endpoint coordinates.
  struct EdgeEp {
    double ax, ay, az, bx, by, bz;
    bool hasNormals;
    double n1x, n1y, n1z, n2x, n2y, n2z;
  };
  // Face normal + optional centroid (for face selection)
  struct FaceNorm {
    double nx, ny, nz;
    bool hasCentroid;
    double cx, cy, cz;
  };
  std::vector<EdgeEp> edges;
  std::vector<FaceNorm> faces;
};

// Read a [x,y,z] array (or {x,y,z} object) into three doubles.  Returns
// false if the value is missing / not a 3-vector.
static bool ReadVec3(const Napi::Value& v, double& x, double& y, double& z) {
  if (v.IsArray()) {
    Napi::Array a = v.As<Napi::Array>();
    if (a.Length() < 3) return false;
    x = GetDouble(a.Get(uint32_t(0)));
    y = GetDouble(a.Get(uint32_t(1)));
    z = GetDouble(a.Get(uint32_t(2)));
    return true;
  }
  return false;
}

// Parse the edges/faces arrays passed from JS.
static EdgeFaceSpec ParseSubGeo(const Napi::Object& subGeo) {
  EdgeFaceSpec spec;
  if (subGeo.Has("edges")) {
    Napi::Array arr = subGeo.Get("edges").As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Object e = arr.Get(i).As<Napi::Object>();
      EdgeFaceSpec::EdgeEp ep{
        GetDouble(e.Get("ax")), GetDouble(e.Get("ay")), GetDouble(e.Get("az")),
        GetDouble(e.Get("bx")), GetDouble(e.Get("by")), GetDouble(e.Get("bz")),
        false, 0, 0, 0, 0, 0, 0
      };
      if (e.Has("n1") && e.Has("n2")) {
        ep.hasNormals =
          ReadVec3(e.Get("n1"), ep.n1x, ep.n1y, ep.n1z) &&
          ReadVec3(e.Get("n2"), ep.n2x, ep.n2y, ep.n2z);
      }
      spec.edges.push_back(ep);
    }
  }
  if (subGeo.Has("faces")) {
    Napi::Array arr = subGeo.Get("faces").As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); i++) {
      Napi::Object f = arr.Get(i).As<Napi::Object>();
      bool hasCx = f.Has("cx") && !f.Get("cx").IsNull() && !f.Get("cx").IsUndefined();
      spec.faces.push_back({
        GetDouble(f.Get("nx")), GetDouble(f.Get("ny")), GetDouble(f.Get("nz")),
        hasCx,
        hasCx ? GetDouble(f.Get("cx")) : 0.0,
        hasCx ? GetDouble(f.Get("cy")) : 0.0,
        hasCx ? GetDouble(f.Get("cz")) : 0.0
      });
    }
  }
  return spec;
}

// The (up to two) planar face normals adjacent to an edge.  These are
// resize-invariant for prismatic geometry, so they uniquely and stably name
// an edge across a parametric resize that moves its endpoints.
static std::vector<FaceNormal> EdgeAdjacentNormals(
    const TopoDS_Edge& edge,
    const TopTools_IndexedDataMapOfShapeListOfShape& edgeFaceMap) {
  std::vector<FaceNormal> normals;
  if (!edgeFaceMap.Contains(edge)) return normals;
  const TopTools_ListOfShape& faces = edgeFaceMap.FindFromKey(edge);
  // OCC 8.0.0 removed the legacy TopTools_ListIteratorOfListOfShape header;
  // iterate the list (an NCollection_List) directly.
  for (const TopoDS_Shape& f : faces) {
    FaceNormal n = ComputeFaceNormal(TopoDS::Face(f));
    if (n.valid) normals.push_back(n);
  }
  return normals;
}

// Does an edge's adjacent-normal set contain both of the spec's stored
// normals (order-independent)?  Normals are unit vectors, so an absolute eps
// is scale-free.
static bool NormalSetMatches(const std::vector<FaceNormal>& edgeNormals,
                             const EdgeFaceSpec::EdgeEp& ep,
                             double eps = 0.05) {
  auto present = [&](double x, double y, double z) {
    for (const auto& n : edgeNormals)
      if (std::abs(n.x - x) < eps && std::abs(n.y - y) < eps &&
          std::abs(n.z - z) < eps)
        return true;
    return false;
  };
  return present(ep.n1x, ep.n1y, ep.n1z) && present(ep.n2x, ep.n2y, ep.n2z);
}

// Match a shape edge against a stored edge spec: by adjacent-face-normals
// when the spec carries them (resize-invariant), otherwise by endpoint
// coordinates (legacy chamfers saved before topological naming existed).
static bool EdgeMatchesSpec(
    const TopoDS_Edge& edge, const EdgeFaceSpec::EdgeEp& ep,
    const TopTools_IndexedDataMapOfShapeListOfShape& edgeFaceMap) {
  if (ep.hasNormals)
    return NormalSetMatches(EdgeAdjacentNormals(edge, edgeFaceMap), ep);
  return EdgeMatchesEndpoints(edge, {ep.ax, ep.ay, ep.az},
                              {ep.bx, ep.by, ep.bz});
}

// One selected edge plus an adjacent reference face (used only by the angle
// chamfer's AddDA; null for fillets / symmetric chamfers).
struct SelectedEdge {
  TopoDS_Edge edge;
  TopoDS_Face refFace;
};

// Resolve every edge a subGeo spec selects on a shape.  Edges are matched
// topologically (adjacent face normals) when the spec carries them — so a
// selection survives a parametric resize — falling back to endpoint
// coordinates for legacy specs.  Faces match by normal, with a stored
// centroid used only to pick the nearest among same-normal faces (a
// tie-break, not a hard cutoff, so a resized face still matches).  Shared by
// ChamferShape and FilletShape so the two never drift apart.
static std::vector<SelectedEdge> SelectSubGeoEdges(const TopoDS_Shape& shape,
                                                   const EdgeFaceSpec& spec) {
  std::vector<SelectedEdge> out;
  std::set<std::string> addedKeys;

  TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

  auto faceTouchingEdge = [&](const TopoDS_Edge& edge) -> TopoDS_Face {
    if (edgeFaceMap.Contains(edge)) {
      const TopTools_ListOfShape& fs = edgeFaceMap.FindFromKey(edge);
      if (!fs.IsEmpty()) return TopoDS::Face(fs.First());
    }
    return TopoDS_Face();
  };

  auto addEdge = [&](const TopoDS_Edge& edge, const TopoDS_Face& refFace) {
    std::string key = EdgeKey(edge);
    if (addedKeys.count(key)) return;
    out.push_back({edge, refFace});
    addedKeys.insert(key);
  };

  if (!spec.edges.empty()) {
    TopExp_Explorer eexp(shape, TopAbs_EDGE);
    for (; eexp.More(); eexp.Next()) {
      TopoDS_Edge edge = TopoDS::Edge(eexp.Current());
      for (const auto& ep : spec.edges) {
        if (EdgeMatchesSpec(edge, ep, edgeFaceMap)) {
          addEdge(edge, faceTouchingEdge(edge));
          break;
        }
      }
    }
  }

  const double eps = 0.05;
  for (const auto& req : spec.faces) {
    TopoDS_Face best;
    double bestDist = 1e300;
    bool found = false;
    std::vector<TopoDS_Face> allNormalMatches;
    TopExp_Explorer fexp(shape, TopAbs_FACE);
    for (; fexp.More(); fexp.Next()) {
      TopoDS_Face face = TopoDS::Face(fexp.Current());
      auto n = ComputeFaceNormal(face);
      if (!n.valid) continue;
      if (std::abs(req.nx - n.x) >= eps || std::abs(req.ny - n.y) >= eps ||
          std::abs(req.nz - n.z) >= eps)
        continue;
      if (!req.hasCentroid) {
        allNormalMatches.push_back(face);
        continue;
      }
      gp_Pnt pnt(req.cx, req.cy, req.cz);
      BRepBuilderAPI_MakeVertex vMk(pnt);
      BRepExtrema_DistShapeShape dist(vMk.Vertex(), face, Extrema_ExtFlag_MIN,
                                      Extrema_ExtAlgo_Grad);
      dist.Perform();
      double d = (dist.IsDone() && dist.NbSolution() >= 1) ? dist.Value() : 1e299;
      if (!found || d < bestDist) {
        best = face;
        bestDist = d;
        found = true;
      }
    }
    std::vector<TopoDS_Face> chosen;
    if (req.hasCentroid) {
      if (found) chosen.push_back(best);
    } else {
      chosen = allNormalMatches;
    }
    for (const auto& face : chosen) {
      TopExp_Explorer eexp(face, TopAbs_EDGE);
      for (; eexp.More(); eexp.Next())
        addEdge(TopoDS::Edge(eexp.Current()), face);
    }
  }
  return out;
}

// Resolve the actual faces a subGeo spec selects — the face-only analogue of
// SelectSubGeoEdges (which explodes matched faces into their edges for
// chamfer/fillet).  Matches by normal, using the stored centroid only as a
// nearest tie-break among same-normal faces so a resized face still matches.
// Used by push/pull, which needs the TopoDS_Face itself to sweep a prism.
static std::vector<TopoDS_Face> SelectSubGeoFaces(const TopoDS_Shape& shape,
                                                  const EdgeFaceSpec& spec) {
  std::vector<TopoDS_Face> out;
  const double eps = 0.05;
  for (const auto& req : spec.faces) {
    TopoDS_Face best;
    double bestDist = 1e300;
    bool found = false;
    std::vector<TopoDS_Face> allNormalMatches;
    TopExp_Explorer fexp(shape, TopAbs_FACE);
    for (; fexp.More(); fexp.Next()) {
      TopoDS_Face face = TopoDS::Face(fexp.Current());
      auto n = ComputeFaceNormal(face);
      if (!n.valid) continue;
      if (std::abs(req.nx - n.x) >= eps || std::abs(req.ny - n.y) >= eps ||
          std::abs(req.nz - n.z) >= eps)
        continue;
      if (!req.hasCentroid) {
        allNormalMatches.push_back(face);
        continue;
      }
      gp_Pnt pnt(req.cx, req.cy, req.cz);
      BRepBuilderAPI_MakeVertex vMk(pnt);
      BRepExtrema_DistShapeShape dist(vMk.Vertex(), face, Extrema_ExtFlag_MIN,
                                      Extrema_ExtAlgo_Grad);
      dist.Perform();
      double d = (dist.IsDone() && dist.NbSolution() >= 1) ? dist.Value() : 1e299;
      if (!found || d < bestDist) {
        best = face;
        bestDist = d;
        found = true;
      }
    }
    if (req.hasCentroid) {
      if (found) out.push_back(best);
    } else {
      for (const auto& f : allNormalMatches) out.push_back(f);
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — primitives
// ════════════════════════════════════════════════════════════════════════

// ping() — smoke test that the addon loaded.
Napi::Number Ping(const Napi::CallbackInfo& info) {
  // Return "pong" — kept as number for backward compat with old test;
  // we return 1 to signal "ok" since the test now just checks ping() loads.
  (void)info;
  return Napi::Number::New(info.Env(), 1);
}

// ping() → "pong" string version (kept for backward compat test)
Napi::String PingStr(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "pong");
}

// makeBox(x1, y1, z1, x2, y2, z2) → shapeId
// Matches primitives.js makeCube(): p1=(-1,-1,-1) p2=(1,1,1) for the
// default 2×2×2 cube; callers pass the desired corner coordinates.
Napi::Number MakeBox(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    double x1 = GetDouble(info[0]), y1 = GetDouble(info[1]), z1 = GetDouble(info[2]);
    double x2 = GetDouble(info[3]), y2 = GetDouble(info[4]), z2 = GetDouble(info[5]);
    BRepPrimAPI_MakeBox mk(gp_Pnt(x1, y1, z1), gp_Pnt(x2, y2, z2));
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// makeSphere(radius) → shapeId
Napi::Number MakeSphere(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    double r = GetDouble(info[0], 1.5);
    BRepPrimAPI_MakeSphere mk(r);
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// makeCylinder(originY, radius, height) → shapeId
// Axis = +Y to match three.js CylinderGeometry and primitives.js.
// originY = -height/2 so the cylinder is centred on the origin.
Napi::Number MakeCylinder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    double originY = GetDouble(info[0], -1.0);
    double radius  = GetDouble(info[1], 1.0);
    double height  = GetDouble(info[2], 2.0);
    gp_Ax2 ax(gp_Pnt(0, originY, 0), gp_Dir(0, 1, 0));
    BRepPrimAPI_MakeCylinder mk(ax, radius, height);
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// makeTorus(majorR, minorR) → shapeId
// Axis = +Y (matches primitives.js makeTorus which uses ax2YUp).
Napi::Number MakeTorus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    double majorR = GetDouble(info[0], 1.0);
    double minorR = GetDouble(info[1], 0.4);
    gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
    BRepPrimAPI_MakeTorus mk(ax, majorR, minorR);
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// makeExtrude(outerPts, holes, centroidX, centroidY, depth) → shapeId
// outerPts: Float64Array [x0,y0, x1,y1, ...] already wound CCW (caller
//   must ensure — matches makeWireFromPolygon wantCcw=true in primitives.js).
// holes: Array of Float64Array, each wound CW (wantCcw=false).
// centroid: subtracted from each point so the sketch origin is at (0,0).
// depth: extrusion along +Z (may be negative — handled by the prism direction).
Napi::Number MakeExtrude(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    Napi::Float64Array outer = info[0].As<Napi::Float64Array>();
    Napi::Array holes        = info[1].As<Napi::Array>();
    double cx                = GetDouble(info[2]);
    double cy                = GetDouble(info[3]);
    double depth             = GetDouble(info[4]);

    // Build outer wire
    BRepBuilderAPI_MakeWire wireMk;
    size_t nOuter = outer.ElementLength() / 2;
    for (size_t i = 0; i < nOuter; i++) {
      size_t j = (i + 1) % nOuter;
      gp_Pnt p1(outer[i*2]   - cx, outer[i*2+1]   - cy, 0);
      gp_Pnt p2(outer[j*2]   - cx, outer[j*2+1]   - cy, 0);
      BRepBuilderAPI_MakeEdge edgeMk(p1, p2);
      wireMk.Add(edgeMk.Edge());
    }
    if (!wireMk.IsDone())
      throw std::runtime_error("outer wire builder failed");

    BRepBuilderAPI_MakeFace faceMk(wireMk.Wire(), true);
    if (!faceMk.IsDone())
      throw std::runtime_error("face builder failed (outer wire)");
    TopoDS_Face face = faceMk.Face();

    // Add holes
    for (uint32_t h = 0; h < holes.Length(); h++) {
      Napi::Float64Array hpts = holes.Get(h).As<Napi::Float64Array>();
      size_t nHole = hpts.ElementLength() / 2;
      if (nHole < 3) continue;
      BRepBuilderAPI_MakeWire holeMk;
      for (size_t i = 0; i < nHole; i++) {
        size_t j = (i + 1) % nHole;
        gp_Pnt p1(hpts[i*2] - cx, hpts[i*2+1] - cy, 0);
        gp_Pnt p2(hpts[j*2] - cx, hpts[j*2+1] - cy, 0);
        BRepBuilderAPI_MakeEdge edgeMk(p1, p2);
        holeMk.Add(edgeMk.Edge());
      }
      if (!holeMk.IsDone()) continue;
      BRepBuilderAPI_MakeFace faceWithHole(face, holeMk.Wire());
      if (faceWithHole.IsDone()) face = faceWithHole.Face();
    }

    // Prism along +Z by depth (matches primitives.js: base at z=0, top at z=depth)
    gp_Vec dir(0, 0, depth);
    BRepPrimAPI_MakePrism prismMk(face, dir, false, true);
    if (!prismMk.IsDone())
      throw std::runtime_error("prism builder failed");
    return Napi::Number::New(env, StoreShape(prismMk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — transforms
// ════════════════════════════════════════════════════════════════════════

// transformShape(id, tx, ty, tz, rx, ry, rz) → newShapeId
// Applies T·Rz·Ry·Rx, matching operations.js transformShape().
Napi::Number TransformShape(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id    = info[0].As<Napi::Number>().Int32Value();
    double tx = GetDouble(info[1]), ty = GetDouble(info[2]), tz = GetDouble(info[3]);
    double rx = GetDouble(info[4]), ry = GetDouble(info[5]), rz = GetDouble(info[6]);
    TopoDS_Shape shape = FetchShape(id);
    gp_Trsf trsf = BuildTransform(tx, ty, tz, rx, ry, rz);
    BRepBuilderAPI_Transform mk(shape, trsf, true);
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// scaleShape(id, factor) → newShapeId
Napi::Number ScaleShape(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id       = info[0].As<Napi::Number>().Int32Value();
    double scale = GetDouble(info[1], 1.0);
    TopoDS_Shape shape = FetchShape(id);
    gp_Trsf trsf;
    trsf.SetScaleFactor(scale);
    BRepBuilderAPI_Transform mk(shape, trsf, true);
    return Napi::Number::New(env, StoreShape(mk.Shape()));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — boolean operations
// ════════════════════════════════════════════════════════════════════════

// booleanOp(shapeIds: number[], operation: "union"|"difference"|"intersection")
// → newShapeId
Napi::Number BooleanOp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    Napi::Array ids = info[0].As<Napi::Array>();
    std::string op  = info[1].As<Napi::String>().Utf8Value();
    if (ids.Length() < 2)
      throw std::runtime_error("booleanOp requires at least 2 shape ids");

    // A small fuzzy value lets the fuse weld hairline gaps where independently
    // built solids touch (e.g. several extruded parts that abut) — each prism is
    // built in its own centroid-local frame and transformed back, so shared
    // faces aren't bit-for-bit coincident.  Value is in scene units (1 = 10 mm),
    // i.e. ~1e-4 mm: far above float round-off, far below any real feature.
    const Standard_Real kFuzzy = 1.0e-5;

    TopoDS_Shape result = FetchShape(ids.Get(0u).As<Napi::Number>().Int32Value());
    for (uint32_t i = 1; i < ids.Length(); i++) {
      TopoDS_Shape tool = FetchShape(ids.Get(i).As<Napi::Number>().Int32Value());
      if (op == "union") {
        BRepAlgoAPI_Fuse fuse(result, tool);
        fuse.SetFuzzyValue(kFuzzy);
        fuse.Build();
        result = fuse.Shape();
      } else if (op == "difference") {
        BRepAlgoAPI_Cut cut(result, tool);
        cut.Build();
        result = cut.Shape();
      } else if (op == "intersection") {
        BRepAlgoAPI_Common common(result, tool);
        common.Build();
        result = common.Shape();
      } else {
        throw std::runtime_error("unknown boolean operation: " + op);
      }
    }

    // After fusing, the seams where the parts met are left as pairs of coplanar
    // faces split by sliver edges — exactly what a later chamfer/fillet chokes
    // on ("geometry rejected the operation").  Unify the same-domain faces/edges
    // so the body has clean single faces.  Only for union (the case that creates
    // those internal seams); fall back to the raw result if unification rejects.
    if (op == "union") {
      try {
        ShapeUpgrade_UnifySameDomain unifier(
          result, Standard_True, Standard_True, Standard_True);
        unifier.Build();
        result = unifier.Shape();
      } catch (const std::exception&) {
        // keep the un-unified fuse result
      }
    }
    return Napi::Number::New(env, StoreShape(result));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — chamfer / fillet
// ════════════════════════════════════════════════════════════════════════

// chamferShape(id, subGeo, amount, angleRad) → newShapeId
// subGeo: { edges?: [{ax,ay,az,bx,by,bz}], faces?: [{nx,ny,nz,cx?,cy?,cz?}] }
// Mirrors chamferShapeBy() from operations.js exactly.
Napi::Number ChamferShape(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id          = info[0].As<Napi::Number>().Int32Value();
    Napi::Object sg = info[1].As<Napi::Object>();
    double amount   = GetDouble(info[2], 0.05);
    bool useAngle   = !info[3].IsNull() && !info[3].IsUndefined() &&
                      info[3].IsNumber() && std::isfinite(GetDouble(info[3]));
    double angleRad = useAngle ? GetDouble(info[3]) : 0.0;

    TopoDS_Shape shape = FetchShape(id);
    EdgeFaceSpec spec  = ParseSubGeo(sg);
    if (spec.edges.empty() && spec.faces.empty()) {
      // Nothing to do — return the same shape
      return Napi::Number::New(env, StoreShape(shape));
    }

    try {
      BRepFilletAPI_MakeChamfer mk(shape);
      auto selected = SelectSubGeoEdges(shape, spec);
      for (const auto& se : selected) {
        if (useAngle && !se.refFace.IsNull()) {
          mk.AddDA(amount, angleRad, se.edge, se.refFace);
        } else {
          mk.Add(amount, se.edge);
        }
      }

      // 0 = sentinel "no edges matched" — bridge throws a descriptive error.
      if (selected.empty()) return Napi::Number::New(env, 0);
      mk.Build();
      if (!mk.IsDone())
        throw std::runtime_error("chamfer computation failed (geometry rejected the operation)");
      return Napi::Number::New(env, StoreShape(mk.Shape()));
    } catch (const std::exception& e) {
      throw std::runtime_error(
        std::string("Chamfer failed — try a smaller distance or a different "
                    "edge / face (") + e.what() + ")");
    }
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// filletShape(id, subGeo, radius) → newShapeId
// Mirrors filletShapeBy() from operations.js.
Napi::Number FilletShape(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id        = info[0].As<Napi::Number>().Int32Value();
    Napi::Object sg = info[1].As<Napi::Object>();
    double radius = GetDouble(info[2], 0.05);

    TopoDS_Shape shape = FetchShape(id);
    EdgeFaceSpec spec  = ParseSubGeo(sg);
    if (spec.edges.empty() && spec.faces.empty()) {
      return Napi::Number::New(env, StoreShape(shape));
    }

    try {
      BRepFilletAPI_MakeFillet mk(shape, ChFi3d_Rational);
      auto selected = SelectSubGeoEdges(shape, spec);
      for (const auto& se : selected) mk.Add(radius, se.edge);

      if (selected.empty()) return Napi::Number::New(env, 0);
      mk.Build();
      if (!mk.IsDone())
        throw std::runtime_error("fillet computation failed (geometry rejected the operation)");
      return Napi::Number::New(env, StoreShape(mk.Shape()));
    } catch (const std::exception& e) {
      throw std::runtime_error(
        std::string("Fillet failed — try a smaller radius or a different "
                    "edge / face (") + e.what() + ")");
    }
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// pushPullFaces(id, subGeo, distance) → newShapeId
// Moves each selected planar face along its OUTWARD normal by `distance`
// (signed: +pull grows the solid, -push shrinks it).  Each face is swept into
// a feature prism that is fused (pull) or cut (push) from the solid; a final
// ShapeUpgrade_UnifySameDomain welds the resulting coplanar side-wall seams so
// the body stays a clean single solid — the same fuzzy-fuse + unify recipe the
// union path uses to keep abutting geometry valid.
//
// subGeo: { faces?: [{nx,ny,nz,cx?,cy?,cz?}] }.  Edges are ignored — push/pull
// operates on faces only.
Napi::Number PushPullFaces(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id          = info[0].As<Napi::Number>().Int32Value();
    Napi::Object sg = info[1].As<Napi::Object>();
    double distance = GetDouble(info[2], 0.0);

    TopoDS_Shape shape = FetchShape(id);
    EdgeFaceSpec spec  = ParseSubGeo(sg);
    // No faces, or a zero move — nothing to do; hand back the input unchanged.
    if (spec.faces.empty() || std::abs(distance) < 1e-9)
      return Napi::Number::New(env, StoreShape(shape));

    auto faces = SelectSubGeoFaces(shape, spec);
    // 0 = sentinel "no faces matched" — the JS bridge turns this into a
    // descriptive error (same convention as chamfer/fillet).
    if (faces.empty()) return Napi::Number::New(env, 0);

    const bool pull = distance > 0;
    const Standard_Real kFuzzy = 1.0e-5;
    TopoDS_Shape result = shape;
    try {
      for (const auto& face : faces) {
        FaceNormal n = ComputeFaceNormal(face);
        if (!n.valid) continue;
        // Signed sweep: outward (pull) or inward (push) by |distance|.  The
        // prism is built from the ORIGINAL face geometry; since distinct faces
        // don't overlap, fusing / cutting them onto the running result in any
        // order yields the same solid.
        gp_Vec vec(n.x * distance, n.y * distance, n.z * distance);
        if (vec.Magnitude() < 1e-12) continue;
        BRepPrimAPI_MakePrism prismMk(face, vec, Standard_False, Standard_True);
        prismMk.Build();
        if (!prismMk.IsDone()) continue;
        TopoDS_Shape prism = prismMk.Shape();
        if (pull) {
          BRepAlgoAPI_Fuse fuse(result, prism);
          fuse.SetFuzzyValue(kFuzzy);
          fuse.Build();
          if (!fuse.IsDone()) throw std::runtime_error("fuse rejected the prism");
          result = fuse.Shape();
        } else {
          BRepAlgoAPI_Cut cut(result, prism);
          cut.SetFuzzyValue(kFuzzy);
          cut.Build();
          if (!cut.IsDone()) throw std::runtime_error("cut rejected the prism");
          result = cut.Shape();
        }
      }
    } catch (const std::exception& e) {
      throw std::runtime_error(
        std::string("Push/pull failed — try a smaller distance or a different "
                    "face (") + e.what() + ")");
    }

    // Weld coplanar seams the fuse/cut left behind.  Fall back to the raw
    // boolean result if unification rejects it (matches the union path).
    try {
      ShapeUpgrade_UnifySameDomain unifier(
        result, Standard_True, Standard_True, Standard_True);
      unifier.Build();
      result = unifier.Shape();
    } catch (const std::exception&) {
      // keep the un-unified result
    }
    return Napi::Number::New(env, StoreShape(result));
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// enrichSubGeo(shapeId, subGeo) → subGeo with each edge's two adjacent face
// normals resolved (n1, n2).  Called once at chamfer/fillet creation — when
// the stored endpoint coordinates still line up with the (pre-resize) shape —
// so later regens can re-find the edge by its resize-invariant normals after
// a parametric resize moves the endpoints.  Edges that already carry normals
// pass through untouched; faces are returned unchanged.
Napi::Value EnrichSubGeo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id = info[0].As<Napi::Number>().Int32Value();
    Napi::Object sg = info[1].As<Napi::Object>();
    TopoDS_Shape shape = FetchShape(id);
    EdgeFaceSpec spec = ParseSubGeo(sg);

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

    Napi::Array outEdges = Napi::Array::New(env, spec.edges.size());
    for (size_t i = 0; i < spec.edges.size(); i++) {
      const auto& ep = spec.edges[i];
      Napi::Object eo = Napi::Object::New(env);
      eo.Set("ax", ep.ax); eo.Set("ay", ep.ay); eo.Set("az", ep.az);
      eo.Set("bx", ep.bx); eo.Set("by", ep.by); eo.Set("bz", ep.bz);

      double n1[3], n2[3];
      bool have = false;
      if (ep.hasNormals) {
        n1[0] = ep.n1x; n1[1] = ep.n1y; n1[2] = ep.n1z;
        n2[0] = ep.n2x; n2[1] = ep.n2y; n2[2] = ep.n2z;
        have = true;
      } else {
        TopExp_Explorer eexp(shape, TopAbs_EDGE);
        for (; eexp.More(); eexp.Next()) {
          TopoDS_Edge edge = TopoDS::Edge(eexp.Current());
          if (EdgeMatchesEndpoints(edge, {ep.ax, ep.ay, ep.az},
                                   {ep.bx, ep.by, ep.bz})) {
            auto norms = EdgeAdjacentNormals(edge, edgeFaceMap);
            if (norms.size() >= 2) {
              n1[0] = norms[0].x; n1[1] = norms[0].y; n1[2] = norms[0].z;
              n2[0] = norms[1].x; n2[1] = norms[1].y; n2[2] = norms[1].z;
              have = true;
            }
            break;
          }
        }
      }
      if (have) {
        Napi::Array a1 = Napi::Array::New(env, 3);
        Napi::Array a2 = Napi::Array::New(env, 3);
        for (int k = 0; k < 3; k++) {
          a1.Set(uint32_t(k), n1[k]);
          a2.Set(uint32_t(k), n2[k]);
        }
        eo.Set("n1", a1);
        eo.Set("n2", a2);
      }
      outEdges.Set(uint32_t(i), eo);
    }

    Napi::Object out = Napi::Object::New(env);
    out.Set("edges", outEdges);
    if (sg.Has("faces")) out.Set("faces", sg.Get("faces"));
    else out.Set("faces", Napi::Array::New(env, 0));
    return out;
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — tessellation
// ════════════════════════════════════════════════════════════════════════

// tessellate(id, precision) → {positions: Float32Array, indices: Uint32Array,
//                               triangleCount: number}
// precision is the print precision in mm (same unit as tessellate.js#deflectionFor).
Napi::Object TessellateShape(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    int id         = info[0].As<Napi::Number>().Int32Value();
    double prec    = GetDouble(info[1], 0.5);
    double linDefl = std::max(0.001, prec / 10.0);

    TopoDS_Shape shape = FetchShape(id);
    std::vector<float> positions;
    std::vector<uint32_t> indices;
    TessellateInto(shape, linDefl, positions, indices);

    auto posBuf = Napi::Float32Array::New(env, positions.size());
    std::copy(positions.begin(), positions.end(), posBuf.Data());
    auto idxBuf = Napi::Uint32Array::New(env, indices.size());
    std::copy(indices.begin(), indices.end(), idxBuf.Data());

    Napi::Object result = Napi::Object::New(env);
    result.Set("positions", posBuf);
    result.Set("indices", idxBuf);
    result.Set("triangleCount", Napi::Number::New(env, static_cast<int>(indices.size() / 3)));
    return result;
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — shape-store management
// ════════════════════════════════════════════════════════════════════════

Napi::Value ReleaseShape(const Napi::CallbackInfo& info) {
  int id = info[0].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes.erase(id);
  return info.Env().Undefined();
}

Napi::Value ClearAll(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes.clear();
  return info.Env().Undefined();
}

Napi::Number ShapeCount(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lk(g_mu);
  return Napi::Number::New(info.Env(), static_cast<int>(g_shapes.size()));
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — STEP export
// ════════════════════════════════════════════════════════════════════════

// exportSTEP(shapeIds: number[]) → string
// Writes all shapes as a single STEP file (ISO-10303-21) and returns the
// content as a UTF-8 string.  Uses WriteStream to avoid temp-file I/O.
Napi::String ExportSTEP(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    Napi::Array ids = info[0].As<Napi::Array>();
    if (ids.Length() == 0) return Napi::String::New(env, "");

    STEPControl_Writer writer;
    for (uint32_t i = 0; i < ids.Length(); i++) {
      int id = ids.Get(i).As<Napi::Number>().Int32Value();
      TopoDS_Shape shape = FetchShape(id);
      writer.Transfer(shape, STEPControl_AsIs);
    }

    std::ostringstream oss;
    IFSelect_ReturnStatus status = writer.WriteStream(oss);
    if (status != IFSelect_RetDone) {
      throw std::runtime_error(
        "STEP writer failed with status " + std::to_string(static_cast<int>(status)));
    }
    std::string content = oss.str();
    if (content.size() < 100 || content.substr(0, 13) != "ISO-10303-21;") {
      throw std::runtime_error("STEP writer produced an invalid or empty file");
    }
    return Napi::String::New(env, content);
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Phase-0 full-pipeline smoke test (kept for existing test/ping.mjs)
// ════════════════════════════════════════════════════════════════════════

Napi::Object MakeCubeTessellated(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  double precision = info.Length() > 0 && info[0].IsNumber()
                     ? info[0].As<Napi::Number>().DoubleValue()
                     : 0.1;
  try {
    // Build the canonical 2×2×2 centred box from Phase 0.
    gp_Pnt p1(-1, -1, -1);
    gp_Pnt p2(1, 1, 1);
    BRepPrimAPI_MakeBox boxMaker(p1, p2);
    TopoDS_Shape shape = boxMaker.Shape();

    double linDefl = std::max(0.001, precision / 10.0);
    std::vector<float> positions;
    std::vector<uint32_t> indices;
    TessellateInto(shape, linDefl, positions, indices);

    auto posBuf = Napi::Float32Array::New(env, positions.size());
    std::copy(positions.begin(), positions.end(), posBuf.Data());
    auto idxBuf = Napi::Uint32Array::New(env, indices.size());
    std::copy(indices.begin(), indices.end(), idxBuf.Data());

    Napi::Object result = Napi::Object::New(env);
    result.Set("positions", posBuf);
    result.Set("indices", idxBuf);
    result.Set("triangleCount", Napi::Number::New(env, static_cast<int>(indices.size() / 3)));
    return result;
  } catch (const std::exception& e) { throw Napi::Error::New(env, e.what()); }
}

// ════════════════════════════════════════════════════════════════════════
// Module registration
// ════════════════════════════════════════════════════════════════════════

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Smoke tests
  exports.Set("ping",               Napi::Function::New(env, PingStr));
  exports.Set("makeCubeTessellated",Napi::Function::New(env, MakeCubeTessellated));

  // Primitives → shape ID
  exports.Set("makeBox",            Napi::Function::New(env, MakeBox));
  exports.Set("makeSphere",         Napi::Function::New(env, MakeSphere));
  exports.Set("makeCylinder",       Napi::Function::New(env, MakeCylinder));
  exports.Set("makeTorus",          Napi::Function::New(env, MakeTorus));
  exports.Set("makeExtrude",        Napi::Function::New(env, MakeExtrude));

  // Transforms
  exports.Set("transformShape",     Napi::Function::New(env, TransformShape));
  exports.Set("scaleShape",         Napi::Function::New(env, ScaleShape));

  // Boolean ops
  exports.Set("booleanOp",          Napi::Function::New(env, BooleanOp));

  // Chamfer / fillet
  exports.Set("chamferShape",       Napi::Function::New(env, ChamferShape));
  exports.Set("filletShape",        Napi::Function::New(env, FilletShape));
  exports.Set("pushPullFaces",      Napi::Function::New(env, PushPullFaces));
  exports.Set("enrichSubGeo",       Napi::Function::New(env, EnrichSubGeo));

  // Tessellation
  exports.Set("tessellate",         Napi::Function::New(env, TessellateShape));

  // Export
  exports.Set("exportSTEP",         Napi::Function::New(env, ExportSTEP));

  // Shape store management
  exports.Set("releaseShape",       Napi::Function::New(env, ReleaseShape));
  exports.Set("clearAll",           Napi::Function::New(env, ClearAll));
  exports.Set("shapeCount",         Napi::Function::New(env, ShapeCount));

  return exports;
}

NODE_API_MODULE(occ_addon, Init)
