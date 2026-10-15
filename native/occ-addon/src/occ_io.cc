#include "occ_core.h"
#include <Standard_ErrorHandler.hxx>

namespace occ {

// ════════════════════════════════════════════════════════════════════════
// Exported functions — tessellation
// ════════════════════════════════════════════════════════════════════════

// {positions, indices, triangleCount} for a tessellation.
static Val MeshResult(Js& js, const std::vector<float>& positions,
                      const std::vector<uint32_t>& indices,
                      const std::vector<uint32_t>* edges = nullptr) {
  Val result = js.makeObject();
  // The real edges' segments, as index pairs into positions.
  if (edges)
    js.set(result, "edges", js.makeUint32Array(edges->data(), edges->size()));
  js.set(result, "positions",
         js.makeFloat32Array(positions.data(), positions.size()));
  js.set(result, "indices", js.makeUint32Array(indices.data(), indices.size()));
  js.set(result, "triangleCount", static_cast<double>(indices.size() / 3));
  return result;
}

// tessellate(id, precision) → {positions: Float32Array, indices: Uint32Array,
//                               triangleCount: number}
// precision is the print precision in mm (same unit as tessellate.js#deflectionFor).
Val TessellateShape(Js& js) {
  int id         = js.int32(js[0]);
  double prec    = js.num(js[1], 0.5);
  // `prec` is the Resolution in mm; a tenth of it in scene units (1 = 10 mm)
  // is that many mm.  Floored at the finest Resolution Settings offers
  // (0.001 mm): the floor was 0.01 mm, so every finer setting meshed the same.
  double linDefl = std::max(0.0001, prec / 10.0);

  TopoDS_Shape shape = FetchShape(id);
  std::vector<float> positions;
  std::vector<uint32_t> indices;
  std::vector<uint32_t> edges;
  TessellateInto(shape, linDefl, positions, indices, &edges);

  return MeshResult(js, positions, indices, &edges);
}

// ════════════════════════════════════════════════════════════════════════
// Persistent topological naming — queries
// ════════════════════════════════════════════════════════════════════════

// faceNames(shapeId) → [name, ...] : the stable names this shape carries.
Val FaceNames(Js& js) {
  ShapeRecord rec = FetchRecord(js.int32(js[0]));
  Val out = js.makeArray(static_cast<uint32_t>(rec.faces.size()));
  uint32_t i = 0;
  for (const auto& kv : rec.faces) js.setAt(out, i++, js.makeString(kv.first));
  return out;
}

// namedFacePoint(shapeId, name) → [x,y,z] at the face's UV midpoint, or null.
// Lets a caller (and the tests) confirm a name resolves to the intended face
// after a rebuild — the point moves with the geometry, the name does not.
Val NamedFacePoint(Js& js) {
  ShapeRecord rec = FetchRecord(js.int32(js[0]));
  std::string name = js.string(js[1]);
  auto it = rec.faces.find(name);
  if (it == rec.faces.end() || it->second.ShapeType() != TopAbs_FACE)
    return js.makeNull();
  BRepAdaptor_Surface s(TopoDS::Face(it->second), false);
  double u = (s.FirstUParameter() + s.LastUParameter()) / 2.0;
  double v = (s.FirstVParameter() + s.LastVParameter()) / 2.0;
  gp_Pnt p = s.Value(u, v);
  Val out = js.makeArray(3);
  js.setAt(out, 0, js.makeNumber(p.X()));
  js.setAt(out, 1, js.makeNumber(p.Y()));
  js.setAt(out, 2, js.makeNumber(p.Z()));
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — shape-store management
// ════════════════════════════════════════════════════════════════════════

Val ReleaseShape(Js& js) {
  ReleaseStored(js.int32(js[0]));
  return js.makeUndefined();
}

Val ClearAll(Js& js) {
  ClearStore();
  return js.makeUndefined();
}

Val ShapeCount(Js& js) {
  return js.makeNumber(static_cast<double>(StoreSize()));
}

// shapeVolume(id) → the signed volume of a stored shape.  An op checks a
// boolean's result with it: OCC can return a "successful" result that has
// silently dropped one of its inputs.
Val ShapeVolume(Js& js) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(FetchShape(js.int32(js[0])), props);
  return js.makeNumber(props.Mass());
}

// Register the shared cancel flag: an Int32Array over a SharedArrayBuffer whose
// element 0 the caller flips to non-zero (from another thread) to abort the
// current long build.  We stash the backing pointer; a SAB never detaches, so
// it stays valid for the process lifetime.  Called once at worker startup.
Val SetCancelBuffer(Js& js) {
  Typed arr = js.typed(js[0]);
  if (arr.kind != TypedKind::Int32)
    throw std::runtime_error("setCancelBuffer: an Int32Array was expected");
  SetCancelFlag(static_cast<volatile int32_t*>(arr.data));
  return js.makeUndefined();
}

// ════════════════════════════════════════════════════════════════════════
// Exported functions — STEP export
// ════════════════════════════════════════════════════════════════════════

// exportSTEP(shapeIds: number[]) → string
// Writes all shapes as a single STEP file (ISO-10303-21) and returns the
// content as a UTF-8 string.  Uses WriteStream to avoid temp-file I/O.
Val ExportSTEP(Js& js) {
  Val ids = js[0];
  if (js.length(ids) == 0) return js.makeString("");

  STEPControl_Writer writer;
  for (uint32_t i = 0; i < js.length(ids); i++) {
    int id = js.int32(js.at(ids, i));
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
  return js.makeString(content);
}

// importSTEP(stepText: string) → shapeId
// Reads a STEP file's content into a single shape (all roots fused into one
// compound).  The caller tessellates it and must release the shape.
// shapeToBrep(id) → OCC's BREP text for a stored shape, without its mesh: an
// imported STEP body keeps its exact surfaces as this, its recipe.
Val ShapeToBrep(Js& js) {
  std::ostringstream oss;
  BRepTools::Write(FetchShape(js.int32(js[0])), oss, false, false,
                   TopTools_FormatVersion_CURRENT);
  return js.makeString(oss.str());
}

// shapeFromBrep(text) → shapeId: a shape read back from BREP text.
Val ShapeFromBrep(Js& js) {
  std::istringstream iss(js.string(js[0]));
  TopoDS_Shape shape;
  BRep_Builder builder;
  BRepTools::Read(shape, iss, builder);
  if (shape.IsNull()) throw std::runtime_error("BREP text produced no shape");
  return js.makeNumber(StoreShape(shape));
}

Val ImportSTEP(Js& js) {
  std::string content = js.string(js[0]);
  std::istringstream iss(content);
  STEPControl_Reader reader;
  IFSelect_ReturnStatus status = reader.ReadStream("import.step", iss);
  if (status != IFSelect_RetDone)
    throw std::runtime_error("STEP read failed");
  reader.TransferRoots();
  TopoDS_Shape shape = reader.OneShape();
  if (shape.IsNull()) throw std::runtime_error("STEP file produced no shape");
  return js.makeNumber(StoreShape(shape));
}

// makeSolidFromMesh(positions: Float64Array, indices: Uint32Array|null) → shapeId
// Sew a triangle soup into a shell and make a solid, so imported meshes (STL, or
// a tessellated STEP) can take part in boolean operations.  Coplanar triangles
// are merged so flat-faced models become cheap to boolean.  Booleans on a solid
// with thousands of faces are pathologically slow and would freeze the (single-
// threaded) main process, so a too-dense mesh is rejected with a clear error
// rather than hanging — the caller surfaces it as a notification.
Val MakeSolidFromMesh(Js& js) {
  F64 pos = js.f64(js[0]);
  const double* p = pos.Data();
  const bool hasIdx = js.isTypedArray(js[1]);
  // Two independent knobs for the callers:
  //   skipCaps  — skip the tri/face REJECTION caps (which exist so an import's
  //               dense mesh can't hang a later boolean).  Export needs this
  //               (no boolean at all); the emboss stamp/body needs it too (a
  //               legitimately dense curved wrap that MUST be booleaned).
  //   fastSew   — sew with cutting OFF and skip the coplanar UnifySameDomain
  //               pass: near-instant, for EXPORT only (only tessellated/written,
  //               never booleaned).  A booleaned solid must keep cutting ON +
  //               unify so its faces share edges and the boolean stays cheap.
  // So: import = (false,false); export = (true,true); emboss = (true,false).
  const bool skipCaps =
      js.argc() > 2 && js.isBoolean(js[2]) && js.boolean(js[2]);
  const bool fastSew =
      js.argc() > 3 && js.isBoolean(js[3]) && js.boolean(js[3]);

  // Sewing then unifying a very dense mesh is itself slow, so bail before that.
  const size_t kMaxTris = 50000;
  size_t triCount =
      hasIdx ? js.u32(js[1]).ElementLength() / 3
             : (pos.ElementLength() / 3) / 3;
  if (!skipCaps && triCount > kMaxTris)
    throw std::runtime_error(
        "Imported mesh is too detailed (" + std::to_string(triCount) +
        " triangles) to use in a boolean. Simplify or decimate it first.");

  const uint32_t nv = (uint32_t)(pos.ElementLength() / 3);
  // Each face handed to the sew, with the normal its triangle's winding
  // gives it -- see adoptWinding below.
  std::vector<TopoDS_Face> addedFaces;
  std::vector<gp_Dir> addedNormals;
  // Add every (non-degenerate) triangle as a face to a sewing pass, polling
  // the cancel flag periodically.  Reusable so we can try a fast pass then a
  // thorough fallback.
  auto fillSew = [&](BRepBuilderAPI_Sewing& sew) {
    auto addTri = [&](uint32_t ia, uint32_t ib, uint32_t ic) {
      gp_Pnt a(p[ia * 3], p[ia * 3 + 1], p[ia * 3 + 2]);
      gp_Pnt b(p[ib * 3], p[ib * 3 + 1], p[ib * 3 + 2]);
      gp_Pnt c(p[ic * 3], p[ic * 3 + 1], p[ic * 3 + 2]);
      if (a.Distance(b) < 1e-12 || b.Distance(c) < 1e-12 ||
          c.Distance(a) < 1e-12)
        return;
      BRepBuilderAPI_MakePolygon poly(a, b, c, Standard_True);
      if (!poly.IsDone()) return;
      BRepBuilderAPI_MakeFace face(poly.Wire(), Standard_True);
      if (!face.IsDone()) return;
      sew.Add(face.Face());
      gp_Vec n = gp_Vec(a, b).Crossed(gp_Vec(a, c));
      if (n.Magnitude() > 0) {
        addedFaces.push_back(face.Face());
        addedNormals.push_back(gp_Dir(n));
      }
    };
    addedFaces.clear();
    addedNormals.clear();
    if (hasIdx) {
      U32 idx = js.u32(js[1]);
      for (size_t i = 0; i + 2 < idx.ElementLength(); i += 3) {
        if ((i & 0x3FF) == 0 && CancelRequested())
          throw std::runtime_error("cancelled");
        addTri(idx[i], idx[i + 1], idx[i + 2]);
      }
    } else {
      for (uint32_t i = 0; i + 2 < nv; i += 3) {
        if ((i & 0x3FF) == 0 && CancelRequested())
          throw std::runtime_error("cancelled");
        addTri(i, i + 1, i + 2);
      }
    }
  };

  // Sewing options (tol, sewingMode, analysis, CUTTING, nonManifold).  The
  // cutting pass splits faces to resolve intersections; it's slow but produces
  // properly-shared edges so a later ShapeUpgrade_UnifySameDomain can merge
  // coplanar faces and the following BOOLEAN stays cheap.
  //   • Export (skipCaps): the solid is only tessellated / written, never
  //     booleaned, so cutting is pointless — disable it for a near-instant sew.
  //   • Boolean path (emboss stamp/body, STL import): cutting ON is REQUIRED —
  //     without it the un-cut per-triangle shell doesn't unify, the face count
  //     stays ~= the triangle count (blowing the kMaxFaces cap, or hanging the
  //     boolean), which broke emboss when this was globally disabled.
  // Is the mesh consistently wound?  Every edge (welded by position) walked
  // as often one way as the other -- which also holds where the surface
  // pinches and four triangles share an edge.
  bool windingConsistent = true;
  {
    std::map<std::tuple<double, double, double>, uint32_t> weld;
    auto vid = [&](uint32_t i) {
      return weld
          .emplace(std::make_tuple(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]),
                   (uint32_t)weld.size())
          .first->second;
    };
    std::unordered_map<uint64_t, int> balance;
    auto walk = [&](uint32_t ia, uint32_t ib, uint32_t ic) {
      const uint32_t v[3] = {vid(ia), vid(ib), vid(ic)};
      for (int k = 0; k < 3; k++) {
        const uint32_t u = v[k], w = v[(k + 1) % 3];
        if (u == w) continue;
        const uint64_t key = ((uint64_t)std::min(u, w) << 32) | std::max(u, w);
        balance[key] += u < w ? 1 : -1;
      }
    };
    if (hasIdx) {
      U32 idx = js.u32(js[1]);
      for (size_t i = 0; i + 2 < idx.ElementLength(); i += 3)
        walk(idx[i], idx[i + 1], idx[i + 2]);
    } else {
      for (uint32_t i = 0; i + 2 < nv; i += 3) walk(i, i + 1, i + 2);
    }
    for (const auto& kv : balance)
      if (kv.second != 0) {
        windingConsistent = false;
        break;
      }
  }

  // Sewing orients the faces by propagating across shared edges, and so
  // does ShapeFix_Shell; where the surface pinches (four triangles on one
  // edge) both can carry the orientation onto the wrong side, and a patch
  // comes out inside-out -- drawn from behind, so it looks missing (a wall
  // beside MultiSystem2's right boss, flipped by every boolean on the base
  // though the mesh itself was right).  A consistently wound mesh already
  // says which way every face faces: turn each sewn face to agree with the
  // triangle it came from.
  auto adoptWinding = [&](BRepBuilderAPI_Sewing& sew,
                          const TopoDS_Shape& shape) -> TopoDS_Shape {
    TopTools_DataMapOfShapeInteger source;
    for (size_t k = 0; k < addedFaces.size(); k++) {
      const TopoDS_Shape m = sew.IsModified(addedFaces[k])
                                 ? sew.Modified(addedFaces[k])
                                 : TopoDS_Shape(addedFaces[k]);
      for (TopExp_Explorer ex(m, TopAbs_FACE); ex.More(); ex.Next())
        if (!source.IsBound(ex.Current())) source.Bind(ex.Current(), (int)k);
    }
    // Whether each sewn face faces with its triangle or against it.  Which
    // of the two the sewn shell calls "outward" is the plane convention's
    // business, so no side is assumed: the faces are told apart, and the
    // smaller group -- the patch the orientation pass got wrong -- is
    // turned.  (Turning the larger one reversed the whole solid, which a
    // boolean then treats as everything outside it: every cut came back
    // empty.)
    std::vector<std::vector<std::pair<TopoDS_Face, int>>> shells;
    int with = 0, against = 0;
    for (TopExp_Explorer sx(shape, TopAbs_SHELL); sx.More(); sx.Next()) {
      shells.emplace_back();
      for (TopExp_Explorer fx(sx.Current(), TopAbs_FACE); fx.More();
           fx.Next()) {
        const TopoDS_Face face = TopoDS::Face(fx.Current());
        int k, side = 0;
        Handle(Geom_Plane) plane =
            Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(face));
        if (!plane.IsNull() && source.Find(face, k)) {
          gp_Dir d = plane->Axis().Direction();
          if (face.Orientation() == TopAbs_REVERSED) d.Reverse();
          side = d.Dot(addedNormals[k]) < 0 ? -1 : 1;
          (side > 0 ? with : against)++;
        }
        shells.back().emplace_back(face, side);
      }
    }
    const int turn = against <= with ? -1 : 1;
    if ((turn < 0 ? against : with) == 0) return shape;
    BRep_Builder bb;
    TopoDS_Compound out;
    bb.MakeCompound(out);
    for (auto& faces : shells) {
      TopoDS_Shell shell;
      bb.MakeShell(shell);
      for (auto& [face, side] : faces) {
        if (side == turn) face.Reverse();
        bb.Add(shell, face);
      }
      shell.Closed(BRep_Tool::IsClosed(shell));
      bb.Add(out, shell);
    }
    return out;
  };

  TopoDS_Shape sewn;
  if (fastSew) {
    BRepBuilderAPI_Sewing sew(1.0e-6, Standard_True, Standard_True,
                              Standard_False, Standard_False);
    fillSew(sew);
    sew.Perform(CancelRange());
    sewn = sew.SewedShape();
    if (!sewn.IsNull() && windingConsistent) sewn = adoptWinding(sew, sewn);
    if (sewn.IsNull()) {
      // Fast pass produced nothing (a mesh that needs cutting) — retry full.
      BRepBuilderAPI_Sewing sewFull(1.0e-6);
      fillSew(sewFull);
      sewFull.Perform(CancelRange());
      sewn = sewFull.SewedShape();
      if (!sewn.IsNull() && windingConsistent)
        sewn = adoptWinding(sewFull, sewn);
    }
  } else {
    BRepBuilderAPI_Sewing sew(1.0e-6);
    fillSew(sew);
    sew.Perform(CancelRange());
    sewn = sew.SewedShape();
    if (!sewn.IsNull() && windingConsistent) sewn = adoptWinding(sew, sewn);
  }
  if (sewn.IsNull()) throw std::runtime_error("mesh sewing produced nothing");

  // Build a solid from EACH closed shell and orient each for positive volume
  // (material inside).  Orienting a multi-shell solid as a whole flips it by
  // TOTAL volume, so several disjoint shells (e.g. one per emboss letter) can
  // come out inside-out — wrong normals after the boolean, especially on the
  // fast (cutting-off) sew that doesn't re-orient faces itself.  Per-shell
  // orientation fixes each letter independently.
  TopoDS_Shape result = sewn;
  std::vector<TopoDS_Solid> solids;
  for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
    TopoDS_Shell shell = TopoDS::Shell(ex.Current());
    if (fastSew && !windingConsistent) {
      // Cutting-off sewing keeps the mesh's own winding, which the developable
      // emboss wrap can leave INCONSISTENT (a curved / S-curve wall flips
      // handedness region to region — some triangles reversed).  Cutting-on
      // would re-orient them but hangs on this mesh; ShapeFix_Shell propagates a
      // consistent orientation across the shell (the same result, cheaply), so
      // the boolean and the rendered normals come out right.
      Handle(ShapeFix_Shell) sfs = new ShapeFix_Shell(shell);
      sfs->FixFaceOrientation(shell);
      if (!sfs->Shell().IsNull()) shell = sfs->Shell();
    }
    BRepBuilderAPI_MakeSolid ms(shell);
    if (!ms.IsDone()) {
      solids.clear();
      break;
    }
    TopoDS_Solid sol = ms.Solid();
    BRepLib::OrientClosedSolid(sol);
    // OrientClosedSolid can silently FAIL on a sewn triangle shell (its point
    // classification is unreliable there), leaving the solid inside-out —
    // negative volume.  An inside-out tool VANISHES from a union and inverts a
    // difference (the "missing letters" emboss bug).  Measure and flip: the
    // signed volume is ground truth.
    GProp_GProps props;
    BRepGProp::VolumeProperties(sol, props);
    if (props.Mass() < 0) sol = TopoDS::Solid(sol.Reversed());
    solids.push_back(sol);
  }
  if (solids.size() == 1) {
    result = solids[0];
  } else if (solids.size() > 1) {
    BRep_Builder bld;
    TopoDS_Compound comp;
    bld.MakeCompound(comp);
    for (const TopoDS_Solid& s : solids) bld.Add(comp, s);
    result = comp;
  }

  // Merge coplanar faces so a tessellated flat model collapses to a handful of
  // faces (a box: 12 triangles → 6 faces) the boolean can handle quickly.
  // Skipped only for the fast export sew (no boolean; unify is slow on a curved
  // mesh and would alter the triangles).
  if (!fastSew) {
    const TopoDS_Shape unmerged = result;
    try {
      ShapeUpgrade_UnifySameDomain unify(result, Standard_True, Standard_True,
                                         Standard_False);
      unify.Build();
      if (!unify.Shape().IsNull()) result = unify.Shape();
    } catch (const std::exception&) {
      // keep the un-unified shape
    }
    // Merging can fold a mesh's sliver triangles into a face BRepMesh
    // cannot triangulate; the mesher leaves it out and the body is drawn --
    // and every boolean on it rebuilt -- with a hole (a 4 mm patch of
    // MultiSystem2's base top, lost at import and again each time the
    // recalc sewed a later step's mesh).  Keep the unmerged faces when
    // merging opened the mesh.
    if (!result.IsSame(unmerged)) {
      const long merged = OpenEdgeCount(result, 0.01);
      if (merged != 0) {
        const long before = OpenEdgeCount(unmerged, 0.01);
        if (before >= 0 && (merged < 0 || before < merged)) result = unmerged;
      }
    }
  }

  // After merging, a curved/organic mesh keeps roughly one face per triangle.
  // Reject one too big to boolean in reasonable time, UNLESS the caller opted
  // out (skipCaps): export never booleans, and the emboss stamp is a
  // legitimately dense curved wrap that must be booleaned.
  //
  // This was 5000, which refused an ordinary imported STL part (~14.6k faces).
  // Measured on clean curved meshes (this Mac, two runs): at 49k triangles
  // sewing took 5.0-5.3 s and the boolean after it under 2 s (1.1-1.9 s for
  // a fuse and a cut through a whole ring of faces); at 14.6k, 1.3 s and
  // 0.3-0.5 s.  The boolean is never the slow part, it runs in the OCC worker
  // and honours cancel, and this check comes AFTER the sew -- so a refusal
  // here had already paid the expensive stage.  It now matches kMaxTris,
  // which is checked BEFORE sewing and is the limit that actually saves
  // time.  A DIRTY mesh (open, self-intersecting) can be slow at any size;
  // no count tells clean from dirty.
  if (!skipCaps) {
    const int kMaxFaces = 50000;
    int faceCount = 0;
    for (TopExp_Explorer ex(result, TopAbs_FACE); ex.More(); ex.Next()) {
      if (++faceCount > kMaxFaces) break;
    }
    if (faceCount > kMaxFaces)
      throw std::runtime_error(
          "Imported mesh has too many curved faces to use in a boolean. "
          "Simplify it, or boolean against a primitive instead.");
  }

  return js.makeNumber(StoreShape(result));
}

// ════════════════════════════════════════════════════════════════════════
// Phase-0 full-pipeline smoke test (kept for existing test/ping.mjs)
// ════════════════════════════════════════════════════════════════════════

Val MakeCubeTessellated(Js& js) {
  double precision = js.argc() > 0 && js.isNumber(js[0]) ? js.number(js[0]) : 0.1;
  // Build the canonical 2×2×2 centred box from Phase 0.
  gp_Pnt p1(-1, -1, -1);
  gp_Pnt p2(1, 1, 1);
  BRepPrimAPI_MakeBox boxMaker(p1, p2);
  TopoDS_Shape shape = boxMaker.Shape();

  double linDefl = std::max(0.0001, precision / 10.0);
  std::vector<float> positions;
  std::vector<uint32_t> indices;
  TessellateInto(shape, linDefl, positions, indices);
  return MeshResult(js, positions, indices);
}

}  // namespace occ

namespace occ {
// Every op runs under OCC_CATCH_SIGNALS: a hardware fault inside OCC (a NULL
// dereference on a shape a cancelled boolean left empty, say) is rethrown as
// an exception the adapter returns to JS, where without it OCC printed
// "*** Abort ***" and exited -- taking the whole app with it, since the addon
// shares the process.  OSD::SetSignal alone does not do this: the fault needs a
// handler in scope to jump to.
template <occjs::Val (*F)(occjs::Js&)>
occjs::Val Guarded(occjs::Js& js) {
  OCC_CATCH_SIGNALS
  return F(js);
}
}  // namespace occ

const std::vector<occjs::Op>& occjs::Ops() {
  using namespace occ;
  static const std::vector<Op> ops = {
      // Smoke tests
      {"ping", Guarded<PingStr>},
      {"makeCubeTessellated", Guarded<MakeCubeTessellated>},

      // Primitives → shape ID
      {"makeBox", Guarded<MakeBox>},
      {"makeSphere", Guarded<MakeSphere>},
      {"makeCylinder", Guarded<MakeCylinder>},
      {"makeCone", Guarded<MakeCone>},
      {"makeTorus", Guarded<MakeTorus>},
      {"makeExtrude", Guarded<MakeExtrude>},
      {"makeRevolve", Guarded<MakeRevolve>},
      {"makePipe", Guarded<MakePipe>},
      {"makeLoft", Guarded<MakeLoft>},

      // Transforms
      {"transformShape", Guarded<TransformShape>},
      {"mirrorShape", Guarded<MirrorShape>},
      {"rotateShapeAxis", Guarded<RotateShapeAxis>},
      {"scaleShape", Guarded<ScaleShape>},
      {"scaleShapeXYZ", Guarded<ScaleShapeXYZ>},

      // Boolean ops
      {"booleanOp", Guarded<BooleanOp>},

      // Chamfer / fillet and the other modify ops
      {"chamferShape", Guarded<ChamferShape>},
      {"filletShape", Guarded<FilletShape>},
      {"pushPullFaces", Guarded<PushPullFaces>},
      {"draftFaces", Guarded<DraftFaces>},
      {"makeShell", Guarded<MakeShell>},
      {"makeHole", Guarded<MakeHole>},
      {"makeThread", Guarded<MakeThread>},
      {"enrichSubGeo", Guarded<EnrichSubGeo>},
      {"faceNames", Guarded<FaceNames>},
      {"namedFacePoint", Guarded<NamedFacePoint>},

      // Tessellation
      {"tessellate", Guarded<TessellateShape>},

      // Export / import and mesh tools
      {"exportSTEP", Guarded<ExportSTEP>},
      {"importSTEP", Guarded<ImportSTEP>},
      {"makeSolidFromMesh", Guarded<MakeSolidFromMesh>},
      {"weldMesh", Guarded<WeldMesh>},
      {"simplifyMesh", Guarded<SimplifyMesh>},

      // Shape store management
      {"releaseShape", Guarded<ReleaseShape>},
      {"shapeVolume", Guarded<ShapeVolume>},
      {"shapeToBrep", Guarded<ShapeToBrep>},
      {"shapeFromBrep", Guarded<ShapeFromBrep>},
      {"clearAll", Guarded<ClearAll>},
      {"shapeCount", Guarded<ShapeCount>},
      {"setCancelBuffer", Guarded<SetCancelBuffer>},
  };
  return ops;
}
