// Rebuilding a mesh as exact faces (docs/exact-imports-plan.md, Part Two step
// 4): each region recognizeSurfaces finds becomes one face on its fitted
// surface, each triangle no surface took becomes a flat face of its own, and
// the faces are joined along shared edges into a solid.
//
// The edges come first and are shared, rather than built per face and sewn:
// the boundary between two regions is a run of mesh edges, and that run
// becomes ONE edge -- a line, a circular arc, or a B-spline through its
// vertices -- used by both faces, so the solid's topology comes from the mesh
// instead of from sewing tolerances.  Sewing is the second attempt, when the
// assembled shell doesn't check out.

#include "occ_core.h"
#include "mesh_edges.h"

#include <functional>
#include <map>
#include <cstdio>
#include <cstdlib>

#include <BRepLib.hxx>
#include <GC_MakeSegment.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <gp_Elips.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Precision.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <ShapeBuild_ReShape.hxx>
#include <ShapeFix_Face.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_Solid.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <gp_Circ.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>

namespace occ {

namespace {

using recog::Fit;
using recog::V3;

gp_Pnt P(const V3& v) { return gp_Pnt(v[0], v[1], v[2]); }
gp_Dir D(const V3& v) { return gp_Dir(v[0], v[1], v[2]); }

// The exact surface a fit describes.
Handle(Geom_Surface) SurfaceOf(const Fit& f, const recog::Mesh& m,
                               const std::vector<uint32_t>& verts) {
  if (f.type == "plane") return new Geom_Plane(gp_Pln(P(f.point), D(f.dir)));
  if (f.type == "cylinder")
    return new Geom_CylindricalSurface(gp_Cylinder(gp_Ax3(P(f.point), D(f.dir)), f.radius));
  if (f.type == "sphere")
    return new Geom_SphericalSurface(gp_Sphere(gp_Ax3(P(f.point), gp::DZ()), f.radius));
  if (f.type == "torus")
    return new Geom_ToroidalSurface(
        gp_Torus(gp_Ax3(P(f.point), D(f.dir)), f.radius, f.minorRadius));
  if (f.type == "ellipticCylinder") {
    // The ellipse across the axis, swept along it: an oval wall.
    Handle(Geom_Ellipse) e = new Geom_Ellipse(
        gp_Elips(gp_Ax2(P(f.point), D(f.dir), D(f.xdir)), f.radius, f.minorRadius));
    return new Geom_SurfaceOfLinearExtrusion(e, gp_Dir(D(f.dir)));
  }
  if (f.type == "cone") {
    // gp_Cone wants its radius at the location to be positive, and the fit's
    // reference point can be past the apex: place it at the region's middle.
    double tm = 0;
    for (uint32_t v : verts) tm += recog::dot(recog::sub(m.vert(v), f.point), f.dir);
    tm /= std::max<size_t>(1, verts.size());
    const double r = f.radius + std::tan(f.halfAngle) * tm;
    if (r <= 0) return nullptr;
    // Always a positive half angle, the axis turned to where the cone widens:
    // the fit's angle is signed (narrowing along its axis when negative), and
    // gp_Cone's is taken as widening along its axis.
    const V3 axis = f.halfAngle < 0 ? recog::mul(f.dir, -1) : f.dir;
    return new Geom_ConicalSurface(gp_Cone(
        gp_Ax3(P(recog::add(f.point, recog::mul(f.dir, tm))), D(axis)), std::abs(f.halfAngle), r));
  }
  return nullptr;
}

// The surface trimmed, in each periodic direction, to the arc the region's
// vertices span (plus a margin), when they don't go all the way round.  On a
// periodic surface two circles bound two regions, and which one a face takes
// is a guess the fix gets wrong when a boundary sits on the seam: a fillet
// whose lower edge was a torus's outer equator came back as the other three
// quarters of the tube, 1.2 short of the mesh's volume.  Trimmed, there is
// only one region to take.
Handle(Geom_Surface) TrimToRegion(const Handle(Geom_Surface)& S, const recog::Mesh& m,
                                  const std::vector<uint32_t>& verts) {
  const bool pu = S->IsUPeriodic(), pv = S->IsVPeriodic();
  if (!pu && !pv) return S;
  std::vector<double> us, vs;
  const size_t stride = std::max<size_t>(1, verts.size() / 2000);
  for (size_t i = 0; i < verts.size(); i += stride) {
    GeomAPI_ProjectPointOnSurf proj(P(m.vert(verts[i])), S);
    if (proj.NbPoints() == 0) continue;
    double u, v;
    proj.LowerDistanceParameters(u, v);
    us.push_back(u);
    vs.push_back(v);
  }
  // The shortest arc holding every parameter: the circle minus its widest
  // gap.  Returns false when the parameters go all the way round.
  auto arc = [](std::vector<double> t, double period, double& lo, double& hi) {
    if (t.size() < 2) return false;
    for (double& x : t) x = std::fmod(std::fmod(x, period) + period, period);
    std::sort(t.begin(), t.end());
    double gap = t.front() + period - t.back(), next = 0;
    lo = t.front();
    for (size_t i = 1; i < t.size(); i++) {
      const double g = t[i] - t[i - 1];
      if (g > gap) {
        next = gap;
        gap = g;
        lo = t[i];
      } else {
        next = std::max(next, g);
      }
    }
    // The vertices of a full band are spaced by the mesh, so the widest gap is
    // only the region's opening if it stands out from the rest.  (A fixed
    // share of the circle doesn't do: a 16-sided cylinder has a 22.5-degree
    // gap between every pair of neighbours, and was trimmed to 337.5 degrees
    // and collapsed to a face of no area.)
    if (gap < period * 0.02 || gap < 3 * next) return false;
    const double margin = std::min(gap * 0.25, period * 0.02);
    hi = lo + (period - gap) + margin;
    lo -= margin;
    return true;
  };
  Handle(Geom_Surface) out = S;
  double lo, hi;
  if (pu && arc(us, S->UPeriod(), lo, hi))
    out = new Geom_RectangularTrimmedSurface(out, lo, hi, Standard_True);
  if (pv && arc(vs, S->VPeriod(), lo, hi))
    out = new Geom_RectangularTrimmedSurface(out, lo, hi, Standard_False);
  return out;
}

// What BRepCheck objects to, counted by kind of sub-shape and complaint, for
// the refusal message ("face: InvalidWire x2, edge: InvalidCurveOnSurface").
std::string CheckSummary(const TopoDS_Shape& s) {
  static const char* names[] = {
      "NoError", "InvalidPointOnCurve", "InvalidPointOnCurveOnSurface",
      "InvalidPointOnSurface", "No3DCurve", "Multiple3DCurve", "Invalid3DCurve",
      "NoCurveOnSurface", "InvalidCurveOnSurface", "InvalidCurveOnClosedSurface",
      "InvalidSameRangeFlag", "InvalidSameParameterFlag", "InvalidDegeneratedFlag",
      "FreeEdge", "InvalidMultiConnexity", "InvalidRange", "EmptyWire", "RedundantEdge",
      "SelfIntersectingWire", "NoSurface", "InvalidWire", "RedundantWire",
      "IntersectingWires", "InvalidImbricationOfWires", "EmptyShell", "RedundantFace",
      "InvalidImbricationOfShells", "UnorientableShape", "NotClosed", "NotConnected",
      "SubshapeNotInShape", "BadOrientation", "BadOrientationOfSubshape",
      "InvalidPolygonOnTriangulation", "InvalidToleranceValue", "EnclosedRegion",
      "CheckFail"};
  BRepCheck_Analyzer an(s);
  std::map<std::string, int> seen;
  const std::pair<TopAbs_ShapeEnum, const char*> kinds[] = {
      {TopAbs_VERTEX, "vertex"}, {TopAbs_EDGE, "edge"}, {TopAbs_WIRE, "wire"},
      {TopAbs_FACE, "face"},     {TopAbs_SHELL, "shell"}, {TopAbs_SOLID, "solid"}};
  for (auto [kind, label] : kinds) {
    TopTools_IndexedMapOfShape subs;
    TopExp::MapShapes(s, kind, subs);
    for (int i = 1; i <= subs.Extent(); i++) {
      Handle(BRepCheck_Result) res = an.Result(subs(i));
      if (res.IsNull()) continue;
      std::set<int> st;
      for (auto x : res->Status()) st.insert(int(x));
      for (res->InitContextIterator(); res->MoreShapeInContext(); res->NextShapeInContext())
        for (auto x : res->StatusOnShape()) st.insert(int(x));
      for (int x : st)
        if (x != 0 && x < int(sizeof(names) / sizeof(*names)))
          seen[std::string(label) + ": " + names[x]]++;
    }
  }
  std::string out;
  for (auto& [k, n] : seen) out += (out.empty() ? "" : ", ") + k + " x" + std::to_string(n);
  return out;
}

// The surface's tightest radius of curvature near a point (0 for a plane):
// what a chord's sag on it is measured against.
double TightestRadius(const Fit& f, const V3& p) {
  if (f.type == "cylinder" || f.type == "sphere") return f.radius;
  if (f.type == "torus") return f.minorRadius;
  // An ellipse curves tightest at the ends of its major axis: b^2 / a.
  if (f.type == "ellipticCylinder") return f.minorRadius * f.minorRadius / f.radius;
  if (f.type == "cone") {
    const V3 d = recog::sub(p, f.point);
    const double h = recog::dot(d, f.dir);
    return recog::len(recog::sub(d, recog::mul(f.dir, h))) / std::cos(f.halfAngle);
  }
  return 0;
}

// The regions behind the faces a checked solid objects to: faces BRepCheck
// flags in the solid, faces with an edge widened past 20 times the
// tolerance, and faces that won't mesh.  A face is traced to its face index by its surface, which each
// face was given its own of.  A
// triangle can't go back to triangles, so its neighbouring regions are blamed
// instead: a triangle bounded by the curved edge of a region beside it is
// where a self-intersecting wire comes from.
std::set<int64_t> Culprits(const TopoDS_Shape& s, const std::vector<Handle(Geom_Surface)>& surf,
                           const std::vector<int64_t>& triOfFace,
                           const std::vector<int64_t>& regionOfFace,
                           const std::vector<std::set<int64_t>>& nbrFaces, double tol) {
  std::set<int64_t> out;
  if (s.IsNull()) return out;
  std::map<const Geom_Surface*, size_t> faceBySurface;
  for (size_t f = 0; f < surf.size(); f++) faceBySurface[surf[f].get()] = f;
  auto faceIndex = [&](const TopoDS_Face& F) -> int64_t {
    auto it = faceBySurface.find(BRep_Tool::Surface(F).get());
    return it == faceBySurface.end() ? -1 : int64_t(it->second);
  };
  std::set<size_t> flagged;
  BRepCheck_Analyzer an(s);
  for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& F = TopoDS::Face(ex.Current());
    bool bad = false;
    TopTools_IndexedMapOfShape subs;
    TopExp::MapShapes(F, subs);
    subs.Add(F);
    for (int i = 1; i <= subs.Extent() && !bad; i++) {
      Handle(BRepCheck_Result) res = an.Result(subs(i));
      if (res.IsNull()) continue;
      for (auto st : res->Status()) bad |= st != BRepCheck_NoError;
      for (res->InitContextIterator(); res->MoreShapeInContext(); res->NextShapeInContext())
        for (auto st : res->StatusOnShape()) bad |= st != BRepCheck_NoError;
    }
    for (TopExp_Explorer e(F, TopAbs_EDGE); e.More() && !bad; e.Next())
      bad = BRep_Tool::Tolerance(TopoDS::Edge(e.Current())) > 20 * tol;
    const int64_t f = faceIndex(F);
    if (bad && f >= 0) flagged.insert(size_t(f));
  }
  // And faces that won't mesh in the solid, which the check refuses too.
  BRepMesh_IncrementalMesh(s, std::max(tol, 1e-3));
  for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tr = BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
    const int64_t f = faceIndex(TopoDS::Face(ex.Current()));
    if ((tr.IsNull() || tr->NbTriangles() == 0) && f >= 0) flagged.insert(size_t(f));
  }
  BRepTools::Clean(s);
  for (size_t f : flagged) {
    if (triOfFace[f] < 0) {
      out.insert(regionOfFace[f]);
      continue;
    }
    for (int64_t g : nbrFaces[f])
      if (triOfFace[g] < 0) out.insert(regionOfFace[g]);
  }
  return out;
}

// Signed volume of a closed triangle mesh.
double MeshVolume(const recog::Mesh& m) {
  double v = 0;
  for (size_t t = 0; t < m.tris(); t++) {
    const V3 a = m.vert(m.idx[3 * t]), b = m.vert(m.idx[3 * t + 1]), c = m.vert(m.idx[3 * t + 2]);
    v += recog::dot(a, recog::cross(b, c)) / 6;
  }
  return v;
}

}  // namespace

// rebuildSurfaces(positions, indices | null, tolerance)
//   -> { shapeId, faces, faceTypes: { plane, ..., triangle }, volume,
//        meshVolume, maxEdgeTolerance, sewn: 0 | 1 }
// Throws, with the reason, when the mesh isn't a closed manifold or the
// rebuilt solid doesn't check out; the caller keeps the mesh then.
Val RebuildSurfaces(Js& js) {
  if (js.argc() < 3)
    throw std::runtime_error("rebuildSurfaces: expected positions, indices, tolerance");
  std::vector<double> pos = ReadPositions(js, js[0], "rebuildSurfaces");
  const size_t vertexCount = pos.size() / 3;
  if (vertexCount < 3) throw std::runtime_error("rebuildSurfaces: too few vertices");
  const std::vector<uint32_t> idx = ReadIndices(js, 1, vertexCount, "rebuildSurfaces");
  const double tol = js.num(js[2], 0.01);

  Recognition rec = Recognize(std::move(pos), idx, tol);
  const recog::Mesh& m = rec.mesh;
  const size_t T = m.tris();
  const size_t V = m.pos.size() / 3;

  // Built, checked, and built again with any region whose boundary curves
  // stray from its surface put back to triangles.
  BRep_Builder B;
  std::vector<char> demoted(rec.regions.size(), 0);
  std::vector<int64_t> faceOf, regionOfFace, triOfFace;
  size_t F = 0;
  // The surfaces' own sag over their areas: how much more an exact curved
  // face encloses than the facets that approximate it (a sphere, 0.067 on 14).
  double sagSlack = 0;
  std::map<std::string, double> faceTypes;
  std::vector<TopoDS_Face> faces;
  Handle(ShapeBuild_ReShape) context;
  TopoDS_Shape solid;
  bool sewn = false;
  const double meshVolume = std::abs(MeshVolume(m));
  double area = 0;
  for (size_t t = 0; t < T; t++) area += rec.area[t];
  // Moving every vertex up to `tol` changes the volume by up to area * tol;
  // a chord's sag adds a little more on curved faces, and the slack is twice
  // the first.

  auto solidFrom = [&](const TopoDS_Shape& shellish) -> TopoDS_Shape {
    TopoDS_Shape shell;
    for (TopExp_Explorer ex(shellish, TopAbs_SHELL); ex.More(); ex.Next()) {
      if (!shell.IsNull()) return TopoDS_Shape();  // more than one shell
      shell = ex.Current();
    }
    if (shell.IsNull()) return TopoDS_Shape();
    ShapeFix_Shell fs(TopoDS::Shell(shell));
    fs.FixOrientationMode() = 0;
    fs.Perform();
    BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(fs.Shell()));
    if (!mk.IsDone()) return TopoDS_Shape();
    ShapeFix_Solid fsol(mk.Solid());
    fsol.Perform();
    TopoDS_Shape solid = fsol.Solid();
    GProp_GProps props;
    BRepGProp::VolumeProperties(solid, props);
    if (props.Mass() < 0) solid.Reverse();
    return solid;
  };
  struct Check {
    bool ok = false;
    double volume = 0;
    long open = -1;
    double loosest = 0;
    std::string why;
  };
  auto check = [&](const TopoDS_Shape& s) {
    Check c;
    if (s.IsNull()) {
      c.why = "no single closed shell";
      return c;
    }
    if (!BRepCheck_Analyzer(s).IsValid()) {
      c.why = "the solid is not valid (" + CheckSummary(s) + ")";
      return c;
    }
    // An edge the fixes had to widen this far leaves a visible gap between
    // the faces meshed on either side of it; the mesh is the better body.
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next())
      c.loosest = std::max(c.loosest, BRep_Tool::Tolerance(TopoDS::Edge(ex.Current())));
    if (c.loosest > 20 * tol) {
      c.why = "an edge is " + std::to_string(c.loosest) + " from its faces";
      return c;
    }
    GProp_GProps props;
    BRepGProp::VolumeProperties(s, props);
    c.volume = props.Mass();
    if (std::abs(c.volume - meshVolume) > 2 * area * tol + sagSlack + 1e-9) {
      c.why = "its volume is " + std::to_string(c.volume) + " against the mesh's " +
              std::to_string(meshVolume);
      return c;
    }
    // Every face must mesh: BRepMesh leaves out a face it can't triangulate,
    // silently, and the body would show a hole.  (Counting open mesh edges,
    // as the bevel checks do, doesn't suit here: these edges are curve fits
    // within the tolerance of both faces, so each face meshes them up to a
    // tolerance apart and the exact weld that count uses sees every one.)
    BRepMesh_IncrementalMesh(s, std::max(tol, 1e-3));
    c.open = 0;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
      TopLoc_Location loc;
      Handle(Poly_Triangulation) tr = BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
      if (tr.IsNull() || tr->NbTriangles() == 0) c.open++;
    }
    BRepTools::Clean(s);
    if (c.open != 0) {
      c.why = std::to_string(c.open) + " of its faces won't mesh";
      return c;
    }
    c.ok = true;
    return c;
  };

  Check c;
  for (int attempt = 0;; attempt++) {
    std::set<int64_t> bad;
    // Faces: one per region, and one per triangle of a region left as mesh.
    // Collapsed slivers (welded to a line) have no face.
    faceOf.assign(T, -1);
    regionOfFace.clear();
    triOfFace.clear();
    std::vector<int64_t> faceOfRegion(rec.regions.size(), -1);
    for (size_t t = 0; t < T; t++) {
      const uint32_t* v = &m.idx[3 * t];
      if (v[0] == v[1] || v[1] == v[2] || v[2] == v[0]) continue;
      const int64_t r = rec.regionOf[t];
      if (rec.regions[r].fit.type == "mesh" || demoted[r]) {
        faceOf[t] = int64_t(regionOfFace.size());
        regionOfFace.push_back(r);
        triOfFace.push_back(int64_t(t));
      } else {
        if (faceOfRegion[r] < 0) {
          faceOfRegion[r] = int64_t(regionOfFace.size());
          regionOfFace.push_back(r);
          triOfFace.push_back(-1);
        }
        faceOf[t] = faceOfRegion[r];
      }
    }
    F = regionOfFace.size();

    // Each face's surface: the region's fitted one, trimmed to the region, or
    // the plane of its one triangle.
    std::vector<std::vector<uint32_t>> faceVerts(F);
    {
      std::vector<std::vector<uint32_t>> faceTris(F);
      for (size_t t = 0; t < T; t++)
        if (faceOf[t] >= 0) faceTris[faceOf[t]].push_back(uint32_t(t));
      for (size_t f = 0; f < F; f++) faceVerts[f] = recog::RegionVerts(m, faceTris[f]);
    }
    std::vector<Handle(Geom_Surface)> surf(F), basis(F);
    std::vector<std::string> typeOf(F);
    // How far a boundary curve may stray from each face: the tolerance, plus
    // the sag the face's own facets show -- an edge against a triangle face
    // is that triangle's straight side, a chord of the curved face beside it.
    std::vector<double> allowed(F, 2 * tol);
    sagSlack = 0;
    for (size_t f = 0; f < F; f++) {
      if (triOfFace[f] >= 0) {
        const uint32_t* v = &m.idx[3 * triOfFace[f]];
        const gp_Vec n = gp_Vec(P(m.vert(v[0])), P(m.vert(v[1])))
                             .Crossed(gp_Vec(P(m.vert(v[0])), P(m.vert(v[2]))));
        if (n.Magnitude() < 1e-300) throw std::runtime_error("rebuildSurfaces: a degenerate triangle");
        surf[f] = new Geom_Plane(gp_Pln(P(m.vert(v[0])), gp_Dir(n)));
        typeOf[f] = "triangle";
      } else {
        const Fit& fit = rec.regions[regionOfFace[f]].fit;
        Handle(Geom_Surface) S = SurfaceOf(fit, m, faceVerts[f]);
        basis[f] = S;
        typeOf[f] = fit.type;
        // A cone whose middle is past its apex has no surface to build: its
        // region goes back to triangles.
        if (S.IsNull()) {
          bad.insert(regionOfFace[f]);
          surf[f] = new Geom_Plane(gp::XOY());
          continue;
        }
        surf[f] = TrimToRegion(S, m, faceVerts[f]);
        double sag = 0;
        for (size_t t = 0; t < T; t++)
          if (faceOf[t] == int64_t(f)) {
            const recog::V3 c = recog::mul(
                recog::add(recog::add(m.vert(m.idx[3 * t]), m.vert(m.idx[3 * t + 1])),
                           m.vert(m.idx[3 * t + 2])),
                1.0 / 3);
            sag = std::max(sag, recog::Distance(fit, c));
          }
        allowed[f] = 2 * (tol + sag);
        double a = 0;
        for (size_t t = 0; t < T; t++)
          if (faceOf[t] == int64_t(f)) a += rec.area[t];
        sagSlack += 2 * a * sag;
      }
    }

    // Boundary edges: mesh edges whose two triangles are on different faces.
    // Anything other than two triangles on an edge is a hole or a fin, and a
    // solid can't be made of it.
    std::unordered_map<uint64_t, std::vector<uint32_t>> edgeTris;
    auto key = [](uint32_t a, uint32_t b) {
      if (a > b) std::swap(a, b);
      return (uint64_t(a) << 32) | b;
    };
    for (size_t t = 0; t < T; t++) {
      if (faceOf[t] < 0) continue;
      for (int k = 0; k < 3; k++)
        edgeTris[key(m.idx[3 * t + k], m.idx[3 * t + (k + 1) % 3])].push_back(uint32_t(t));
    }
    struct BEdge {
      uint32_t a, b;
      int64_t f1, f2;  // f1 < f2
    };
    std::vector<BEdge> bedges;
    for (auto& [k, ts] : edgeTris) {
      if (ts.size() != 2)
        throw std::runtime_error("rebuildSurfaces: the mesh is not closed (an edge has " +
                                 std::to_string(ts.size()) + " triangles)");
      int64_t f1 = faceOf[ts[0]], f2 = faceOf[ts[1]];
      if (f1 == f2) continue;
      if (f1 > f2) std::swap(f1, f2);
      bedges.push_back({uint32_t(k >> 32), uint32_t(k & 0xffffffffu), f1, f2});
    }

    // Runs: maximal chains of boundary edges between the same two faces.  A
    // vertex where the pair changes, or where a pair's chain branches, is a
    // junction and ends a run there.
    std::vector<std::vector<size_t>> atVertex(V);
    for (size_t i = 0; i < bedges.size(); i++) {
      atVertex[bedges[i].a].push_back(i);
      atVertex[bedges[i].b].push_back(i);
    }
    auto pairOf = [&](size_t i) { return std::make_pair(bedges[i].f1, bedges[i].f2); };
    std::vector<char> junction(V, 0);
    for (size_t v = 0; v < V; v++) {
      const auto& es = atVertex[v];
      if (es.empty()) continue;
      std::map<std::pair<int64_t, int64_t>, int> perPair;
      for (size_t e : es) perPair[pairOf(e)]++;
      if (perPair.size() > 1) junction[v] = 1;
      for (auto& [p, c] : perPair)
        if (c != 2) junction[v] = 1;
    }
    std::vector<TopoDS_Vertex> vtx(V);
    auto vertexAt = [&](uint32_t v) {
      if (vtx[v].IsNull()) B.MakeVertex(vtx[v], P(m.vert(v)), tol);
      return vtx[v];
    };
    std::vector<std::vector<TopoDS_Edge>> faceEdges(F);
    std::vector<std::set<int64_t>> nbrFaces(F);
    std::vector<char> used(bedges.size(), 0);
    auto otherEnd = [&](size_t e, uint32_t v) { return bedges[e].a == v ? bedges[e].b : bedges[e].a; };
    auto nextOnPair = [&](uint32_t v, size_t from) -> int64_t {
      for (size_t e : atVertex[v])
        if (!used[e] && e != from && pairOf(e) == pairOf(from)) return int64_t(e);
      return -1;
    };
    // Make the edges of one run, splitting it where no single curve fits.
    std::function<void(const std::vector<uint32_t>&, bool, int64_t, int64_t)> emit =
        [&](const std::vector<uint32_t>& chain, bool closed, int64_t f1, int64_t f2) {
          std::vector<gp_Pnt> pts;
          for (uint32_t v : chain) pts.push_back(P(m.vert(v)));
          Curve cv = FitRun(pts, closed, tol);
          if (cv.c.IsNull()) {
            if (chain.size() <= 2)
              throw std::runtime_error("rebuildSurfaces: no curve through a boundary segment");
            // Split at the middle and fit the halves.
            const size_t mid = chain.size() / 2;
            std::vector<uint32_t> a(chain.begin(), chain.begin() + mid + 1),
                b(chain.begin() + mid, chain.end());
            emit(a, false, f1, f2);
            emit(b, false, f1, f2);
            return;
          }
          // Where two exact surfaces meet along a run the mesh drew with too
          // few vertices, a fitted curve is a chord: a plane cutting a
          // cylinder at an angle meets it in a curve, but a run of two
          // vertices fits a straight line, exact on the plane and 0.126 off
          // the cylinder.  The surfaces' own intersection is the edge.
          if (!closed && triOfFace[f1] < 0 && triOfFace[f2] < 0 &&
              !demoted[regionOfFace[f1]] && !demoted[regionOfFace[f2]]) {
            double off = 0;
            for (int64_t f : {f1, f2}) {
              const Fit& fit = rec.regions[regionOfFace[f]].fit;
              for (int i = 0; i <= 8; i++) {
                const gp_Pnt p = cv.c->Value(cv.u1 + (cv.u2 - cv.u1) * i / 8);
                off = std::max(off, recog::Distance(fit, {p.X(), p.Y(), p.Z()}));
              }
            }
            if (off > 2 * tol) {
              const Curve exact = IntersectionRun(basis[f1], basis[f2], pts, tol);
              if (!exact.c.IsNull()) cv = exact;
            }
          }
          // The curve must lie on both faces' surfaces, not only through the
          // mesh points: a region that fits its vertices can still be off a
          // boundary between them -- a sliver "cone" on a fillet's seam ran
          // along a 1.2-unit chord of the disc beside it, and the fix widened
          // that edge's tolerance to 0.17 to make it fit.  Such a region goes
          // back to triangles.
          for (int64_t f : {f1, f2}) {
            if (triOfFace[f] >= 0 || demoted[regionOfFace[f]]) continue;
            // The fitted surface itself, not the trimmed one: a projection
            // onto a trimmed surface finds nothing just past its bounds.
            const Fit& fit = rec.regions[regionOfFace[f]].fit;
            for (int i = 0; i <= 8; i++) {
              const gp_Pnt p = cv.c->Value(cv.u1 + (cv.u2 - cv.u1) * i / 8);
              if (recog::Distance(fit, {p.X(), p.Y(), p.Z()}) > allowed[f]) {
                bad.insert(regionOfFace[f]);
                break;
              }
            }
          }
          const TopoDS_Vertex v1 = vertexAt(chain.front());
          const TopoDS_Vertex v2 = closed ? v1 : vertexAt(chain.back());
          TopoDS_Edge E;
          B.MakeEdge(E, cv.c, tol);
          B.Add(E, v1.Oriented(TopAbs_FORWARD));
          B.Add(E, v2.Oriented(TopAbs_REVERSED));
          B.Range(E, cv.u1, cv.u2);
          // The vertices are mesh points; widen each to reach its curve end.
          B.UpdateVertex(v1, std::max(tol, P(m.vert(chain.front())).Distance(cv.c->Value(cv.u1)) * 1.01));
          B.UpdateVertex(v2, std::max(tol, P(m.vert(chain.back())).Distance(cv.c->Value(cv.u2)) * 1.01));
          faceEdges[f1].push_back(E);
          nbrFaces[f1].insert(f2);
          nbrFaces[f2].insert(f1);
          faceEdges[f2].push_back(E);
        };
    for (size_t start = 0; start < bedges.size(); start++) {
      if (used[start]) continue;
      // Walk back to a junction (or round a closed loop), then forward.
      size_t e = start;
      uint32_t v = bedges[e].a;
      for (size_t guard = 0; guard < bedges.size() && !junction[v]; guard++) {
        int64_t prev = -1;
        for (size_t f : atVertex[v])
          if (f != e && pairOf(f) == pairOf(e)) prev = int64_t(f);
        if (prev < 0 || size_t(prev) == start) break;
        e = size_t(prev);
        v = otherEnd(e, v);
      }
      std::vector<uint32_t> chain{v};
      bool closed = false;
      for (;;) {
        used[e] = 1;
        v = otherEnd(e, v);
        chain.push_back(v);
        if (v == chain.front()) {
          closed = true;
          break;
        }
        if (junction[v]) break;
        const int64_t nx = nextOnPair(v, e);
        if (nx < 0) break;
        e = size_t(nx);
      }
      if (closed && chain.size() < 4)
        throw std::runtime_error("rebuildSurfaces: a boundary loop of fewer than three edges");
      if (closed) chain.pop_back();  // the loop's first vertex closes it
      if (closed) {
        // A closed run with no junction on it: one closed edge if a curve
        // fits it whole, two halves otherwise.
        std::vector<gp_Pnt> pts;
        for (uint32_t q : chain) pts.push_back(P(m.vert(q)));
        pts.push_back(pts.front());
        if (!FitRun(pts, true, tol).c.IsNull()) {
          std::vector<uint32_t> loop(chain);
          loop.push_back(chain.front());
          emit(loop, true, bedges[start].f1, bedges[start].f2);
        } else {
          const size_t mid = chain.size() / 2;
          std::vector<uint32_t> a(chain.begin(), chain.begin() + mid + 1);
          std::vector<uint32_t> b(chain.begin() + mid, chain.end());
          b.push_back(chain.front());
          emit(a, false, bedges[start].f1, bedges[start].f2);
          emit(b, false, bedges[start].f1, bedges[start].f2);
        }
      } else {
        emit(chain, false, bedges[start].f1, bedges[start].f2);
      }
      if ((start & 255) == 0 && CancelRequested())
        throw std::runtime_error("rebuildSurfaces: cancelled");
    }

    if (!bad.empty()) {
      if (attempt >= 8)
        throw std::runtime_error("rebuildSurfaces: boundary curves kept straying from their faces");
      for (int64_t r : bad) demoted[r] = 1;
      continue;
    }

    // Each face: its surface, bounded by its edges joined into wires.
    faceTypes.clear();
    faces.clear();
    // One context for every face's fixes: adding a cylinder's seam splits the
    // circle it shares with its cap, and without a shared record of that the
    // cap keeps the old edge and the shell falls apart ("not connected").
    context = new ShapeBuild_ReShape;
    for (size_t f = 0; f < F; f++) {
      const Handle(Geom_Surface)& S = surf[f];
      const std::string& type = typeOf[f];
      TopoDS_Face F0;
      B.MakeFace(F0, S, tol);
      if (!faceEdges[f].empty()) {
        Handle(TopTools_HSequenceOfShape) edges = new TopTools_HSequenceOfShape;
        for (const TopoDS_Edge& E : faceEdges[f]) edges->Append(E);
        Handle(TopTools_HSequenceOfShape) wires;
        ShapeAnalysis_FreeBounds::ConnectEdgesToWires(edges, tol, Standard_True, wires);
        for (int i = 1; i <= wires->Length(); i++) B.Add(F0, wires->Value(i));
      }
      ShapeFix_Face fix(F0);
      fix.SetContext(context);
      fix.SetPrecision(tol);
      fix.SetMaxTolerance(4 * tol);
      fix.FixMissingSeamMode() = 1;
      fix.FixOrientationMode() = 1;
      fix.Perform();
      TopoDS_Face done = fix.Face();
      faces.push_back(done);
      faceTypes[type] += 1;
      if ((f & 255) == 0 && CancelRequested())
        throw std::runtime_error("rebuildSurfaces: cancelled");
    }
    for (TopoDS_Face& face : faces) face = TopoDS::Face(context->Apply(face));
    // Each exact face, as it will go into the shell, goes back to triangles
    // if it bounds a different region than its facets cover (a periodic
    // surface's other side; without this two parts came out 3% too big and
    // passed the volume check), if the fix had to widen its edges far past
    // what its facets' sag accounts for (one came out 9.3 mm loose), or if it
    // won't mesh.  Checking each face's validity on its own as well cost
    // half the corpus's exact faces for nothing: a face can fail alone and
    // be fine in the solid, whose check (below) catches the real ones.
    for (size_t f = 0; f < F; f++) {
      if (triOfFace[f] >= 0) continue;
      const TopoDS_Face& face = faces[f];
      double meshArea = 0;
      for (size_t t = 0; t < T; t++)
        if (faceOf[t] == int64_t(f)) meshArea += rec.area[t];
      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      // How far this face is from its own edges -- not the edges' tolerance,
      // which is the worst over both their faces and blamed the fillet's flat
      // top for a cone beside it.
      // Each edge may sit off the face by the tolerance on either side, plus
      // the sag of a chord its length on this surface: an edge against a
      // triangle face is that triangle's straight side.
      const Fit& fit = rec.regions[regionOfFace[f]].fit;
      bool looseEdge = false;
      ShapeAnalysis_Edge sae;
      for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More() && !looseEdge; ex.Next()) {
        const TopoDS_Edge& E = TopoDS::Edge(ex.Current());
        double dev = 0;
        sae.CheckSameParameter(E, face, dev);
        double a, b;
        Handle(Geom_Curve) cv = BRep_Tool::Curve(E, a, b);
        if (cv.IsNull()) continue;
        const gp_Pnt p1 = cv->Value(a), p2 = cv->Value(b), pm = cv->Value((a + b) / 2);
        const double L = std::max(p1.Distance(pm) + pm.Distance(p2), p1.Distance(p2));
        // Measured at the ends, which are on the region: a chord across a
        // near-flat cone passes near its axis, where the cone curves tightly
        // but the region isn't.
        const double rho = std::max(TightestRadius(fit, {p1.X(), p1.Y(), p1.Z()}),
                                    TightestRadius(fit, {p2.X(), p2.Y(), p2.Z()}));
        if (dev > std::min(2 * tol + (rho > 0 ? L * L / (8 * rho) : 0), 20 * tol))
          looseEdge = true;
      }
      bool meshes = false;
      if (std::abs(std::abs(props.Mass()) - meshArea) <= 0.05 * meshArea + tol * tol &&
          !looseEdge) {
        BRepMesh_IncrementalMesh(face, std::max(tol, 1e-3));
        TopLoc_Location loc;
        Handle(Poly_Triangulation) tr = BRep_Tool::Triangulation(face, loc);
        meshes = !tr.IsNull() && tr->NbTriangles() > 0;
        BRepTools::Clean(face);
      }
      if (!meshes) bad.insert(regionOfFace[f]);
    }
    if (!bad.empty()) {
      if (attempt >= 8) throw std::runtime_error("rebuildSurfaces: faces kept failing their checks");
      for (int64_t r : bad) demoted[r] = 1;
      continue;
    }


    // Each face turned to look the way its facets do.  The mesh says which
    // way every face faces; left to ShapeFix_Shell, two of the corpus's parts
    // came out with thousands of edges walked the same way by both their
    // faces ("BadOrientationOfSubshape"), and no face to blame.  A mesh wound
    // inside out throughout gives a solid of negative volume, which solidFrom
    // turns round.
    // A face's sample: the middle of its biggest facet, and that facet's
    // normal as the mesh winds it.
    auto sample = [&](size_t f, gp_Pnt& p, gp_Dir& n) {
      int64_t best = -1;
      for (size_t t = 0; t < T; t++)
        if (faceOf[t] == int64_t(f) && (best < 0 || rec.area[t] > rec.area[best])) best = int64_t(t);
      if (best < 0 || rec.area[best] <= 0) return false;
      const recog::V3 c = recog::mul(
          recog::add(recog::add(m.vert(m.idx[3 * best]), m.vert(m.idx[3 * best + 1])),
                     m.vert(m.idx[3 * best + 2])),
          1.0 / 3);
      p = P(c);
      n = D(rec.normal[best]);
      return true;
    };
    for (size_t f = 0; f < F; f++) {
      gp_Pnt p;
      gp_Dir n;
      if (!sample(f, p, n)) continue;
      GeomAPI_ProjectPointOnSurf proj(p, surf[f]);
      if (!proj.NbPoints()) continue;
      double u, v;
      proj.LowerDistanceParameters(u, v);
      BRepLProp_SLProps props(BRepAdaptor_Surface(faces[f]), u, v, 1, Precision::Confusion());
      if (!props.IsNormalDefined()) continue;
      gp_Dir fn = props.Normal();
      if (faces[f].Orientation() == TopAbs_REVERSED) fn.Reverse();
      if (fn.Dot(n) < 0) faces[f].Reverse();
    }
    // An edge both its faces walk the same way means one of them is
    // inside out where they meet, whichever way it faces overall; no shell
    // fix can settle it (two cylinders did this on a bed arm, and the shell
    // was refused as "BadOrientationOfSubshape").  Their regions go back to
    // triangles -- for a triangle, the regions beside it.
    {
      std::unordered_map<TopoDS_Shape, std::vector<std::pair<size_t, TopAbs_Orientation>>,
                         TopTools_ShapeMapHasher, TopTools_ShapeMapHasher>
          uses;
      for (size_t f = 0; f < F; f++)
        for (TopExp_Explorer ex(faces[f], TopAbs_EDGE); ex.More(); ex.Next()) {
          // The explorer composes the face's own orientation into its edges'.
          uses[ex.Current()].push_back({f, ex.Current().Orientation()});
        }
      for (auto& [E, us] : uses) {
        if (us.size() != 2 || us[0].first == us[1].first || us[0].second != us[1].second)
          continue;
        for (auto [f, o] : us) {
          if (triOfFace[f] < 0)
            bad.insert(regionOfFace[f]);
          else
            for (int64_t g : nbrFaces[f])
              if (triOfFace[g] < 0) bad.insert(regionOfFace[g]);
        }
      }
      if (!bad.empty()) {
        if (attempt >= 8) throw std::runtime_error("rebuildSurfaces: faces kept meeting inside out");
        for (int64_t r : bad) demoted[r] = 1;
        continue;
      }
    }
    TopoDS_Shell shell;
    B.MakeShell(shell);
    for (const TopoDS_Face& f : faces) B.Add(shell, f);
    solid = solidFrom(shell);
    c = check(solid);
    sewn = false;
    if (!c.ok) {
      // Second attempt: sew the faces, letting the sewing join what the shared
      // edges didn't.
      BRepBuilderAPI_Sewing sew(4 * tol);
      for (const TopoDS_Face& f : faces) sew.Add(f);
      sew.Perform();
      const TopoDS_Shape s2 = solidFrom(sew.SewedShape());
      Check c2 = check(s2);
      if (c2.ok) {
        solid = s2;
        c = c2;
        sewn = true;
      } else {
        // The faces the check objects to, back to triangles, and again; a
        // shell-level complaint names no face and ends it.
        std::set<int64_t> culprits =
          Culprits(solid, surf, triOfFace, regionOfFace, nbrFaces, tol);
      if (culprits.empty() || attempt >= 8)
          throw std::runtime_error("rebuildSurfaces: the rebuilt solid was refused (" + c.why +
                                   "; sewn, " + c2.why + ")");
        for (int64_t r : culprits) demoted[r] = 1;
        continue;
      }
    }

    break;
  }

  Val out = js.makeObject();
  js.set(out, "shapeId", js.makeNumber(StoreShape(solid)));
  js.set(out, "faces", js.makeNumber(double(F)));
  Val types = js.makeObject();
  for (const char* t :
       {"plane", "cylinder", "cone", "sphere", "torus", "ellipticCylinder", "triangle"})
    js.set(types, t, js.makeNumber(faceTypes[t]));
  js.set(out, "faceTypes", types);
  js.set(out, "volume", js.makeNumber(c.volume));
  js.set(out, "meshVolume", js.makeNumber(meshVolume));
  // The widest any edge is from its faces: the size of the gaps a viewer
  // could see between faces meshed on either side of it.
  js.set(out, "maxEdgeTolerance", js.makeNumber(c.loosest));
  // No boolean in the engine interface: 1 when the second, sewn attempt was
  // the one that held.
  js.set(out, "sewn", js.makeNumber(sewn ? 1 : 0));
  return out;
}

}  // namespace occ
