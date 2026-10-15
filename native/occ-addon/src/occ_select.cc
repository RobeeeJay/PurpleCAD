// Matching stored edge/face selections to a rebuilt shape, and the
// persistent face/edge names that make the match survive a rebuild.

#include "occ_core.h"

namespace occ {


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

bool EdgeMatchesEndpoints(const TopoDS_Edge& edge,
                                  const Vec3d& posA, const Vec3d& posB,
                                  double eps) {
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

// Tessellation-robust match: is the edge's midpoint on the stored segment
// posA→posB (within tol)?  A stored edge selection is a polyline approximation
// of a curve at the CREATION tessellation; toggling print resolution rebuilds
// the body at a different density, moving every vertex, so the exact-endpoint
// match fails.  The stored ring still traces the same curve, so an OCC edge
// that belongs to it has its midpoint sitting on one of the stored segments —
// which picks the ring precisely without the adjacent-normal set's tendency to
// over-select on bodies whose walls were split into many faces (emboss/deboss).
bool EdgeMidpointOnSegment(const TopoDS_Edge& edge, const Vec3d& a,
                                  const Vec3d& b, double tol) {
  double mx, my, mz;
  try {
    BRepAdaptor_Curve c(edge);
    double um = (c.FirstParameter() + c.LastParameter()) / 2.0;
    gp_Pnt m = c.Value(um);
    mx = m.X();
    my = m.Y();
    mz = m.Z();
  } catch (...) {
    return false;
  }
  const double abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const double ab2 = abx * abx + aby * aby + abz * abz;
  double t = ab2 > 1e-12
                 ? ((mx - a.x) * abx + (my - a.y) * aby + (mz - a.z) * abz) / ab2
                 : 0.0;
  t = std::max(0.0, std::min(1.0, t));
  const double dx = mx - (a.x + abx * t), dy = my - (a.y + aby * t),
               dz = mz - (a.z + abz * t);
  return std::sqrt(dx * dx + dy * dy + dz * dz) < tol;
}

// Compute the outward face normal at the UV midpoint.
// Mirrors computeFaceNormal() from operations.js.

FaceNormal ComputeFaceNormal(const TopoDS_Face& face) {
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

// Read a [x,y,z] array into three doubles.  Returns false if the value is
// missing / not a 3-vector.
static bool ReadVec3(Js& js, Val v, double& x, double& y, double& z) {
  if (js.isArray(v)) {
    if (js.length(v) < 3) return false;
    x = js.num(js.at(v, 0));
    y = js.num(js.at(v, 1));
    z = js.num(js.at(v, 2));
    return true;
  }
  return false;
}

// Parse the edges/faces arrays passed from JS.
EdgeFaceSpec ParseSubGeo(Js& js, Val subGeo) {
  EdgeFaceSpec spec;
  if (js.has(subGeo, "edges")) {
    Val arr = js.get(subGeo, "edges");
    for (uint32_t i = 0; i < js.length(arr); i++) {
      Val e = js.at(arr, i);
      EdgeFaceSpec::EdgeEp ep{
        js.num(js.get(e, "ax")), js.num(js.get(e, "ay")), js.num(js.get(e, "az")),
        js.num(js.get(e, "bx")), js.num(js.get(e, "by")), js.num(js.get(e, "bz")),
        false, 0, 0, 0, 0, 0, 0, ""
      };
      if (js.has(e, "n1") && js.has(e, "n2")) {
        ep.hasNormals =
          ReadVec3(js, js.get(e, "n1"), ep.n1x, ep.n1y, ep.n1z) &&
          ReadVec3(js, js.get(e, "n2"), ep.n2x, ep.n2y, ep.n2z);
      }
      if (js.has(e, "name") && js.isString(js.get(e, "name")))
        ep.name = js.string(js.get(e, "name"));
      spec.edges.push_back(ep);
    }
  }
  if (js.has(subGeo, "faces")) {
    Val arr = js.get(subGeo, "faces");
    for (uint32_t i = 0; i < js.length(arr); i++) {
      Val f = js.at(arr, i);
      bool hasCx = js.has(f, "cx") && !js.isNull(js.get(f, "cx")) &&
                   !js.isUndefined(js.get(f, "cx"));
      std::string name;
      if (js.has(f, "name") && js.isString(js.get(f, "name")))
        name = js.string(js.get(f, "name"));
      spec.faces.push_back({
        js.num(js.get(f, "nx")), js.num(js.get(f, "ny")), js.num(js.get(f, "nz")),
        hasCx,
        hasCx ? js.num(js.get(f, "cx")) : 0.0,
        hasCx ? js.num(js.get(f, "cy")) : 0.0,
        hasCx ? js.num(js.get(f, "cz")) : 0.0,
        name,
        js.has(f, "smoothDeg") ? js.num(js.get(f, "smoothDeg")) : 0.0
      });
    }
  }
  return spec;
}

// The (up to two) planar face normals adjacent to an edge.  These are
// resize-invariant for prismatic geometry, so they uniquely and stably name
// an edge across a parametric resize that moves its endpoints.
std::vector<FaceNormal> EdgeAdjacentNormals(
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

// Side-of-centroid disambiguation for the normal-set fallback.  On a revolved
// body (a ring), the edge diametrically OPPOSITE a stored segment carries the
// identical adjacent-normal pair — e.g. an inner-rim edge at angle th+180 has
// the same {top, (cos th, sin th, 0)} normals as the outer-rim segment at th —
// so normal matching alone selects the wrong rim whenever the coordinate
// passes miss (stale selection after a reorder / appended re-run).  The sign
// of dot(normal, midpoint - bodyCentre) distinguishes them: outward wall
// normals point away from the centre on the OUTER rim and toward it on the
// inner.  Near-zero dots (normal ~ perpendicular to the offset, e.g. the top
// normal against an in-plane offset) are treated as "don't care".
static bool SameSideAsSpec(const TopoDS_Edge& edge,
                           const EdgeFaceSpec::EdgeEp& ep,
                           const gp_Pnt& centre) {
  gp_Pnt mid;
  try {
    BRepAdaptor_Curve c(edge);
    mid = c.Value((c.FirstParameter() + c.LastParameter()) / 2.0);
  } catch (...) {
    return true; // can't evaluate — don't reject on this filter alone
  }
  const double sx = (ep.ax + ep.bx) / 2.0 - centre.X();
  const double sy = (ep.ay + ep.by) / 2.0 - centre.Y();
  const double sz = (ep.az + ep.bz) / 2.0 - centre.Z();
  const double cx = mid.X() - centre.X();
  const double cy = mid.Y() - centre.Y();
  const double cz = mid.Z() - centre.Z();
  const double kTol = 1e-3;
  auto sideOk = [&](double nx, double ny, double nz) {
    const double ds = nx * sx + ny * sy + nz * sz;
    const double dc = nx * cx + ny * cy + nz * cz;
    if (std::abs(ds) < kTol || std::abs(dc) < kTol) return true;
    return (ds > 0) == (dc > 0);
  };
  return sideOk(ep.n1x, ep.n1y, ep.n1z) && sideOk(ep.n2x, ep.n2y, ep.n2z);
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

// Resolve every edge a subGeo spec selects on a shape.  Edges are matched
// topologically (adjacent face normals) when the spec carries them — so a
// selection survives a parametric resize — falling back to endpoint
// coordinates for legacy specs.  Faces match by normal, with a stored
// centroid used only to pick the nearest among same-normal faces (a
// tie-break, not a hard cutoff, so a resized face still matches).  Shared by
// ChamferShape and FilletShape so the two never drift apart.
// Resolve a face spec's persistent name to the actual face on `shape`.  The
// named subshape is confirmed still present (IsSame) so a stale name falls
// through to coordinate matching rather than selecting a dangling handle.
static TopoDS_Face ResolveNamedFace(
    const TopoDS_Shape& shape,
    const std::map<std::string, TopoDS_Shape>* named,
    const std::string& name) {
  if (!named || name.empty()) return TopoDS_Face();
  auto it = named->find(name);
  if (it == named->end() || it->second.ShapeType() != TopAbs_FACE)
    return TopoDS_Face();
  TopoDS_Face nf = TopoDS::Face(it->second);
  for (TopExp_Explorer f(shape, TopAbs_FACE); f.More(); f.Next())
    if (f.Current().IsSame(nf)) return nf;
  return TopoDS_Face();
}

// Is face `f` present in `shape` (by identity)?
static bool FaceInShape(const TopoDS_Shape& shape, const TopoDS_Shape& f) {
  for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next())
    if (e.Current().IsSame(f)) return true;
  return false;
}

// Carry face names from an op's INPUT to its RESULT using the builder's history:
// a named input face maps to its Modified() face(s) if the op reshaped it, or
// keeps its name if it survived unchanged (not IsDeleted, still present).  Faces
// the op created (chamfer surfaces, etc.) are left unnamed here.  This is the
// core of persistent topological naming across operations.
std::map<std::string, TopoDS_Shape> PropagateFaceNames(
    BRepBuilderAPI_MakeShape& mk, const TopoDS_Shape& result,
    const std::map<std::string, TopoDS_Shape>& inFaces) {
  std::map<std::string, TopoDS_Shape> out;
  for (const auto& kv : inFaces) {
    const TopoDS_Shape& s = kv.second;
    bool placed = false;
    try {
      const TopTools_ListOfShape& mod = mk.Modified(s);
      for (const TopoDS_Shape& m : mod)
        if (FaceInShape(result, m)) { out[kv.first] = m; placed = true; break; }
    } catch (...) { /* op has no history for this subshape */ }
    if (!placed) {
      bool deleted = false;
      try { deleted = mk.IsDeleted(s); } catch (...) {}
      if (!deleted && FaceInShape(result, s)) out[kv.first] = s;
    }
  }
  return out;
}

// Remap names through a rigid/affine transform (transform/mirror/scale): the
// builder gives each subshape's single image via ModifiedShape.  Keeps names
// attached as a body is positioned/scaled through the op pipeline.
std::map<std::string, TopoDS_Shape> RemapFaceNames(
    BRepBuilderAPI_ModifyShape& mk,
    const std::map<std::string, TopoDS_Shape>& inFaces) {
  std::map<std::string, TopoDS_Shape> out;
  for (const auto& kv : inFaces) {
    try {
      TopoDS_Shape m = mk.ModifiedShape(kv.second);
      if (!m.IsNull()) out[kv.first] = m;
    } catch (...) {}
  }
  return out;
}

// Name a primitive's faces by geometry: each planar face by its dominant normal
// axis (+x/-x/+y/-y/+z/-z), the lone curved lateral surface (cylinder/cone/
// sphere/torus) as "side".  Deterministic and resize-invariant (a bigger box
// still has a +x face), so a chamfer on a primitive face survives a dimension
// edit.  First face wins on a name clash.
std::map<std::string, TopoDS_Shape> NamePrimitiveFaces(
    const TopoDS_Shape& shape) {
  std::map<std::string, TopoDS_Shape> faces;
  for (TopExp_Explorer f(shape, TopAbs_FACE); f.More(); f.Next()) {
    TopoDS_Face face = TopoDS::Face(f.Current());
    std::string name;
    BRepAdaptor_Surface s(face, false);
    if (s.GetType() == GeomAbs_Plane) {
      FaceNormal n = ComputeFaceNormal(face);
      if (!n.valid) continue;
      double ax = std::abs(n.x), ay = std::abs(n.y), az = std::abs(n.z);
      if (ax >= ay && ax >= az) name = n.x > 0 ? "+x" : "-x";
      else if (ay >= az)        name = n.y > 0 ? "+y" : "-y";
      else                      name = n.z > 0 ? "+z" : "-z";
    } else {
      name = "side";
    }
    if (!name.empty() && !faces.count(name)) faces[name] = face;
  }
  return faces;
}

// Name each edge by the sorted pair of adjacent FACE names it borders
// (e.g. "side3|top" for a top-rim edge).  Reuses the stable face names, so an
// edge name survives a re-tessellation that moves every vertex — the fix for a
// rim chamfer that used to fail re-matching by coordinates.  First edge wins a
// duplicate name.
std::map<std::string, TopoDS_Shape> NameEdgesByFacePairs(
    const TopoDS_Shape& shape,
    const std::map<std::string, TopoDS_Shape>& faceNames) {
  std::map<std::string, TopoDS_Shape> edges;
  if (faceNames.empty()) return edges;
  TopTools_IndexedDataMapOfShapeListOfShape efMap;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
  // A face can carry several names (an exact curved face takes the name of
  // every facet it replaced), so an edge is named by every pair: an old
  // `side7|top` finds the rim of the cylinder that facet became.
  auto namesOfFace = [&](const TopoDS_Shape& f) {
    std::vector<std::string> out;
    for (const auto& kv : faceNames)
      if (kv.second.IsSame(f)) out.push_back(kv.first);
    return out;
  };
  for (int i = 1; i <= efMap.Extent(); ++i) {
    const TopoDS_Shape& edge = efMap.FindKey(i);
    std::vector<TopoDS_Shape> named;
    for (const TopoDS_Shape& f : efMap.FindFromIndex(i))
      if (!namesOfFace(f).empty()) named.push_back(f);
    // A seam borders the same face on both sides: it is no pair of faces.
    if (named.size() < 2 || named[0].IsSame(named[1])) continue;
    for (const std::string& a : namesOfFace(named[0]))
      for (const std::string& b : namesOfFace(named[1])) {
        std::string key = a < b ? a + "|" + b : b + "|" + a;
        if (!edges.count(key)) edges[key] = edge;
      }
  }
  return edges;
}

// Store a solid with a face-name map, deriving its edge names from the adjacent
// face pairs.  The one place solids acquire both name tables.
int StoreNamedSolid(const TopoDS_Shape& s,
                           std::map<std::string, TopoDS_Shape> faces) {
  auto edges = NameEdgesByFacePairs(s, faces);
  return StoreRecord(s, std::move(faces), std::move(edges));
}

// Resolve an edge spec's persistent name to the actual edge on `shape`,
// confirming it is still present (IsSame) so a stale name falls through to
// coordinate matching.
static TopoDS_Edge ResolveNamedEdge(
    const TopoDS_Shape& shape,
    const std::map<std::string, TopoDS_Shape>* named,
    const std::string& name) {
  if (!named || name.empty()) return TopoDS_Edge();
  auto it = named->find(name);
  if (it == named->end() || it->second.ShapeType() != TopAbs_EDGE)
    return TopoDS_Edge();
  TopoDS_Edge ne = TopoDS::Edge(it->second);
  for (TopExp_Explorer e(shape, TopAbs_EDGE); e.More(); e.Next())
    if (e.Current().IsSame(ne)) return ne;
  return TopoDS_Edge();
}

// The face adjacent to the most of the given edges — the face a rim selection
// bounds (e.g. the top cap for a ring's top rim).  Used as a chamfer fallback:
// individual rim edges OCC won't bevel together (a thin ring at coarse
// tessellation) often succeed as that whole face's boundary, and the result is
// a clean solid (far faster for a downstream op than a mesh-sewn one).
TopoDS_Face MostCommonAdjacentFace(
    const TopoDS_Shape& shape, const std::vector<SelectedEdge>& edges) {
  TopTools_IndexedDataMapOfShapeListOfShape efMap;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
  std::vector<std::pair<TopoDS_Face, int>> counts;
  for (const auto& se : edges) {
    if (!efMap.Contains(se.edge)) continue;
    for (const TopoDS_Shape& f : efMap.FindFromKey(se.edge)) {
      bool found = false;
      for (auto& pc : counts)
        if (pc.first.IsSame(f)) { pc.second++; found = true; break; }
      if (!found) counts.push_back({TopoDS::Face(f), 1});
    }
  }
  TopoDS_Face best;
  int bestC = 0;
  for (auto& pc : counts)
    if (pc.second > bestC) { bestC = pc.second; best = pc.first; }
  return best;
}

std::vector<SelectedEdge> SelectSubGeoEdges(
    const TopoDS_Shape& shape, const EdgeFaceSpec& spec,
    const std::map<std::string, TopoDS_Shape>* namedFaces,
    const std::map<std::string, TopoDS_Shape>* namedEdges) {
  std::vector<SelectedEdge> out;
  std::set<std::string> addedKeys;

  TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

  // Body centre for the normal-fallback's side disambiguation (SameSideAsSpec).
  gp_Pnt shapeCentre(0, 0, 0);
  {
    Bnd_Box bb;
    BRepBndLib::Add(shape, bb);
    if (!bb.IsVoid()) {
      Standard_Real x0, y0, z0, x1, y1, z1;
      bb.Get(x0, y0, z0, x1, y1, z1);
      shapeCentre = gp_Pnt((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    }
  }

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

  for (const auto& ep : spec.edges) {
    // Persistent name wins: resolve the exact edge by its face-pair name,
    // skipping all coordinate/normal matching (survives a re-tessellation).
    TopoDS_Edge namedEdge = ResolveNamedEdge(shape, namedEdges, ep.name);
    if (!namedEdge.IsNull()) {
      addEdge(namedEdge, faceTouchingEdge(namedEdge));
      continue;
    }
    // Pass 1: precise endpoint match.  When the stored endpoints still lie on
    // the shape (a fresh chamfer, or a regen with no resize) this pins the
    // exact edge — crucial on bodies whose walls were split into many faces by
    // an emboss/deboss, where several edges share the same adjacent-normal pair
    // and the normal-set match below would over-select a set OCC can't bevel.
    bool matched = false;
    for (TopExp_Explorer e1(shape, TopAbs_EDGE); e1.More(); e1.Next()) {
      TopoDS_Edge edge = TopoDS::Edge(e1.Current());
      if (EdgeMatchesEndpoints(edge, {ep.ax, ep.ay, ep.az},
                               {ep.bx, ep.by, ep.bz})) {
        addEdge(edge, faceTouchingEdge(edge));
        matched = true;
      }
    }
    // Pass 2: tessellation-robust proximity.  If the exact endpoints didn't
    // match (the body was rebuilt at a different resolution — toggling print
    // mode — so every vertex moved), select the OCC edges whose midpoint sits
    // on this stored segment.  This tracks the SAME curve precisely, so it
    // avoids the normal-set over-selection that makes MakeChamfer reject the
    // result on emboss-split walls.
    if (!matched) {
      for (TopExp_Explorer em(shape, TopAbs_EDGE); em.More(); em.Next()) {
        TopoDS_Edge edge = TopoDS::Edge(em.Current());
        if (EdgeMidpointOnSegment(edge, {ep.ax, ep.ay, ep.az},
                                  {ep.bx, ep.by, ep.bz}, 0.05)) {
          addEdge(edge, faceTouchingEdge(edge));
          matched = true;
        }
      }
    }
    // Pass 3: resize-invariant normal fallback — only when the endpoints have
    // moved off the shape entirely (a parametric resize repositions the curve),
    // so the precise passes win whenever the selection still traces the body.
    //
    // A stored segment names ONE edge, so when its normals fit more than a
    // handful the match is ambiguous and takes none: on a body whose wall is
    // sewn triangles (a conform emboss's lettering) a single rim segment's
    // normal pair fit 782 of its edges, and the chamfer that got them failed
    // after two minutes of retries.
    if (!matched && ep.hasNormals) {
      constexpr size_t kMaxNormalMatches = 4;
      std::vector<TopoDS_Edge> fits;
      for (TopExp_Explorer e2(shape, TopAbs_EDGE);
           e2.More() && fits.size() <= kMaxNormalMatches; e2.Next()) {
        TopoDS_Edge edge = TopoDS::Edge(e2.Current());
        if (NormalSetMatches(EdgeAdjacentNormals(edge, edgeFaceMap), ep) &&
            SameSideAsSpec(edge, ep, shapeCentre))
          fits.push_back(edge);
      }
      if (fits.size() <= kMaxNormalMatches)
        for (const auto& edge : fits) addEdge(edge, faceTouchingEdge(edge));
    }
  }

  const double eps = 0.05;
  for (const auto& req : spec.faces) {
    // Persistent name wins: resolve the exact face directly, skipping the
    // coordinate/normal search entirely (survives a dimension edit).
    TopoDS_Face named = ResolveNamedFace(shape, namedFaces, req.name);
    if (!named.IsNull()) {
      for (TopExp_Explorer eexp(named, TopAbs_EDGE); eexp.More(); eexp.Next())
        addEdge(TopoDS::Edge(eexp.Current()), named);
      continue;
    }
    TopoDS_Face best;
    double bestDist = 1e300;
    bool found = false;
    std::vector<TopoDS_Face> allNormalMatches;
    TopExp_Explorer fexp(shape, TopAbs_FACE);
    for (; fexp.More(); fexp.Next()) {
      TopoDS_Face face = TopoDS::Face(fexp.Current());
      if (req.hasCentroid) {
        // Point-on-face match: the clicked sample point lies on exactly one
        // face, so nearest-distance identifies it.  This works for CURVED faces
        // too (whose representative normal differs from the clicked-point
        // normal), letting a single click select the whole cylindrical /
        // arc-swept face — the normal filter below would wrongly reject them.
        gp_Pnt pnt(req.cx, req.cy, req.cz);
        BRepBuilderAPI_MakeVertex vMk(pnt);
        BRepExtrema_DistShapeShape dist(vMk.Vertex(), face, Extrema_ExtFlag_MIN,
                                        Extrema_ExtAlgo_Grad);
        dist.Perform();
        double d =
            (dist.IsDone() && dist.NbSolution() >= 1) ? dist.Value() : 1e299;
        if (!found || d < bestDist) {
          best = face;
          bestDist = d;
          found = true;
        }
      } else {
        // Legacy spec (no sample point): match every same-normal face.
        auto n = ComputeFaceNormal(face);
        if (!n.valid) continue;
        if (std::abs(req.nx - n.x) >= eps || std::abs(req.ny - n.y) >= eps ||
            std::abs(req.nz - n.z) >= eps)
          continue;
        allNormalMatches.push_back(face);
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

// A face's outward normal where it meets `edge`, from the edge's curve on the
// face: on a curved face the normal turns, and whether two faces meet
// smoothly is decided by their normals AT the edge between them.
static bool NormalAtEdge(const TopoDS_Face& face, const TopoDS_Edge& edge,
                         gp_Dir& out) {
  try {
    double f, l;
    Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(edge, face, f, l);
    if (pc.IsNull()) return false;
    const gp_Pnt2d uv = pc->Value((f + l) / 2.0);
    BRepAdaptor_Surface s(face, false);
    gp_Pnt p;
    gp_Vec du, dv;
    s.D1(uv.X(), uv.Y(), p, du, dv);
    gp_Vec n = du.Crossed(dv);
    if (n.Magnitude() < 1e-12) return false;
    if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Dir(n);
    return true;
  } catch (...) {
    return false;
  }
}

// Every face reached from `seed` across edges where the two faces meet within
// `deg` -- the native side of the hover highlight's curve detection
// (highlights.js grows across triangles by the same rule), so a selection
// takes what was highlighted.
static void GrowSmoothRegion(
    const TopoDS_Face& seed, double deg,
    const TopTools_IndexedDataMapOfShapeListOfShape& edgeFaces,
    TopTools_IndexedMapOfShape& into) {
  const double cosMax = std::cos(deg * M_PI / 180.0);
  std::vector<TopoDS_Face> queue{seed};
  into.Add(seed);
  while (!queue.empty()) {
    const TopoDS_Face f = queue.back();
    queue.pop_back();
    for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More(); ex.Next()) {
      const TopoDS_Edge e = TopoDS::Edge(ex.Current());
      if (!edgeFaces.Contains(e)) continue;
      for (const TopoDS_Shape& g : edgeFaces.FindFromKey(e)) {
        if (g.IsSame(f) || into.Contains(g)) continue;  // a seam, or seen
        gp_Dir n1, n2;
        if (!NormalAtEdge(f, e, n1) || !NormalAtEdge(TopoDS::Face(g), e, n2))
          continue;
        if (n1.Dot(n2) < cosMax) continue;
        into.Add(g);
        queue.push_back(TopoDS::Face(g));
      }
    }
  }
}

// Distance from a point to a face (1e299 if it can't be measured).
static double PointToFace(const gp_Pnt& p, const TopoDS_Face& face) {
  BRepBuilderAPI_MakeVertex vMk(p);
  BRepExtrema_DistShapeShape dist(vMk.Vertex(), face, Extrema_ExtFlag_MIN,
                                  Extrema_ExtAlgo_Grad);
  dist.Perform();
  return (dist.IsDone() && dist.NbSolution() >= 1) ? dist.Value() : 1e299;
}

// Resolve the actual faces a subGeo spec selects — the face-only analogue of
// SelectSubGeoEdges (which explodes matched faces into their edges for
// chamfer/fillet).  Matches by normal, using the stored centroid only as a
// nearest tie-break among same-normal faces so a resized face still matches.
// A face carrying smoothDeg grows into its smooth region (GrowSmoothRegion).
// Used by push/pull and draft, which need the TopoDS_Face itself.
std::vector<TopoDS_Face> SelectSubGeoFaces(
    const TopoDS_Shape& shape, const EdgeFaceSpec& spec,
    const std::map<std::string, TopoDS_Shape>* namedFaces) {
  const double eps = 0.05;
  // Ordered and without repeats: two picks inside one smooth region would
  // otherwise move its faces twice.
  TopTools_IndexedMapOfShape chosen;
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  bool edgeFacesBuilt = false;
  for (const auto& req : spec.faces) {
    std::vector<TopoDS_Face> picked;
    TopoDS_Face named = ResolveNamedFace(shape, namedFaces, req.name);
    if (!named.IsNull()) {
      picked.push_back(named);
    } else {
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
        // Push/pull stores a face centroid that may sit OFF the face plane
        // (the profile centroid, not an on-surface hit point), so match by
        // normal and use the centroid only as a nearest tie-break among
        // same-normal faces.  (SelectSubGeoEdges, used by chamfer/fillet,
        // gets an on-surface hit point and can match curved faces by
        // point-on-face instead.)
        double d = PointToFace(gp_Pnt(req.cx, req.cy, req.cz), face);
        if (!found || d < bestDist) {
          best = face;
          bestDist = d;
          found = true;
        }
      }
      // A curve-detected pick is a hit point ON the clicked face.  On a truly
      // curved face the normal at its middle isn't the clicked one, so the
      // normal filter above finds nothing there -- fall back to the face
      // nearest the point.  (Only then: measuring every face of a sewn mesh
      // body is slow.)
      if (req.smoothDeg > 0 && req.hasCentroid && (!found || bestDist > 1e-4)) {
        const gp_Pnt hit(req.cx, req.cy, req.cz);
        for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
          const TopoDS_Face face = TopoDS::Face(ex.Current());
          const double d = PointToFace(hit, face);
          if (!found || d < bestDist) {
            best = face;
            bestDist = d;
            found = true;
          }
        }
      }
      if (req.hasCentroid) {
        if (found) picked.push_back(best);
      } else {
        picked = allNormalMatches;
      }
    }
    for (const auto& face : picked) {
      if (req.smoothDeg > 0) {
        if (!edgeFacesBuilt) {
          TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE,
                                        edgeFaces);
          edgeFacesBuilt = true;
        }
        GrowSmoothRegion(face, req.smoothDeg, edgeFaces, chosen);
      } else {
        chosen.Add(face);
      }
    }
  }
  std::vector<TopoDS_Face> out;
  for (int i = 1; i <= chosen.Extent(); i++)
    out.push_back(TopoDS::Face(chosen(i)));
  return out;
}

}  // namespace occ
