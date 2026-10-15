#include "occ_core.h"

#include <BRepAdaptor_CompCurve.hxx>
#include <ElCLib.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeCircle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <gp_Elips.hxx>

#include <algorithm>
#include <vector>

namespace occ {

// ════════════════════════════════════════════════════════════════════════
// Exported functions — primitives
// ════════════════════════════════════════════════════════════════════════

// ping() → "pong": smoke test that the addon loaded.
Val PingStr(Js& js) { return js.makeString("pong"); }

// makeBox(x1, y1, z1, x2, y2, z2) → shapeId
// Matches primitives.js makeCube(): p1=(-1,-1,-1) p2=(1,1,1) for the
// default 2×2×2 cube; callers pass the desired corner coordinates.
Val MakeBox(Js& js) {
  double x1 = js.num(js[0]), y1 = js.num(js[1]), z1 = js.num(js[2]);
  double x2 = js.num(js[3]), y2 = js.num(js[4]), z2 = js.num(js[5]);
  BRepPrimAPI_MakeBox mk(gp_Pnt(x1, y1, z1), gp_Pnt(x2, y2, z2));
  return js.makeNumber(StoreNamedSolid(mk.Shape(), NamePrimitiveFaces(mk.Shape())));
}

// makeSphere(radius) → shapeId
Val MakeSphere(Js& js) {
  double r = js.num(js[0], 1.5);
  BRepPrimAPI_MakeSphere mk(r);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), NamePrimitiveFaces(mk.Shape())));
}

// makeCylinder(originY, radius, height) → shapeId
// Axis = +Y to match three.js CylinderGeometry and primitives.js.
// originY = -height/2 so the cylinder is centred on the origin.
Val MakeCylinder(Js& js) {
  double originY = js.num(js[0], -1.0);
  double radius  = js.num(js[1], 1.0);
  double height  = js.num(js[2], 2.0);
  gp_Ax2 ax(gp_Pnt(0, originY, 0), gp_Dir(0, 1, 0));
  BRepPrimAPI_MakeCylinder mk(ax, radius, height);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), NamePrimitiveFaces(mk.Shape())));
}

// makeCone(originY, radiusBottom, radiusTop, height) → shapeId
// Axis = +Y, centred (originY = -height/2).  radiusTop may be 0 (an apex).
Val MakeCone(Js& js) {
  double originY = js.num(js[0], -1.0);
  double r1      = js.num(js[1], 1.0);
  double r2      = js.num(js[2], 0.0);
  double height  = js.num(js[3], 2.0);
  gp_Ax2 ax(gp_Pnt(0, originY, 0), gp_Dir(0, 1, 0));
  BRepPrimAPI_MakeCone mk(ax, r1, r2, height);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), NamePrimitiveFaces(mk.Shape())));
}

// makeTorus(majorR, minorR) → shapeId
// Axis = +Y (matches primitives.js makeTorus which uses ax2YUp).
Val MakeTorus(Js& js) {
  double majorR = js.num(js[0], 1.0);
  double minorR = js.num(js[1], 0.4);
  gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0));
  BRepPrimAPI_MakeTorus mk(ax, majorR, minorR);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), NamePrimitiveFaces(mk.Shape())));
}

// Build a closed polygon wire in the sketch's centroid-local frame (z=0).
// `pts` is [x0,y0, x1,y1, ...]; centroid (cx,cy) is subtracted so the sketch
// origin sits at (0,0).  Returns a null wire if the builder fails.
static TopoDS_Wire BuildPolyWire(const double* pts, size_t n,
                                 double cx, double cy) {
  if (n < 3) return TopoDS_Wire();
  BRepBuilderAPI_MakeWire wireMk;
  for (size_t i = 0; i < n; i++) {
    size_t j = (i + 1) % n;
    gp_Pnt p1(pts[i * 2] - cx, pts[i * 2 + 1] - cy, 0);
    gp_Pnt p2(pts[j * 2] - cx, pts[j * 2 + 1] - cy, 0);
    BRepBuilderAPI_MakeEdge edgeMk(p1, p2);
    wireMk.Add(edgeMk.Edge());
  }
  return wireMk.IsDone() ? wireMk.Wire() : TopoDS_Wire();
}

// A loop's exact curves, packed by the caller (packCurveRuns): per run
// [start, count, kind, params...], edge k running from vertex k to k+1.
// kind 1 = circle arc (cx, cy, r), 2 = cubic bezier (p0..p3), 3 = ellipse
// (cx, cy, rx, ry), 4 = a smooth curve with no closed form (a cog's involute
// flank): a B-spline through the run's own vertices, which are exact points
// on it.
static constexpr size_t kCurveRunWidth = 11;

// A B-spline through the given points, as an edge between va and vb.  Null
// when there are too few points or the interpolation fails.
static TopoDS_Edge SmoothEdgeThrough(const std::vector<gp_Pnt>& pts,
                                     const TopoDS_Vertex& va,
                                     const TopoDS_Vertex& vb) {
  if (pts.size() < 3) return TopoDS_Edge();
  Handle(TColgp_HArray1OfPnt) arr =
      new TColgp_HArray1OfPnt(1, static_cast<int>(pts.size()));
  for (size_t i = 0; i < pts.size(); i++)
    arr->SetValue(static_cast<int>(i) + 1, pts[i]);
  GeomAPI_Interpolate interp(arr, false, Precision::Confusion());
  interp.Perform();
  if (!interp.IsDone()) return TopoDS_Edge();
  Handle(Geom_BSplineCurve) spline = interp.Curve();
  BRepBuilderAPI_MakeEdge mk(spline, va, vb);
  return mk.IsDone() ? mk.Edge() : TopoDS_Edge();
}

// The edge for one curve run from vertex a to vertex b, through vertex m (a
// sample between them: it says which way round a circle the run goes).  Null
// when the curve doesn't pass through its own endpoints.
static TopoDS_Edge CurveRunEdge(const double* q, const gp_Pnt& pa,
                                const gp_Pnt& pm, const gp_Pnt& pb,
                                const TopoDS_Vertex& va,
                                const TopoDS_Vertex& vb, double cx,
                                double cy) {
  const int kind = static_cast<int>(q[2]);
  if (kind == 2) {
    TColgp_Array1OfPnt poles(1, 4);
    for (int i = 0; i < 4; i++)
      poles.SetValue(i + 1, gp_Pnt(q[3 + 2 * i] - cx, q[4 + 2 * i] - cy, 0));
    // The samples may run either way along the stored curve.
    if (pa.Distance(poles(1)) > pa.Distance(poles(4))) {
      TColgp_Array1OfPnt rev(1, 4);
      for (int i = 1; i <= 4; i++) rev.SetValue(i, poles(5 - i));
      poles = rev;
    }
    Handle(Geom_BezierCurve) bez = new Geom_BezierCurve(poles);
    BRepBuilderAPI_MakeEdge mk(bez, va, vb);
    return mk.IsDone() ? mk.Edge() : TopoDS_Edge();
  }
  if (kind != 1 && kind != 3) return TopoDS_Edge();
  gp_Pnt c(q[3] - cx, q[4] - cy, 0);
  Handle(Geom_Curve) conic;
  double ua, um, ub;
  if (kind == 1) {
    gp_Circ circ(gp_Ax2(c, gp::DZ()), q[5]);
    conic = new Geom_Circle(circ);
    ua = ElCLib::Parameter(circ, pa);
    um = ElCLib::Parameter(circ, pm);
    ub = ElCLib::Parameter(circ, pb);
  } else {
    // gp_Elips wants its major radius along its X direction.
    const bool wide = q[5] >= q[6];
    gp_Ax2 ax(c, gp::DZ(), wide ? gp::DX() : gp::DY());
    gp_Elips el(ax, wide ? q[5] : q[6], wide ? q[6] : q[5]);
    conic = new Geom_Ellipse(el);
    ua = ElCLib::Parameter(el, pa);
    um = ElCLib::Parameter(el, pm);
    ub = ElCLib::Parameter(el, pb);
  }
  // Both conics run counter-clockwise; a clockwise run is built forwards
  // from b to a and turned round.
  const double twoPi = 2 * M_PI;
  auto fwd = [&](double from, double to) {
    double d = std::fmod(to - from, twoPi);
    return d < 0 ? d + twoPi : d;
  };
  const bool ccw = fwd(ua, um) < fwd(ua, ub);
  BRepBuilderAPI_MakeEdge mk = ccw ? BRepBuilderAPI_MakeEdge(conic, va, vb)
                                   : BRepBuilderAPI_MakeEdge(conic, vb, va);
  if (!mk.IsDone()) return TopoDS_Edge();
  return ccw ? mk.Edge() : TopoDS::Edge(mk.Edge().Reversed());
}

// Each wire edge with the polygon edges it stands for: (first index, count).
using EdgeRanges =
    std::vector<std::pair<TopoDS_Edge, std::pair<size_t, size_t>>>;

// A closed loop with its curved runs as exact edges and straight edges
// between, sharing one vertex per polygon point so the wire closes exactly.
// A run whose curve can't be built falls back to its sampled segments.
// `ranges`, when given, records which polygon edges each wire edge covers.
static TopoDS_Wire BuildCurveWire(const double* pts, size_t n, double cx,
                                  double cy, const double* runs,
                                  size_t nRuns,
                                  EdgeRanges* ranges = nullptr) {
  if (n < 3) return TopoDS_Wire();
  auto P = [&](size_t i) {
    i %= n;
    return gp_Pnt(pts[i * 2] - cx, pts[i * 2 + 1] - cy, 0);
  };
  std::vector<int> owner(n, -1);
  for (size_t r = 0; r < nRuns; r++) {
    const double* q = runs + r * kCurveRunWidth;
    const size_t start = static_cast<size_t>(q[0]);
    const size_t count = static_cast<size_t>(q[1]);
    if (count == 0 || count > n || start >= n) continue;
    for (size_t k = 0; k < count; k++) owner[(start + k) % n] = (int)r;
  }

  BRepBuilderAPI_MakeWire wireMk;
  // One curve round the whole loop: a full circle or ellipse, one closed
  // edge, turned to the loop's own winding (a hole runs clockwise).
  if (owner[0] >= 0 &&
      std::all_of(owner.begin(), owner.end(),
                  [&](int o) { return o == owner[0]; })) {
    const double* q = runs + owner[0] * kCurveRunWidth;
    gp_Pnt c(q[3] - cx, q[4] - cy, 0);
    TopoDS_Edge e;
    if (q[2] == 1) {
      e = BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(c, gp::DZ()), q[5])).Edge();
    } else if (q[2] == 3) {
      const bool wide = q[5] >= q[6];
      gp_Elips el(gp_Ax2(c, gp::DZ(), wide ? gp::DX() : gp::DY()),
                  wide ? q[5] : q[6], wide ? q[6] : q[5]);
      e = BRepBuilderAPI_MakeEdge(el).Edge();
    }
    if (!e.IsNull()) {
      double area2 = 0;
      for (size_t i = 0; i < n; i++) {
        size_t j = (i + 1) % n;
        area2 += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
      }
      if (area2 < 0) e.Reverse();
      wireMk.Add(e);
      if (ranges && wireMk.IsDone()) ranges->push_back({wireMk.Edge(), {0, n}});
      return wireMk.IsDone() ? wireMk.Wire() : TopoDS_Wire();
    }
  }

  std::vector<TopoDS_Vertex> V(n);
  for (size_t i = 0; i < n; i++)
    V[i] = BRepBuilderAPI_MakeVertex(P(i)).Vertex();
  // Start where an edge changes owner, so no run is cut in two.
  size_t s0 = 0;
  for (size_t i = 0; i < n; i++)
    if (owner[i] != owner[(i + n - 1) % n]) {
      s0 = i;
      break;
    }
  auto straight = [&](size_t i) {
    wireMk.Add(BRepBuilderAPI_MakeEdge(V[i % n], V[(i + 1) % n]).Edge());
    if (ranges) ranges->push_back({wireMk.Edge(), {i % n, 1}});
  };
  for (size_t k = 0; k < n;) {
    const size_t i = (s0 + k) % n;
    const int r = owner[i];
    if (r < 0) {
      straight(i);
      k++;
      continue;
    }
    size_t c = 0;
    while (k + c < n && owner[(s0 + k + c) % n] == r) c++;
    const size_t b = (i + c) % n;
    // A one-edge run has no sample between its ends: the chord's midpoint
    // lies on the same side of the centre as the short arc it stands for.
    gp_Pnt pm = c >= 2 ? P(i + c / 2)
                       : gp_Pnt((P(i).X() + P(b).X()) / 2,
                                (P(i).Y() + P(b).Y()) / 2, 0);
    TopoDS_Edge e;
    if (runs[r * kCurveRunWidth + 2] == 4) {
      std::vector<gp_Pnt> through;
      for (size_t j = 0; j <= c; j++) through.push_back(P(i + j));
      e = SmoothEdgeThrough(through, V[i], V[b]);
    } else {
      e = CurveRunEdge(runs + r * kCurveRunWidth, P(i), pm, P(b), V[i], V[b],
                       cx, cy);
    }
    if (e.IsNull()) {
      for (size_t j = 0; j < c; j++) straight(i + j);
    } else {
      wireMk.Add(e);
      if (ranges) ranges->push_back({wireMk.Edge(), {i, c}});
    }
    k += c;
  }
  return wireMk.IsDone() ? wireMk.Wire() : TopoDS_Wire();
}

// The packed curve runs in `v`, when it holds any.
static bool CurveRunsArg(Js& js, Val v, F64& out) {
  if (!js.isTypedArray(v)) return false;
  out = js.f64(v);
  return out.ElementLength() >= kCurveRunWidth;
}

// Build a planar face from an outer polygon + CW hole polygons (centroid-local,
// z=0).  Shared by extrude / revolve / loft.  Throws on a bad outer wire/face.
// `outerCurves` / `holeCurves` (optional) carry each loop's exact curves; a
// loop without them is built from its polygon, as every older document is.
// One profile loop: from its exact curves when `curves` holds them, else
// from its polygon.
static TopoDS_Wire LoopWire(Js& js, const F64& pts, Val curves, double cx,
                            double cy, EdgeRanges* ranges = nullptr) {
  F64 runs;
  if (curves != nullptr && CurveRunsArg(js, curves, runs))
    return BuildCurveWire(pts.Data(), pts.ElementLength() / 2, cx, cy,
                          runs.Data(), runs.ElementLength() / kCurveRunWidth,
                          ranges);
  return BuildPolyWire(pts.Data(), pts.ElementLength() / 2, cx, cy);
}

static TopoDS_Face BuildProfileFace(Js& js, const F64& outer, Val holes,
                                    double cx, double cy,
                                    Val outerCurves = nullptr,
                                    Val holeCurves = nullptr,
                                    EdgeRanges* outerRanges = nullptr) {
  auto loopWire = [&](const F64& pts, Val curves) {
    return LoopWire(js, pts, curves, cx, cy);
  };
  TopoDS_Wire ow = LoopWire(js, outer, outerCurves, cx, cy, outerRanges);
  if (ow.IsNull()) throw std::runtime_error("outer wire builder failed");
  BRepBuilderAPI_MakeFace faceMk(ow, true);
  if (!faceMk.IsDone())
    throw std::runtime_error("face builder failed (outer wire)");
  TopoDS_Face face = faceMk.Face();
  const bool haveHoleCurves = holeCurves != nullptr && js.isArray(holeCurves);
  for (uint32_t h = 0; h < js.length(holes); h++) {
    F64 hpts = js.f64(js.at(holes, h));
    Val hc = haveHoleCurves && h < js.length(holeCurves)
                 ? js.at(holeCurves, h)
                 : nullptr;
    TopoDS_Wire hw = loopWire(hpts, hc);
    if (hw.IsNull()) continue;
    BRepBuilderAPI_MakeFace faceWithHole(face, hw);
    if (faceWithHole.IsDone()) face = faceWithHole.Face();
  }
  return face;
}

// makeExtrude(outerPts, holes, centroidX, centroidY, depth) → shapeId
// outerPts: Float64Array [x0,y0, x1,y1, ...] already wound CCW (caller
//   must ensure — matches makeWireFromPolygon wantCcw=true in primitives.js).
// holes: Array of Float64Array, each wound CW (wantCcw=false).
// centroid: subtracted from each point so the sketch origin is at (0,0).
// depth: extrusion along +Z (may be negative — handled by the prism direction).
Val MakeExtrude(Js& js) {
  F64 outer = js.f64(js[0]);
  Val holes        = js[1];
  double cx                = js.num(js[2]);
  double cy                = js.num(js[3]);
  double depth             = js.num(js[4]);
  // Optional exact curves: a Float64Array for the outer loop, an array of
  // them (or nulls) for the holes.
  Val outerCurves = js.argc() > 5 ? js[5] : nullptr;
  Val holeCurves = js.argc() > 6 ? js[6] : nullptr;

  EdgeRanges ranges;
  TopoDS_Face face = BuildProfileFace(js, outer, holes, cx, cy, outerCurves,
                                      holeCurves, &ranges);

  // Prism along +Z by depth (matches primitives.js: base at z=0, top at z=depth)
  gp_Vec dir(0, 0, depth);
  BRepPrimAPI_MakePrism prismMk(face, dir, false, true);
  if (!prismMk.IsDone())
    throw std::runtime_error("prism builder failed");

  // Persistent names, from creation provenance: base/top caps and one side
  // face per OUTER profile edge, indexed by the edge's position in the wire
  // (== the sketch line order the caller passed).  The names survive a
  // dimension edit — a resized profile re-extrudes to the same names, so a
  // face chamfer stays bound to `side{i}` / `top` rather than a coordinate.
  std::map<std::string, TopoDS_Shape> faces, edges;
  if (!prismMk.FirstShape().IsNull()) faces["bottom"] = prismMk.FirstShape();
  if (!prismMk.LastShape().IsNull()) faces["top"] = prismMk.LastShape();
  // Built from exact curves, one face stands for a run of polygon edges, and
  // takes every one of their names: a face picked as `side7` on the faceted
  // body of an older document finds the cylinder that facet became.
  for (const auto& [edge, range] : ranges) {
    for (const TopoDS_Shape& g : prismMk.Generated(edge)) {
      if (g.ShapeType() != TopAbs_FACE) continue;
      for (size_t k = 0; k < range.second; k++)
        faces["side" + std::to_string(range.first + k)] = g;
      break;
    }
  }
  TopoDS_Wire outerW = BRepTools::OuterWire(face);
  int ei = 0;
  for (TopExp_Explorer ex(outerW, TopAbs_EDGE);
       ranges.empty() && ex.More(); ex.Next(), ++ei) {
    const TopTools_ListOfShape& gen = prismMk.Generated(ex.Current());
    for (const TopoDS_Shape& g : gen) {
      if (g.ShapeType() == TopAbs_FACE) {
        faces["side" + std::to_string(ei)] = g;
        break;
      }
    }
  }
  edges = NameEdgesByFacePairs(prismMk.Shape(), faces);
  return js.makeNumber(StoreRecord(prismMk.Shape(), std::move(faces),
                                            std::move(edges)));
}

// A world-space 3D polyline [x0,y0,z0, ...] as a wire, closed or open, with
// its exact curves where `runs` gives them -- packed 15 numbers a run:
// start, count, kind, then 12.  kind 1 = circle arc, built through three of
// its own vertices (three points fix a circle, so no centre is needed in 3D);
// kind 2 = cubic bezier, its four poles in world space; kind 3 = an ellipse
// round a whole closed loop -- its centre, the world directions of its local
// x and y axes, and its two radii (three points don't fix an ellipse); kind
// 4 = a smooth curve through its own vertices.  Anything else, and a
// curve that can't be built, keeps its sampled segments.
static constexpr size_t kWorldRunWidth = 15;
static TopoDS_Wire BuildWorldCurveWire(const double* pts, size_t n,
                                       bool closed, const double* runs,
                                       size_t nRuns) {
  if (n < (closed ? 3u : 2u)) return TopoDS_Wire();
  const size_t nEdges = closed ? n : n - 1;
  auto P = [&](size_t i) {
    i %= n;
    return gp_Pnt(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  };
  std::vector<int> owner(nEdges, -1);
  for (size_t r = 0; r < nRuns; r++) {
    const double* q = runs + r * kWorldRunWidth;
    const size_t start = static_cast<size_t>(q[0]);
    const size_t count = static_cast<size_t>(q[1]);
    if (count == 0 || count > nEdges || start >= nEdges) continue;
    if (!closed && start + count > nEdges) continue;
    for (size_t k = 0; k < count; k++) owner[(start + k) % nEdges] = (int)r;
  }
  std::vector<TopoDS_Vertex> V(n);
  for (size_t i = 0; i < n; i++)
    V[i] = BRepBuilderAPI_MakeVertex(P(i)).Vertex();
  BRepBuilderAPI_MakeWire wireMk;
  auto straight = [&](size_t i) {
    if (P(i).Distance(P(i + 1)) > 1e-9)
      wireMk.Add(BRepBuilderAPI_MakeEdge(V[i % n], V[(i + 1) % n]).Edge());
  };
  auto arcThrough = [&](size_t a, size_t m, size_t b) {
    if (m == a || m == b) return TopoDS_Edge();
    GC_MakeArcOfCircle mk(P(a), P(m), P(b));
    if (!mk.IsDone()) return TopoDS_Edge();
    Handle(Geom_TrimmedCurve) arc = mk.Value();
    BRepBuilderAPI_MakeEdge e(arc, V[a % n], V[b % n]);
    return e.IsDone() ? e.Edge() : TopoDS_Edge();
  };
  // A circle round a whole closed loop: one closed edge through three of its
  // points, running the loop's way -- two arcs would split every face built
  // on it in two.
  if (closed && owner[0] >= 0 &&
      runs[owner[0] * kWorldRunWidth + 2] == 1 &&
      std::all_of(owner.begin(), owner.end(),
                  [&](int o) { return o == owner[0]; })) {
    GC_MakeCircle mk(P(0), P(n / 3), P((2 * n) / 3));
    if (mk.IsDone()) {
      Handle(Geom_Circle) circ = mk.Value();
      wireMk.Add(BRepBuilderAPI_MakeEdge(circ).Edge());
      if (wireMk.IsDone()) return wireMk.Wire();
    }
  }
  // An ellipse round a whole closed loop: one closed edge, run the loop's way.
  if (closed && owner[0] >= 0 &&
      runs[owner[0] * kWorldRunWidth + 2] == 3 &&
      std::all_of(owner.begin(), owner.end(),
                  [&](int o) { return o == owner[0]; })) {
    const double* q = runs + owner[0] * kWorldRunWidth + 3;
    gp_Pnt c(q[0], q[1], q[2]);
    gp_Vec ex(q[3], q[4], q[5]), ey(q[6], q[7], q[8]);
    const double rx = q[9], ry = q[10];
    gp_Vec nrm = ex.Crossed(ey);
    if (nrm.Magnitude() > 1e-12 && rx > 0 && ry > 0) {
      const bool wide = rx >= ry;
      gp_Elips el(gp_Ax2(c, gp_Dir(nrm), gp_Dir(wide ? ex : ey)),
                  wide ? rx : ry, wide ? ry : rx);
      TopoDS_Edge e = BRepBuilderAPI_MakeEdge(el).Edge();
      // The ellipse runs counter-clockwise about its normal; turn it when
      // the loop runs the other way.
      double turn = 0;
      for (size_t i = 0; i < n; i++)
        turn += gp_Vec(c, P(i)).Crossed(gp_Vec(c, P(i + 1))).Dot(nrm);
      if (turn < 0) e.Reverse();
      wireMk.Add(e);
      if (wireMk.IsDone()) return wireMk.Wire();
    }
  }
  size_t s0 = 0;
  if (closed)
    for (size_t i = 0; i < nEdges; i++)
      if (owner[i] != owner[(i + nEdges - 1) % nEdges]) {
        s0 = i;
        break;
      }
  for (size_t k = 0; k < nEdges;) {
    const size_t i = (s0 + k) % nEdges;
    const int r = owner[i];
    if (r < 0) {
      straight(i);
      k++;
      continue;
    }
    size_t c = 0;
    while (k + c < nEdges && owner[(s0 + k + c) % nEdges] == r) c++;
    const double* q = runs + r * kWorldRunWidth;
    TopoDS_Edge e;
    if (q[2] == 1) {
      e = arcThrough(i, i + c / 2, i + c);
    } else if (q[2] == 4) {
      std::vector<gp_Pnt> through;
      for (size_t j = 0; j <= c; j++) through.push_back(P(i + j));
      e = SmoothEdgeThrough(through, V[i % n], V[(i + c) % n]);
    } else if (q[2] == 2) {
      TColgp_Array1OfPnt poles(1, 4);
      for (int j = 0; j < 4; j++)
        poles.SetValue(j + 1, gp_Pnt(q[3 + 3 * j], q[4 + 3 * j], q[5 + 3 * j]));
      if (P(i).Distance(poles(1)) > P(i).Distance(poles(4))) {
        TColgp_Array1OfPnt rev(1, 4);
        for (int j = 1; j <= 4; j++) rev.SetValue(j, poles(5 - j));
        poles = rev;
      }
      Handle(Geom_BezierCurve) bez = new Geom_BezierCurve(poles);
      BRepBuilderAPI_MakeEdge mk(bez, V[i % n], V[(i + c) % n]);
      if (mk.IsDone()) e = mk.Edge();
    }
    if (e.IsNull())
      for (size_t j = 0; j < c; j++) straight(i + j);
    else
      wireMk.Add(e);
    k += c;
  }
  return wireMk.IsDone() ? wireMk.Wire() : TopoDS_Wire();
}

// A world-space polyline argument as a wire, from its curves when `curves`
// holds any.
static TopoDS_Wire WorldWireArg(Js& js, const F64& pts, Val curves,
                                bool closed) {
  const double* runs = nullptr;
  size_t nRuns = 0;
  F64 packed;
  if (curves != nullptr && js.isTypedArray(curves)) {
    packed = js.f64(curves);
    runs = packed.Data();
    nRuns = packed.ElementLength() / kWorldRunWidth;
  }
  return BuildWorldCurveWire(pts.Data(), pts.ElementLength() / 3, closed,
                             runs, nRuns);
}

// makeRevolve(outerPts, holes, cx, cy, ax1, ay1, ax2, ay2, angleRad, prismSides)
//   → shapeId
// Revolve the profile around the sketch-local axis through (ax1,ay1)-(ax2,ay2).
// prismSides <= 0 → smooth surface of revolution (BRepPrimAPI_MakeRevol).
// prismSides >= 3 → faceted "prism" sweep: the angle is split into N ruled
//   segments (loft the profile wire between successive rotations) fused into one
//   solid, giving N flat sides.
Val MakeRevolve(Js& js) {
  F64 outer = js.f64(js[0]);
  Val holes        = js[1];
  double cx  = js.num(js[2]), cy  = js.num(js[3]);
  // Axis endpoints in the profile sketch's frame (3D — the axis may come from
  // a different, non-coplanar sketch, so a z component is allowed).
  double ax1 = js.num(js[4]), ay1 = js.num(js[5]), az1 = js.num(js[6]);
  double ax2 = js.num(js[7]), ay2 = js.num(js[8]), az2 = js.num(js[9]);
  double angleRad = js.num(js[10], 2 * M_PI);
  int prismSides =
      js.isNumber(js[11]) ? js.int32(js[11]) : 0;
  // Axial advance per full turn (helical/coil sweep).  0 → a flat revolve.
  double pitch = js.num(js[12], 0.0);
  Val outerCurves = js.argc() > 13 ? js[13] : nullptr;
  Val holeCurves = js.argc() > 14 ? js[14] : nullptr;

  double dx = ax2 - ax1, dy = ay2 - ay1, dz = az2 - az1;
  double len = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) throw std::runtime_error("revolve axis is degenerate");
  gp_Dir axisDir(dx / len, dy / len, dz / len);
  // Axis in the centroid-local frame the profile is built in (x/y centroid-
  // subtracted to match the face; z carried through as-is).
  gp_Ax1 axis(gp_Pnt(ax1 - cx, ay1 - cy, az1), axisDir);

  // Helical sweep: thread the profile through one multi-section loft, each
  // section rotated about the axis AND advanced along it by the pitch.  Used
  // whenever a non-zero offset/turn is set (the only way to exceed a full
  // turn meaningfully).  Outer boundary only (holes aren't lofted).
  if (std::abs(pitch) > 1e-9) {
    TopoDS_Wire base = LoopWire(js, outer, outerCurves, cx, cy);
    if (base.IsNull())
      throw std::runtime_error("revolve profile wire builder failed");
    const int perTurn = prismSides >= 3 ? prismSides : 24;
    int steps = (int)std::ceil(perTurn * std::abs(angleRad) / (2 * M_PI));
    if (steps < 2) steps = 2;
    BRepOffsetAPI_ThruSections loft(Standard_True /*solid*/,
                                    prismSides >= 3 /*ruled vs smooth*/);
    for (int k = 0; k <= steps; k++) {
      double a = angleRad * k / steps;
      double off = pitch * a / (2 * M_PI);
      gp_Trsf rot;
      rot.SetRotation(axis, a);
      gp_Trsf tr;
      tr.SetTranslation(
          gp_Vec(axisDir.X() * off, axisDir.Y() * off, axisDir.Z() * off));
      TopoDS_Wire w = TopoDS::Wire(
          BRepBuilderAPI_Transform(base, tr.Multiplied(rot), true).Shape());
      loft.AddWire(w);
    }
    loft.Build(CancelRange());
    if (!loft.IsDone()) throw std::runtime_error("helical revolve failed");
    return js.makeNumber(StoreShape(loft.Shape()));
  }

  // A flat revolve can't exceed a full turn — extra rotations would overlap.
  if (angleRad > 2 * M_PI) angleRad = 2 * M_PI;

  if (prismSides >= 3) {
    TopoDS_Wire base = LoopWire(js, outer, outerCurves, cx, cy);
    if (base.IsNull())
      throw std::runtime_error("revolve profile wire builder failed");
    // Fuse N ruled wedges (each a loft between two successive rotations of the
    // profile) into one faceted solid.  Fuzzy fuse + unify weld the seams, the
    // same recipe BooleanOp's union path uses.
    const Standard_Real kFuzzy = 1.0e-5;
    TopoDS_Shape result;
    bool haveResult = false;
    for (int k = 0; k < prismSides; k++) {
      double a0 = angleRad * k / prismSides;
      double a1 = angleRad * (k + 1) / prismSides;
      gp_Trsf t0, t1;
      t0.SetRotation(axis, a0);
      t1.SetRotation(axis, a1);
      TopoDS_Wire w0 =
          TopoDS::Wire(BRepBuilderAPI_Transform(base, t0, true).Shape());
      TopoDS_Wire w1 =
          TopoDS::Wire(BRepBuilderAPI_Transform(base, t1, true).Shape());
      BRepOffsetAPI_ThruSections seg(Standard_True, Standard_True);
      seg.AddWire(w0);
      seg.AddWire(w1);
      seg.Build();
      if (!seg.IsDone()) continue;
      TopoDS_Shape wedge = seg.Shape();
      if (!haveResult) {
        result = wedge;
        haveResult = true;
      } else {
        BRepAlgoAPI_Fuse fuse(result, wedge);
        fuse.SetFuzzyValue(kFuzzy);
        fuse.Build(CancelRange());
        if (fuse.IsDone()) result = fuse.Shape();
      }
    }
    if (!haveResult)
      throw std::runtime_error("prism revolve produced no geometry");
    try {
      ShapeUpgrade_UnifySameDomain unifier(result, Standard_True,
                                           Standard_True, Standard_True);
      unifier.Build();
      result = unifier.Shape();
    } catch (const std::exception&) {
      // keep the un-unified fuse result
    }
    return js.makeNumber(StoreShape(result));
  }

  TopoDS_Face face =
      BuildProfileFace(js, outer, holes, cx, cy, outerCurves, holeCurves);
  BRepPrimAPI_MakeRevol rev(face, axis, angleRad);
  if (!rev.IsDone())
    throw std::runtime_error(
        "revolve failed — the axis may cross the profile");
  return js.makeNumber(StoreShape(rev.Shape()));
}

// makePipe(outer, holes, cx, cy, pathPts, twistTurns, autoRotate) → shapeId
// Sweep the 2D profile cross-section along the world-space path polyline
// `pathPts` ([x0,y0,z0, x1,y1,z1, ...], >= 2 points).  twistTurns spins the
// profile about the path that many full turns over the sweep; autoRotate keeps
// the section perpendicular to the local path tangent (so a curved path isn't
// flattened).  With both off this is the plain start-oriented pipe.
Val MakePipe(Js& js) {
  F64 outer = js.f64(js[0]);
  Val holes        = js[1];
  double cx = js.num(js[2]), cy = js.num(js[3]);
  F64 path = js.f64(js[4]);
  double twistTurns = js.num(js[5], 0.0);
  bool autoRotate =
      js.isBoolean(js[6]) ? js.boolean(js[6]) : false;
  Val outerCurves = js.argc() > 7 ? js[7] : nullptr;
  Val holeCurves = js.argc() > 8 ? js[8] : nullptr;
  // The path's exact curves, in world space (BuildWorldCurveWire).
  Val pathCurves = js.argc() > 9 ? js[9] : nullptr;
  size_t nPath = path.ElementLength() / 3;
  if (nPath < 2) throw std::runtime_error("pipe path needs at least 2 points");

  const bool custom = std::abs(twistTurns) > 1e-9 || autoRotate;
  // A path given its exact curves is swept along them, not along its points.
  const bool exactPath = pathCurves != nullptr && js.isTypedArray(pathCurves);
  // A path that ends where it starts (a circle) is a closed spine.
  const gp_Pnt pathEnd(path[3 * (nPath - 1)], path[3 * (nPath - 1) + 1],
                       path[3 * (nPath - 1) + 2]);
  const bool closedPath =
      nPath >= 4 && gp_Pnt(path[0], path[1], path[2]).Distance(pathEnd) < 1e-9;
  auto spineWire = [&]() {
    F64 packed;
    const double* runs = nullptr;
    size_t nRuns = 0;
    if (exactPath) {
      packed = js.f64(pathCurves);
      runs = packed.Data();
      nRuns = packed.ElementLength() / kWorldRunWidth;
    }
    return BuildWorldCurveWire(path.Data(), closedPath ? nPath - 1 : nPath,
                               closedPath, runs, nRuns);
  };
  // The spine's start point and true tangent there (a chord to the first
  // sample would tilt the profile off a curved spine).
  auto spineStart = [&](const TopoDS_Wire& spine, gp_Pnt& p, gp_Dir& d) {
    BRepAdaptor_CompCurve cc(spine);
    gp_Vec v;
    cc.D1(cc.FirstParameter(), p, v);
    if (v.Magnitude() < 1e-12) return false;
    d = gp_Dir(v);
    return true;
  };

  if (!custom) {
    // Plain pipe: spine + a single start-oriented profile.
    TopoDS_Wire spine =
        exactPath ? spineWire() : WorldWireArg(js, path, pathCurves, false);
    if (spine.IsNull()) throw std::runtime_error("pipe path wire failed");
    TopoDS_Face face =
        BuildProfileFace(js, outer, holes, cx, cy, outerCurves, holeCurves);
    gp_Pnt p0(path[0], path[1], path[2]);
    gp_Dir tangent(path[3] - path[0], path[4] - path[1], path[5] - path[2]);
    if (exactPath) spineStart(spine, p0, tangent);
    gp_Trsf place;
    place.SetTransformation(gp_Ax3(p0, tangent));
    place.Invert();
    TopoDS_Face placed =
        TopoDS::Face(BRepBuilderAPI_Transform(face, place, true).Shape());
    BRepOffsetAPI_MakePipe pipe(spine, placed);
    pipe.Build(CancelRange());
    if (!pipe.IsDone()) throw std::runtime_error("pipe sweep failed");
    return js.makeNumber(StoreShape(pipe.Shape()));
  }

  // Auto-rotate or twist: a loft through sections square to the path.  An
  // exact sweep (MakePipeShell, corrected Frenet) was tried for auto-rotate
  // alone and measured WORSE: its wall strayed 1.4e-4 mm from the true path
  // against 1.1e-5 mm for this loft with its sections on the exact spine.
  // Twist / auto-rotate: loft the profile through many sections, each placed
  // and oriented along the path (with a rotation-minimizing frame when
  // auto-rotating) and twisted progressively.  Along an exact path the
  // sections sit on the spine itself, with its true tangents.

  // De-dup the raw path points.
  std::vector<gp_Pnt> raw;
  raw.push_back(gp_Pnt(path[0], path[1], path[2]));
  for (size_t i = 1; i < nPath; i++) {
    gp_Pnt p(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
    if (p.Distance(raw.back()) > 1e-9) raw.push_back(p);
  }
  if (raw.size() < 2) throw std::runtime_error("pipe path is degenerate");

  // Resample evenly by arc length — denser when there's more twist to show.
  int minSec = (int)raw.size();
  int twistSec = (int)std::ceil(24.0 * std::abs(twistTurns)) + 1;
  int n = minSec > twistSec ? minSec : twistSec;
  if (n < 2) n = 2;
  std::vector<double> cum(raw.size(), 0.0);
  for (size_t i = 1; i < raw.size(); i++)
    cum[i] = cum[i - 1] + raw[i].Distance(raw[i - 1]);
  double total = cum.back();
  if (total < 1e-9) throw std::runtime_error("pipe path has zero length");
  std::vector<gp_Pnt> pts(n);
  for (int k = 0; k < n; k++) {
    double s = total * k / (n - 1);
    size_t i = 1;
    while (i < raw.size() && cum[i] < s) i++;
    if (i >= raw.size()) { pts[k] = raw.back(); continue; }
    double segLen = cum[i] - cum[i - 1];
    double t = segLen > 1e-12 ? (s - cum[i - 1]) / segLen : 0.0;
    pts[k] = gp_Pnt(raw[i - 1].X() + (raw[i].X() - raw[i - 1].X()) * t,
                    raw[i - 1].Y() + (raw[i].Y() - raw[i - 1].Y()) * t,
                    raw[i - 1].Z() + (raw[i].Z() - raw[i - 1].Z()) * t);
  }

  std::vector<gp_Dir> exactTangent;
  if (exactPath) {
    TopoDS_Wire spine = spineWire();
    if (!spine.IsNull()) {
      BRepAdaptor_CompCurve cc(spine);
      const double len = GCPnts_AbscissaPoint::Length(cc);
      // All or nothing: a section the curve can't place keeps the sampled
      // path for every section, never a mix of the two.
      std::vector<gp_Pnt> onSpine;
      for (int k = 0; k < n && len > 1e-12; k++) {
        GCPnts_AbscissaPoint at(cc, len * k / (n - 1), cc.FirstParameter());
        if (!at.IsDone()) break;
        gp_Pnt p;
        gp_Vec v;
        cc.D1(at.Parameter(), p, v);
        onSpine.push_back(p);
        exactTangent.push_back(v.Magnitude() > 1e-12 ? gp_Dir(v)
                                                     : gp_Dir(1, 0, 0));
      }
      if ((int)onSpine.size() == n)
        pts = onSpine;
      else
        exactTangent.clear();
    }
  }
  auto tangentAt = [&](int i) -> gp_Dir {
    if ((int)exactTangent.size() == n) return exactTangent[i];
    gp_Pnt a = pts[i > 0 ? i - 1 : 0];
    gp_Pnt b = pts[i < n - 1 ? i + 1 : n - 1];
    gp_Vec v(a, b);
    if (v.Magnitude() < 1e-9) return gp_Dir(1, 0, 0);
    return gp_Dir(v);
  };

  TopoDS_Wire base = LoopWire(js, outer, outerCurves, cx, cy);
  if (base.IsNull())
    throw std::runtime_error("pipe profile wire builder failed");

  gp_Dir Z0 = tangentAt(0);
  gp_Dir Xcur = gp_Ax2(pts[0], Z0).XDirection();
  gp_Dir Zprev = Z0;

  BRepOffsetAPI_ThruSections loft(Standard_True, Standard_False);
  // An exact profile can be one closed edge (a circle) whose single vertex
  // the compatibility pass can't match between sections -- the twisted loft
  // failed outright.  The sections are copies of one wire, already matched.
  if (outerCurves != nullptr && js.isTypedArray(outerCurves))
    loft.CheckCompatibility(Standard_False);
  for (int k = 0; k < n; k++) {
    gp_Dir Z = autoRotate ? tangentAt(k) : Z0;
    if (autoRotate && k > 0) {
      // Rotation-minimizing frame: carry X across the tangent's turn.
      gp_Vec cr = gp_Vec(Zprev).Crossed(gp_Vec(Z));
      double sn = cr.Magnitude();
      if (sn > 1e-9) {
        double ang = std::atan2(sn, gp_Vec(Zprev).Dot(gp_Vec(Z)));
        Xcur = Xcur.Rotated(gp_Ax1(gp::Origin(), gp_Dir(cr)), ang);
      }
    }
    Zprev = Z;
    double theta = twistTurns * 2 * M_PI * (n > 1 ? (double)k / (n - 1) : 0.0);
    gp_Dir Xk = std::abs(theta) > 1e-12
                    ? Xcur.Rotated(gp_Ax1(gp::Origin(), Z), theta)
                    : Xcur;
    gp_Trsf place;
    place.SetTransformation(gp_Ax3(pts[k], Z, Xk));
    place.Invert();
    loft.AddWire(
        TopoDS::Wire(BRepBuilderAPI_Transform(base, place, true).Shape()));
  }
  loft.Build(CancelRange());
  if (!loft.IsDone()) throw std::runtime_error("pipe sweep (twist) failed");
  return js.makeNumber(StoreShape(loft.Shape()));
}

// makeLoft(wireAPts, wireBPts) → shapeId
// Loft a smooth solid between two world-space closed profiles (each a flat 3D
// polyline).  The caller positions both loops on their own sketch planes, so
// this just threads them through BRepOffsetAPI_ThruSections.  Holes aren't
// supported (outer boundaries only).
Val MakeLoft(Js& js) {
  F64 a = js.f64(js[0]);
  F64 b = js.f64(js[1]);
  // Optional exact curves of each profile, in world space.
  TopoDS_Wire wa = WorldWireArg(js, a, js.argc() > 2 ? js[2] : nullptr, true);
  TopoDS_Wire wb = WorldWireArg(js, b, js.argc() > 3 ? js[3] : nullptr, true);
  if (wa.IsNull() || wb.IsNull())
    throw std::runtime_error("loft needs two closed profiles");
  BRepOffsetAPI_ThruSections loft(Standard_True /*solid*/,
                                  Standard_False /*ruled → smooth*/);
  loft.AddWire(wa);
  loft.AddWire(wb);
  loft.Build(CancelRange());
  if (!loft.IsDone()) throw std::runtime_error("loft failed");
  return js.makeNumber(StoreShape(loft.Shape()));
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — transforms
// ════════════════════════════════════════════════════════════════════════

// transformShape(id, tx, ty, tz, rx, ry, rz) → newShapeId
// Applies T·Rz·Ry·Rx, matching operations.js transformShape().
Val TransformShape(Js& js) {
  int id    = js.int32(js[0]);
  double tx = js.num(js[1]), ty = js.num(js[2]), tz = js.num(js[3]);
  double rx = js.num(js[4]), ry = js.num(js[5]), rz = js.num(js[6]);
  ShapeRecord rec = FetchRecord(id);
  gp_Trsf trsf = BuildTransform(tx, ty, tz, rx, ry, rz);
  BRepBuilderAPI_Transform mk(rec.shape, trsf, true);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), RemapFaceNames(mk, rec.faces)));
}

// mirrorShape(id, ox,oy,oz, nx,ny,nz) → newShapeId
// Reflect a shape across the plane through (o) with normal (n).
Val MirrorShape(Js& js) {
  int id = js.int32(js[0]);
  double ox = js.num(js[1]), oy = js.num(js[2]), oz = js.num(js[3]);
  double nx = js.num(js[4]), ny = js.num(js[5]), nz = js.num(js[6]);
  double len = std::sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-9) throw std::runtime_error("mirror plane normal is degenerate");
  ShapeRecord rec = FetchRecord(id);
  gp_Trsf trsf;
  trsf.SetMirror(gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(nx / len, ny / len, nz / len)));
  BRepBuilderAPI_Transform mk(rec.shape, trsf, true);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), RemapFaceNames(mk, rec.faces)));
}

// rotateShapeAxis(id, ox,oy,oz, dx,dy,dz, angleRad) → newShapeId
// Rotate a shape about the axis through (o) along direction (d).
Val RotateShapeAxis(Js& js) {
  int id = js.int32(js[0]);
  double ox = js.num(js[1]), oy = js.num(js[2]), oz = js.num(js[3]);
  double dx = js.num(js[4]), dy = js.num(js[5]), dz = js.num(js[6]);
  double angle = js.num(js[7], 0.0);
  double len = std::sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) throw std::runtime_error("rotation axis is degenerate");
  ShapeRecord rec = FetchRecord(id);
  gp_Trsf trsf;
  trsf.SetRotation(gp_Ax1(gp_Pnt(ox, oy, oz), gp_Dir(dx / len, dy / len, dz / len)), angle);
  BRepBuilderAPI_Transform mk(rec.shape, trsf, true);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), RemapFaceNames(mk, rec.faces)));
}

// scaleShape(id, factor) → newShapeId
Val ScaleShape(Js& js) {
  int id       = js.int32(js[0]);
  double scale = js.num(js[1], 1.0);
  ShapeRecord rec = FetchRecord(id);
  gp_Trsf trsf;
  trsf.SetScaleFactor(scale);
  BRepBuilderAPI_Transform mk(rec.shape, trsf, true);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), RemapFaceNames(mk, rec.faces)));
}

// scaleShapeXYZ(id, sx, sy, sz) → newShapeId
// Non-uniform scale about the origin in the shape's local frame (a per-axis
// stretch), via an affine gp_GTrsf.  Used so a boolean/split input rebuilds at
// the size the user stretched it to; uniform scales can still use ScaleShape.
Val ScaleShapeXYZ(Js& js) {
  int id      = js.int32(js[0]);
  double sx   = js.num(js[1], 1.0);
  double sy   = js.num(js[2], 1.0);
  double sz   = js.num(js[3], 1.0);
  ShapeRecord rec = FetchRecord(id);
  gp_GTrsf gt;
  gt.SetVectorialPart(gp_Mat(sx, 0, 0, 0, sy, 0, 0, 0, sz));
  BRepBuilderAPI_GTransform mk(rec.shape, gt, true);
  return js.makeNumber(StoreNamedSolid(mk.Shape(), RemapFaceNames(mk, rec.faces)));
}

}  // namespace occ
