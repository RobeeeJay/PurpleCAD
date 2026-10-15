#include "occ_core.h"

namespace occ {

// A chamfer or fillet bigger than the material it runs into -- two bevels
// meeting across a tooth tip narrower than twice the distance, say -- can come
// back from MakeChamfer / MakeFillet as IsDone() with a solid whose faces
// overlap and whose surface isn't closed.  Tessellated, that shows as
// triangles spanning the air between features.  Treat it as the failure it is,
// so the next attempt runs and, failing all, the user gets the "try a smaller
// distance" error instead of a broken solid.
//
// Its own type so the retries below are skipped: they exist for sliver faces
// and hairline seams that make OCC refuse, and cannot shrink a distance that
// is simply too big -- on a many-edged rim each retry is another full bevel,
// and the refusal took 48 s with them.
struct InvalidBevel : std::runtime_error {
  using std::runtime_error::runtime_error;
};

// Did the bevel break the body?  Judged against the user's body as it was,
// not against an ideal: an imported mesh can arrive already failing BRepCheck
// or with a sliver gap in its surface (MultiSystem2's base has 3 open edges,
// from degenerate triangles a Split left in its mesh), and holding the result
// to a standard its source never met refused EVERY chamfer on it, at any size.
// Nor against the merged copy a retry bevels: merging can itself open the
// mesh (3 open edges to 7 on that base).  A bevel that makes the body worse --
// the broken bevels this check exists for open hundreds of edges -- is still
// refused.
static bool BevelBrokeBody(const TopoDS_Shape& result,
                           const TopoDS_Shape& source) {
  const bool valid = BRepCheck_Analyzer(result).IsValid();
  const long open = OpenEdgeCount(result, 0.01);
  if (valid && open == 0) return false;
  if (open < 0) return true;
  if (!valid && BRepCheck_Analyzer(source).IsValid()) return true;
  const long sourceOpen = OpenEdgeCount(source, 0.01);
  return sourceOpen < 0 || open > sourceOpen;
}
static const TopoDS_Shape& RequireValidBevel(const TopoDS_Shape& result,
                                             const char* what,
                                             const TopoDS_Shape& source) {
  if (BevelBrokeBody(result, source))
  {
    const std::string size =
        std::string(what) == "fillet" ? "radius" : "distance";
    throw InvalidBevel("The " + std::string(what) + " doesn't fit here — try "
                       "a smaller " + size + ".");
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — boolean operations
// ════════════════════════════════════════════════════════════════════════

// booleanOp(shapeIds: number[], operation: "union"|"difference"|"intersection")
// → newShapeId
Val BooleanOp(Js& js) {
  Val ids = js[0];
  std::string op  = js.string(js[1]);
  if (js.length(ids) < 2)
    throw std::runtime_error("booleanOp requires at least 2 shape ids");

  // A small fuzzy value lets the fuse weld hairline gaps where independently
  // built solids touch (e.g. several extruded parts that abut) — each prism is
  // built in its own centroid-local frame and transformed back, so shared
  // faces aren't bit-for-bit coincident.  Value is in scene units (1 = 10 mm),
  // i.e. ~1e-4 mm: far above float round-off, far below any real feature.
  const Standard_Real kFuzzy = 1.0e-5;

  // A tool can be a COMPOUND of several solids (a sewn multi-letter emboss
  // stamp).  BRepAlgoAPI_Fuse's two-shape constructor silently DROPS a
  // compound tool (the union comes back as just the body — "missing
  // letters"), so explode compounds into the BOP tools list instead.
  auto appendSolids = [](const TopoDS_Shape& s, TopTools_ListOfShape& into) {
    if (s.ShapeType() == TopAbs_COMPOUND) {
      bool any = false;
      for (TopExp_Explorer ex(s, TopAbs_SOLID); ex.More(); ex.Next()) {
        into.Append(ex.Current());
        any = true;
      }
      if (any) return;
    }
    into.Append(s);
  };

  TopoDS_Shape result = FetchShape(js.int32(js.at(ids, 0)));
  for (uint32_t i = 1; i < js.length(ids); i++) {
    TopoDS_Shape tool = FetchShape(js.int32(js.at(ids, i)));
    TopTools_ListOfShape args, tools;
    appendSolids(result, args);
    appendSolids(tool, tools);
    if (op == "union") {
      BRepAlgoAPI_Fuse fuse;
      fuse.SetArguments(args);
      fuse.SetTools(tools);
      fuse.SetFuzzyValue(kFuzzy);
      fuse.Build(CancelRange());
      result = fuse.Shape();
    } else if (op == "difference") {
      BRepAlgoAPI_Cut cut;
      cut.SetArguments(args);
      cut.SetTools(tools);
      cut.Build(CancelRange());
      result = cut.Shape();
    } else if (op == "intersection") {
      BRepAlgoAPI_Common common;
      common.SetArguments(args);
      common.SetTools(tools);
      common.Build(CancelRange());
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
  // A build that was cancelled (or failed) leaves an empty shape.  Returning
  // its id as a result let a caller go on to mesh it, which faulted and took
  // the app down; 0 is the "no result" every caller already handles.
  if (result.IsNull()) return js.makeNumber(0);
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
  return js.makeNumber(StoreShape(result));
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — chamfer / fillet
// ════════════════════════════════════════════════════════════════════════

// chamferShape(id, subGeo, amount, angleRad) → newShapeId
// subGeo: { edges?: [{ax,ay,az,bx,by,bz}], faces?: [{nx,ny,nz,cx?,cy?,cz?}] }
// Mirrors chamferShapeBy() from operations.js exactly.
Val ChamferShape(Js& js) {
  int id          = js.int32(js[0]);
  Val sg = js[1];
  double amount   = js.num(js[2], 0.05);
  bool useAngle   = !js.isNull(js[3]) && !js.isUndefined(js[3]) &&
                    js.isNumber(js[3]) && std::isfinite(js.num(js[3]));
  double angleRad = useAngle ? js.num(js[3]) : 0.0;

  ShapeRecord rec = FetchRecord(id);
  const TopoDS_Shape& shape = rec.shape;
  EdgeFaceSpec spec  = ParseSubGeo(js, sg);
  if (spec.edges.empty() && spec.faces.empty()) {
    // Nothing to do — return the same shape
    return js.makeNumber(StoreShape(shape));
  }

  // Build the chamfer on a given shape.  A null return means no edges
  // matched (sentinel); a throw means a genuine computation failure.
  std::map<std::string, TopoDS_Shape> resultFaces;
  auto attempt = [&](const TopoDS_Shape& s) -> TopoDS_Shape {
    BRepFilletAPI_MakeChamfer mk(s);
    auto selected = SelectSubGeoEdges(s, spec, &rec.faces, &rec.edges);
    if (selected.empty()) return TopoDS_Shape();
    for (const auto& se : selected) {
      if (useAngle && !se.refFace.IsNull())
        mk.AddDA(amount, angleRad, se.edge, se.refFace);
      else
        mk.Add(amount, se.edge);
    }
    mk.Build(CancelRange());
    if (!mk.IsDone())
      throw std::runtime_error(
        "chamfer computation failed (geometry rejected the operation)");
    RequireValidBevel(mk.Shape(), "chamfer", shape);
    // Carry names forward from the original faces — only valid on the primary
    // attempt (chamfering `shape` itself).  A unified-copy retry loses subshape
    // identity, so names don't propagate there and the result falls back to
    // coordinate selection.
    resultFaces = s.IsSame(shape)
                      ? PropagateFaceNames(mk, mk.Shape(), rec.faces)
                      : std::map<std::string, TopoDS_Shape>{};
    return mk.Shape();
  };

  // Fallback: chamfer the boundary of the FACE the selected edges bound.
  // A rim whose individual edges OCC rejects (a thin ring at coarse preview
  // tessellation) usually succeeds as the face's rim — and yields a clean
  // solid, so a downstream emboss builds fast instead of on a slow mesh-sew.
  // ONLY the wire(s) the selection actually lies on: a holed face (a ring's
  // top cap) has separate inner and outer boundary wires, and feeding ALL the
  // face's edges bevelled the never-selected inner rim too (the "high-res
  // chamfers both rings" bug).
  auto attemptFaceRim = [&](const TopoDS_Shape& s) -> TopoDS_Shape {
    auto selected = SelectSubGeoEdges(s, spec, &rec.faces, &rec.edges);
    if (selected.empty()) return TopoDS_Shape();
    TopoDS_Face face = MostCommonAdjacentFace(s, selected);
    if (face.IsNull()) return TopoDS_Shape();
    BRepFilletAPI_MakeChamfer mk(s);
    int n = 0;
    TopTools_IndexedMapOfShape added;
    for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
      bool wireSelected = false;
      for (TopExp_Explorer e(w.Current(), TopAbs_EDGE);
           e.More() && !wireSelected; e.Next())
        for (const auto& se : selected)
          if (e.Current().IsSame(se.edge)) {
            wireSelected = true;
            break;
          }
      if (!wireSelected) continue;
      for (TopExp_Explorer e(w.Current(), TopAbs_EDGE); e.More(); e.Next()) {
        if (added.Contains(e.Current())) continue; // seam edges appear twice
        added.Add(e.Current());
        mk.Add(amount, TopoDS::Edge(e.Current()));
        ++n;
      }
    }
    if (n == 0) return TopoDS_Shape();
    mk.Build(CancelRange());
    if (!mk.IsDone()) return TopoDS_Shape();
    // An invalid rim bevel is no better a fallback than none.
    if (BevelBrokeBody(mk.Shape(), shape)) return TopoDS_Shape();
    resultFaces = s.IsSame(shape)
                      ? PropagateFaceNames(mk, mk.Shape(), rec.faces)
                      : std::map<std::string, TopoDS_Shape>{};
    return mk.Shape();
  };

  try {
    TopoDS_Shape result;
    try {
      result = attempt(shape);
    } catch (const InvalidBevel&) {
      throw;
    } catch (const std::exception&) {
      // Retry on a same-domain-unified copy.  Booleans / shell / timeline
      // regeneration can leave sliver coplanar faces and hairline seams that
      // MakeChamfer rejects even when the distance is small — the very
      // artefacts the union path unifies away up front.  Merging them into
      // clean single faces lets the chamfer run; if it still fails it's a
      // real limit and the outer catch reports it.
      TopoDS_Shape unified = shape;
      try {
        ShapeUpgrade_UnifySameDomain u(shape, Standard_True, Standard_True,
                                       Standard_True);
        u.Build();
        unified = u.Shape();
      } catch (...) { /* keep the original if unify throws */ }
      try {
        result = attempt(unified);
      } catch (const InvalidBevel&) {
        throw;
      } catch (const std::exception&) {
        // Last resort: the face-rim fallback (see above).  Null → the outer
        // catch reports the original rejection.
        result = attemptFaceRim(shape);
        if (result.IsNull()) result = attemptFaceRim(unified);
        if (result.IsNull())
          throw std::runtime_error(
              "chamfer computation failed (geometry rejected the operation)");
      }
    }
    // 0 = sentinel "no edges matched" — the bridge throws a descriptive error.
    if (result.IsNull()) return js.makeNumber(0);
    return js.makeNumber(StoreNamedSolid(result, resultFaces));
  } catch (const InvalidBevel& e) {
    // The cause is known and already says what to do -- no wrapper.
    throw std::runtime_error(e.what());
  } catch (const std::exception& e) {
    // Two common causes, and the distance being small rules out neither:
    //  - the distance exceeds the material the chamfer runs into (e.g. wider
    //    than a hollow body's wall), or
    //  - the selected edges meet in a way OCC can't bevel together (adjacent
    //    edges around a tight ring, a seam, or a near-tangent join).
    // The user sees one short line under the dialog; OCC's own reason goes
    // to the log for whoever debugs it.
    fprintf(stderr, "[occ] chamfer failed: %s\n", e.what());
    throw std::runtime_error(
        "Chamfer failed — try a smaller distance, fewer edges, or the whole "
        "face.");
  }
}

// filletShape(id, subGeo, radius) → newShapeId
// Mirrors filletShapeBy() from operations.js.
Val FilletShape(Js& js) {
  int id        = js.int32(js[0]);
  Val sg = js[1];
  double radius = js.num(js[2], 0.05);

  ShapeRecord rec = FetchRecord(id);
  const TopoDS_Shape& shape = rec.shape;
  EdgeFaceSpec spec  = ParseSubGeo(js, sg);
  if (spec.edges.empty() && spec.faces.empty()) {
    return js.makeNumber(StoreShape(shape));
  }

  // Null return = no edges matched (sentinel); throw = computation failure.
  auto attempt = [&](const TopoDS_Shape& s) -> TopoDS_Shape {
    BRepFilletAPI_MakeFillet mk(s, ChFi3d_Rational);
    auto selected = SelectSubGeoEdges(s, spec, &rec.faces, &rec.edges);
    if (selected.empty()) return TopoDS_Shape();
    for (const auto& se : selected) mk.Add(radius, se.edge);
    mk.Build(CancelRange());
    if (!mk.IsDone())
      throw std::runtime_error(
        "fillet computation failed (geometry rejected the operation)");
    return RequireValidBevel(mk.Shape(), "fillet", shape);
  };

  try {
    TopoDS_Shape result;
    try {
      result = attempt(shape);
    } catch (const InvalidBevel&) {
      throw;
    } catch (const std::exception&) {
      // Retry on a same-domain-unified copy — see ChamferShape.  Sliver
      // coplanar faces / hairline seams left by booleans, shell or timeline
      // regeneration make MakeFillet reject an otherwise-valid radius.
      TopoDS_Shape unified = shape;
      try {
        ShapeUpgrade_UnifySameDomain u(shape, Standard_True, Standard_True,
                                       Standard_True);
        u.Build();
        unified = u.Shape();
      } catch (...) { /* keep the original if unify throws */ }
      result = attempt(unified);
    }
    if (result.IsNull()) return js.makeNumber(0);
    return js.makeNumber(StoreShape(result));
  } catch (const InvalidBevel& e) {
    throw std::runtime_error(e.what());
  } catch (const std::exception& e) {
    // Same two causes as chamfer (see ChamferShape): too-large radius for the
    // material, or a set of edges OCC can't roll together — a small radius
    // rules out neither.
    fprintf(stderr, "[occ] fillet failed: %s\n", e.what());
    throw std::runtime_error(
        "Fillet failed — try a smaller radius, fewer edges, or the whole "
        "face.");
  }
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
Val PushPullFaces(Js& js) {
  int id          = js.int32(js[0]);
  Val sg = js[1];
  double distance = js.num(js[2], 0.0);

  ShapeRecord rec = FetchRecord(id);
  const TopoDS_Shape& shape = rec.shape;
  EdgeFaceSpec spec  = ParseSubGeo(js, sg);
  // No faces, or a zero move — nothing to do; hand back the input unchanged.
  if (spec.faces.empty() || std::abs(distance) < 1e-9)
    return js.makeNumber(StoreShape(shape));

  auto faces = SelectSubGeoFaces(shape, spec, &rec.faces);
  // 0 = sentinel "no faces matched" — the JS bridge turns this into a
  // descriptive error (same convention as chamfer/fillet).
  if (faces.empty()) return js.makeNumber(0);

  // Faces that don't all face one way -- a bore's wall, a curved region taken
  // whole by curve detection -- can't each be swept along their own normal:
  // pushed, neighbouring prisms diverge and leave wedges of uncut material
  // between them; pulled, they overlap at every seam.  Offset them together
  // instead, so neighbouring faces are extended or trimmed to meet
  // (GeomAbs_Intersection), as a single face's prism does for its sides.
  bool oneWay = true;
  {
    FaceNormal n0 = ComputeFaceNormal(faces[0]);
    for (const auto& face : faces) {
      BRepAdaptor_Surface s(face, false);
      FaceNormal n = ComputeFaceNormal(face);
      if (s.GetType() != GeomAbs_Plane || !n.valid || !n0.valid ||
          std::abs(n.x - n0.x) + std::abs(n.y - n0.y) + std::abs(n.z - n0.z) >
              1e-6) {
        oneWay = false;
        break;
      }
    }
  }
  if (!oneWay) {
    try {
      BRepOffset_MakeOffset offset;
      offset.Initialize(shape, 0.0, 1.0e-5, BRepOffset_Skin, false, false,
                        GeomAbs_Intersection);
      for (const auto& face : faces) offset.SetOffsetOnFace(face, distance);
      offset.MakeOffsetShape(CancelRange());
      if (!offset.IsDone() || offset.Shape().IsNull())
        throw std::runtime_error("the faces could not be offset together");
      TopoDS_Shape moved = offset.Shape();
      // Skin offset of a solid hands back a solid inside a compound, or a
      // shell; push/pull returns a solid like the prism path.
      for (TopExp_Explorer ex(moved, TopAbs_SOLID); ex.More(); ex.Next()) {
        moved = ex.Current();
        break;
      }
      return js.makeNumber(StoreShape(moved));
    } catch (const std::exception& e) {
      throw std::runtime_error(
          std::string("Push/pull failed — try a smaller distance (") +
          e.what() + ")");
    }
  }

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
      prismMk.Build(CancelRange());
      if (!prismMk.IsDone()) continue;
      TopoDS_Shape prism = prismMk.Shape();
      if (pull) {
        BRepAlgoAPI_Fuse fuse(result, prism);
        fuse.SetFuzzyValue(kFuzzy);
        fuse.Build(CancelRange());
        if (!fuse.IsDone()) throw std::runtime_error("fuse rejected the prism");
        result = fuse.Shape();
      } else {
        BRepAlgoAPI_Cut cut(result, prism);
        cut.SetFuzzyValue(kFuzzy);
        cut.Build(CancelRange());
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
  return js.makeNumber(StoreShape(result));
}

// draftFaces(id, neutral{nx,ny,nz,cx,cy,cz}, subGeo, angleRad) → newShapeId
// Applies a draft (taper) to each selected face, pivoting it about its
// intersection with the NEUTRAL plane (the picked main face's plane) by
// `angleRad` along the pull direction (= the main face's normal).  Used for
// mould/cast draft.  0 = sentinel "operation rejected".
Val DraftFaces(Js& js) {
  int id               = js.int32(js[0]);
  Val neutral = js[1];
  Val sg      = js[2];
  double angle         = js.num(js[3], 0.0);

  ShapeRecord rec = FetchRecord(id);
  const TopoDS_Shape& shape = rec.shape;
  EdgeFaceSpec spec  = ParseSubGeo(js, sg);
  if (spec.faces.empty() || std::abs(angle) < 1e-9)
    return js.makeNumber(StoreShape(shape));

  double nx = js.num(js.get(neutral, "nx")), ny = js.num(js.get(neutral, "ny")),
         nz = js.num(js.get(neutral, "nz"));
  double cx = js.num(js.get(neutral, "cx")), cy = js.num(js.get(neutral, "cy")),
         cz = js.num(js.get(neutral, "cz"));
  gp_Vec nv(nx, ny, nz);
  if (nv.Magnitude() < 1e-9) return js.makeNumber(0);
  gp_Dir pullDir(nv);
  gp_Pln neutralPlane(gp_Pnt(cx, cy, cz), pullDir);

  auto faces = SelectSubGeoFaces(shape, spec, &rec.faces);
  if (faces.empty()) return js.makeNumber(0);

  try {
    BRepOffsetAPI_DraftAngle draft(shape);
    bool any = false;
    for (const auto& face : faces) {
      draft.Add(face, pullDir, angle, neutralPlane);
      if (draft.AddDone()) any = true;
      else draft.Remove(face);  // skip a face the draft can't take
    }
    if (!any) return js.makeNumber(0);
    draft.Build(CancelRange());
    if (!draft.IsDone()) return js.makeNumber(0);
    return js.makeNumber(StoreNamedSolid(draft.Shape(),
                        PropagateFaceNames(draft, draft.Shape(), rec.faces)));
  } catch (const std::exception& e) {
    throw std::runtime_error(
      std::string("Draft failed — try a smaller angle or a different face (") +
      e.what() + ")");
  }
}

// MakeShell(shapeId, thickness) → hollow the solid inward by |thickness|,
// leaving a closed shell of that wall thickness (no faces removed).  Uses the
// "simple" thick-solid path so it works on any solid without a face selection.
// 0 = sentinel "operation rejected" — the JS bridge turns it into an error.
Val MakeShell(Js& js) {
  int id           = js.int32(js[0]);
  double thickness = js.num(js[1], 0.0);

  TopoDS_Shape shape = FetchShape(id);
  if (std::abs(thickness) < 1e-9)
    return js.makeNumber(StoreShape(shape));

  // Closed hollow with a wall of |thickness|: offset every face inward to get
  // the inner void solid, then cut it from the original.  (MakeThickSolid's
  // join/simple paths need a face to remove or an open shell; this works on
  // any closed solid with no face selection.)
  TopoDS_Shape inner;
  try {
    BRepOffsetAPI_MakeOffsetShape off;
    off.PerformByJoin(shape, -std::abs(thickness), 1e-3);
    if (!off.IsDone()) return js.makeNumber(0);
    inner = off.Shape();
  } catch (const std::exception& e) {
    throw std::runtime_error(
      std::string("Shell failed — try a smaller thickness (") + e.what() + ")");
  }
  if (inner.IsNull()) return js.makeNumber(0);

  BRepAlgoAPI_Cut cut(shape, inner);
  cut.SetFuzzyValue(1.0e-5);
  cut.Build(CancelRange());
  if (!cut.IsDone()) return js.makeNumber(0);
  return js.makeNumber(StoreShape(cut.Shape()));
}

// Build the helical thread groove solid for an internal (tapped) hole: an ISO
// 60° V profile swept along a helix on the bore wall.  Returns a null shape on
// failure so the caller can fall back to a plain bore.
static TopoDS_Shape BuildThreadGroove(
    const gp_Pnt& start, const gp_Dir& axisDir,
    double minR, double majR, double pitch, double length) {
  try {
    if (pitch < 1e-6 || majR <= minR) return TopoDS_Shape();
    gp_Ax3 cylAx(start, axisDir);
    Handle(Geom_CylindricalSurface) surf = new Geom_CylindricalSurface(cylAx, minR);
    const double TWO_PI = 2.0 * M_PI;
    // Cover the bore length plus an extra turn each end so the groove runs out
    // cleanly past the cut faces.  The caller offsets `start` into the part by
    // one pitch so this lead-in lands on the entry face, not above it.
    double vEnd = length + 2.0 * pitch;
    double uEnd = (vEnd / pitch) * TWO_PI;
    // Straight line in (u = angle, v = height) param space → a helix in 3D.
    // Bind Value()'s Handle(Geom2d_TrimmedCurve) to its own name before the
    // upcast: gcc rejects copy-initialising a Handle(Geom2d_Curve) directly
    // from the returned handle ("conversion to non-scalar type requested"),
    // though it accepts the identical upcast from a named handle.  clang
    // accepts both, so writing it the short way builds on macOS and breaks
    // the Linux build only.
    Handle(Geom2d_TrimmedCurve) segTrimmed =
      GCE2d_MakeSegment(gp_Pnt2d(0.0, -pitch), gp_Pnt2d(uEnd, vEnd - pitch))
        .Value();
    Handle(Geom2d_Curve) seg = segTrimmed;
    TopoDS_Edge helixE = BRepBuilderAPI_MakeEdge(seg, surf);
    BRepLib::BuildCurves3d(helixE);
    TopoDS_Wire helixW = BRepBuilderAPI_MakeWire(helixE);

    // Triangular V profile in the axial plane at the helix start, base on the
    // bore wall (minR) and apex outward at majR.
    gp_Dir xdir = cylAx.XDirection();
    gp_Vec vx(xdir), vz(axisDir);
    double axialHalf = (majR - minR) * 0.5774; // tan(30°) for a 60° thread
    gp_Pnt base(start.XYZ() + (minR * vx).XYZ());
    gp_Pnt pTop(base.XYZ() + (axialHalf * vz).XYZ());
    gp_Pnt pBot(base.XYZ() + (-axialHalf * vz).XYZ());
    gp_Pnt pApex(start.XYZ() + (majR * vx).XYZ());
    BRepBuilderAPI_MakePolygon poly(pTop, pApex, pBot, Standard_True);
    if (!poly.IsDone()) return TopoDS_Shape();
    TopoDS_Wire profile = poly.Wire();

    BRepOffsetAPI_MakePipeShell pipe(helixW);
    pipe.Add(profile);
    pipe.SetMode(Standard_True); // Frenet frame — stable on a constant helix
    pipe.Build(CancelRange());
    if (!pipe.IsDone()) return TopoDS_Shape();
    if (!pipe.MakeSolid()) return TopoDS_Shape();
    return pipe.Shape();
  } catch (const std::exception&) {
    return TopoDS_Shape();
  }
}

// MakeHole(px,py,pz, dx,dy,dz, length, diameter, tolerance) → a plain bore
// cylinder (the hole's negative volume) drilled from (p) along (d).  For a
// threaded hole the caller passes the MINOR diameter here and cuts MakeThread's
// groove as a second step (separate cuts are far more robust than fusing a
// helical solid).  `tolerance` adds radial clearance.
Val MakeHole(Js& js) {
  double px = js.num(js[0], 0.0), py = js.num(js[1], 0.0),
         pz = js.num(js[2], 0.0);
  double dx = js.num(js[3], 0.0), dy = js.num(js[4], -1.0),
         dz = js.num(js[5], 0.0);
  double length    = js.num(js[6], 1.0);
  double diameter  = js.num(js[7], 0.5);
  double tolerance = js.num(js[8], 0.0);

  if (length <= 1e-7 || diameter <= 1e-7) return js.makeNumber(0);
  gp_Vec dv(dx, dy, dz);
  if (dv.Magnitude() < 1e-9) return js.makeNumber(0);
  gp_Ax2 ax(gp_Pnt(px, py, pz), gp_Dir(dv));
  BRepPrimAPI_MakeCylinder cyl(ax, diameter / 2.0 + tolerance, length);
  cyl.Build(CancelRange());
  if (!cyl.IsDone()) return js.makeNumber(0);
  return js.makeNumber(StoreShape(cyl.Shape()));
}

// MakeThread(px,py,pz, dx,dy,dz, length, majorDia, pitch, tolerance) → the ISO
// internal thread groove solid (cut as a second tool after the bore).  Returns
// 0 when the helical sweep can't be built, so the caller just leaves a plain
// bore.  Crests at the minor radius, roots at majorDia/2.
Val MakeThread(Js& js) {
  double px = js.num(js[0], 0.0), py = js.num(js[1], 0.0),
         pz = js.num(js[2], 0.0);
  double dx = js.num(js[3], 0.0), dy = js.num(js[4], -1.0),
         dz = js.num(js[5], 0.0);
  double length    = js.num(js[6], 1.0);
  double majorDia  = js.num(js[7], 0.6);
  double pitch     = js.num(js[8], 0.1);
  double tolerance = js.num(js[9], 0.0);

  gp_Vec dv(dx, dy, dz);
  if (dv.Magnitude() < 1e-9 || pitch <= 1e-6) return js.makeNumber(0);
  gp_Dir axisDir(dv);
  gp_Pnt start(px, py, pz);
  double majR = majorDia / 2.0 + tolerance;
  double minR = majR - 0.5413 * pitch;
  if (minR < 1e-4) return js.makeNumber(0);
  TopoDS_Shape groove =
    BuildThreadGroove(start, axisDir, minR, majR, pitch, length);
  if (groove.IsNull()) return js.makeNumber(0);
  return js.makeNumber(StoreShape(groove));
}

// enrichSubGeo(shapeId, subGeo) → subGeo with each edge's two adjacent face
// normals resolved (n1, n2).  Called once at chamfer/fillet creation — when
// the stored endpoint coordinates still line up with the (pre-resize) shape —
// so later regens can re-find the edge by its resize-invariant normals after
// a parametric resize moves the endpoints.  Edges that already carry normals
// pass through untouched; faces are returned unchanged.
Val EnrichSubGeo(Js& js) {
  int id = js.int32(js[0]);
  Val sg = js[1];
  ShapeRecord rec = FetchRecord(id);
  const TopoDS_Shape& shape = rec.shape;
  EdgeFaceSpec spec = ParseSubGeo(js, sg);

  TopTools_IndexedDataMapOfShapeListOfShape edgeFaceMap;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaceMap);

  Val outEdges = js.makeArray(static_cast<uint32_t>(spec.edges.size()));
  for (size_t i = 0; i < spec.edges.size(); i++) {
    const auto& ep = spec.edges[i];
    Val eo = js.makeObject();
    js.set(eo, "ax", ep.ax); js.set(eo, "ay", ep.ay); js.set(eo, "az", ep.az);
    js.set(eo, "bx", ep.bx); js.set(eo, "by", ep.by); js.set(eo, "bz", ep.bz);

    // Stamp the persistent edge name (its adjacent face-pair) so a later regen
    // resolves the rim by name — robust to a re-tessellation that moves the
    // endpoints.  The picked coords come from the DISPLAY mesh, whose
    // tessellation may differ from this OCC solid, so match tolerantly:
    // exact endpoints first, then midpoint-on-segment (same as the regen
    // selector), before naming the edge from rec.edges.
    if (ep.name.empty() && !rec.edges.empty()) {
      TopoDS_Shape hit;
      for (TopExp_Explorer ee(shape, TopAbs_EDGE); ee.More(); ee.Next()) {
        if (EdgeMatchesEndpoints(TopoDS::Edge(ee.Current()),
                                 {ep.ax, ep.ay, ep.az},
                                 {ep.bx, ep.by, ep.bz})) {
          hit = ee.Current();
          break;
        }
      }
      if (hit.IsNull()) {
        for (TopExp_Explorer ee(shape, TopAbs_EDGE); ee.More(); ee.Next()) {
          if (EdgeMidpointOnSegment(TopoDS::Edge(ee.Current()),
                                    {ep.ax, ep.ay, ep.az},
                                    {ep.bx, ep.by, ep.bz}, 0.05)) {
            hit = ee.Current();
            break;
          }
        }
      }
      if (!hit.IsNull())
        for (const auto& kv : rec.edges)
          if (kv.second.IsSame(hit)) {
            js.set(eo, "name", js.makeString(kv.first));
            break;
          }
    } else if (!ep.name.empty()) {
      js.set(eo, "name", js.makeString(ep.name));
    }

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
      Val a1 = js.makeArray(3);
      Val a2 = js.makeArray(3);
      for (int k = 0; k < 3; k++) {
        js.setAt(a1, uint32_t(k), js.makeNumber(n1[k]));
        js.setAt(a2, uint32_t(k), js.makeNumber(n2[k]));
      }
      js.set(eo, "n1", a1);
      js.set(eo, "n2", a2);
    }
    js.setAt(outEdges, uint32_t(i), eo);
  }

  // Faces: pass through unchanged, but stamp each with the persistent NAME of
  // the face it currently selects, so later regens resolve it by name instead
  // of coordinates.  Resolve the pick to a face (coord/normal), then match it
  // to a named face by identity (IsSame).
  Val outFaces;
  if (js.has(sg, "faces") && js.isArray(js.get(sg, "faces"))) {
    Val inFaces = js.get(sg, "faces");
    outFaces = js.makeArray(js.length(inFaces));
    for (uint32_t i = 0; i < js.length(inFaces) && i < spec.faces.size(); i++) {
      Val fo = js.at(inFaces, i);
      if (spec.faces[i].name.empty()) {
        EdgeFaceSpec one;
        one.faces.push_back(spec.faces[i]);
        auto sel = SelectSubGeoFaces(shape, one);
        if (!sel.empty()) {
          for (const auto& kv : rec.faces) {
            if (kv.second.IsSame(sel[0])) {
              js.set(fo, "name", js.makeString(kv.first));
              break;
            }
          }
        }
      }
      js.setAt(outFaces, i, fo);
    }
  } else {
    outFaces = js.makeArray(0);
  }

  Val out = js.makeObject();
  js.set(out, "edges", outEdges);
  js.set(out, "faces", outFaces);
  return out;
}

}  // namespace occ
