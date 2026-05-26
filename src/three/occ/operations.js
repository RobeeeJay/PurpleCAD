// Boolean operations, chamfer, and fillet via OpenCascade.js.
//
// All operations work on TopoDS_Shape inputs and return a TopoDS_Shape
// result; tessellation to a THREE.BufferGeometry is done separately via
// ./tessellate.js.

import { getOcc } from "./init.js";

// ── Boolean operations ────────────────────────────────────────────────────

// opencascade.js v1.1.1 ships an OCCT release that pre-dates the
// Message_ProgressRange API, so the 2-arg constructors and no-arg Build()
// are the right overloads here.

export function unionShapes(shapes) {
  if (!shapes || shapes.length < 2) return shapes?.[0] || null;
  const oc = getOcc();
  let result = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    const op = new oc.BRepAlgoAPI_Fuse_3(result, shapes[i]);
    op.Build();
    result = op.Shape();
  }
  return result;
}

export function differenceShapes(shapes) {
  if (!shapes || shapes.length < 2) return shapes?.[0] || null;
  const oc = getOcc();
  let result = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    const op = new oc.BRepAlgoAPI_Cut_3(result, shapes[i]);
    op.Build();
    result = op.Shape();
  }
  return result;
}

export function intersectShapes(shapes) {
  if (!shapes || shapes.length < 2) return shapes?.[0] || null;
  const oc = getOcc();
  let result = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    const op = new oc.BRepAlgoAPI_Common_3(result, shapes[i]);
    op.Build();
    result = op.Shape();
  }
  return result;
}

export function booleanOp(operation, shapes) {
  switch (operation) {
    case "union":
      return unionShapes(shapes);
    case "difference":
      return differenceShapes(shapes);
    case "intersection":
      return intersectShapes(shapes);
    default:
      return null;
  }
}

// ── Chamfer (flat) ───────────────────────────────────────────────────────
// Apply a constant-distance chamfer to every edge of the shape that
// matches `edgePositions` (each entry being two 3D endpoints).  Edges
// are matched by endpoint position rather than by handle, so the same
// position list works regardless of how the shape was constructed.

function edgeMatchesEndpoints(oc, edge, posA, posB, eps = 1e-3) {
  // Walk the edge's two vertices and compare with posA/posB (in either
  // order).
  const exp = new oc.TopExp_Explorer_2(
    edge,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const pts = [];
  while (exp.More()) {
    const vertex = oc.TopoDS.Vertex_1(exp.Current());
    const pnt = oc.BRep_Tool.Pnt(vertex);
    pts.push({ x: pnt.X(), y: pnt.Y(), z: pnt.Z() });
    exp.Next();
  }
  const close = (a, b) =>
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.z - b.z) < eps;
  if (
    pts.length >= 2 &&
    ((close(pts[0], posA) && close(pts[1], posB)) ||
      (close(pts[0], posB) && close(pts[1], posA)))
  ) {
    return true;
  }
  // Fallback for CURVED edges (circles / arcs / splines): the rendered
  // mesh tessellates them into many short line segments, so the user
  // hovers ONE of those segments and we get (posA, posB) as two
  // interior points of the curve, not the curve's vertices.  The OCC
  // edge's vertices don't match, but BOTH (posA, posB) lie ON the
  // underlying curve.  Use BRepExtrema_DistShapeShape (exact min
  // distance from a vertex to the edge) to check, with a tolerance
  // matched to the tessellation chord deviation rather than the strict
  // 1e-3 used for vertex-equality.
  const curveEps = 0.05;
  const pointOnEdge = (p) => {
    const pnt = new oc.gp_Pnt_3(p.x, p.y, p.z);
    const vMk = new oc.BRepBuilderAPI_MakeVertex(pnt);
    const vertex = vMk.Vertex();
    const dist = new oc.BRepExtrema_DistShapeShape_2(
      vertex,
      edge,
      oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
    );
    dist.Perform();
    if (!dist.IsDone() || dist.NbSolution() < 1) return false;
    return dist.Value() < curveEps;
  };
  return pointOnEdge(posA) && pointOnEdge(posB);
}

// OCC's BRepFilletAPI throws Standard_Failure (a C++ object) when the
// edge / face / radius combination is geometrically invalid — most
// commonly when the radius is too large for the local geometry, or
// when an attempted fillet would self-intersect.  In the emscripten
// build of opencascade.js those exceptions surface in JS as a bare
// integer (the C++ pointer), which previously bubbled through the
// worker as "Chamfer operation failed: 44795024" — useless to the
// user.  Wrap the entire chamfer/fillet body — including the
// constructor, every Add_2 / AddDA, and Build/Shape — so any OCC
// throw becomes a JS Error with an actionable message.
function runFilletOp(kind, fn) {
  try {
    return fn();
  } catch (e) {
    const sizeWord = kind === "Fillet" ? "radius" : "distance";
    const detail =
      e && e.message
        ? e.message
        : typeof e === "number"
          ? "OCC kernel rejected the operation"
          : String(e);
    throw new Error(
      `${kind} failed — try a smaller ${sizeWord} or a different edge / face (${detail}).`,
    );
  }
}

function finalizeFilletBuilder(mk, shape) {
  mk.Build();
  if (!mk.IsDone()) return shape;
  return mk.Shape();
}

export function chamferShape(shape, edgePositions, amount = 0.05) {
  if (!shape || !edgePositions || edgePositions.length === 0) return shape;
  return runFilletOp("Chamfer", () => {
    const oc = getOcc();
    const mk = new oc.BRepFilletAPI_MakeChamfer(shape);
    // Walk every edge of the shape, add to the chamfer-builder if its
    // endpoints match any requested edge.
    const exp = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let added = 0;
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      for (const ep of edgePositions) {
        const posA = { x: ep.ax, y: ep.ay, z: ep.az };
        const posB = { x: ep.bx, y: ep.by, z: ep.bz };
        if (edgeMatchesEndpoints(oc, edge, posA, posB)) {
          mk.Add_2(amount, edge);
          added++;
          break;
        }
      }
      exp.Next();
    }
    if (added === 0) return shape;
    return finalizeFilletBuilder(mk, shape);
  });
}

// ── Fillet (rounded) ─────────────────────────────────────────────────────
export function filletShape(shape, edgePositions, radius = 0.05) {
  if (!shape || !edgePositions || edgePositions.length === 0) return shape;
  return runFilletOp("Fillet", () => {
    const oc = getOcc();
    const mk = new oc.BRepFilletAPI_MakeFillet(
      shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    const exp = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let added = 0;
    while (exp.More()) {
      const edge = oc.TopoDS.Edge_1(exp.Current());
      for (const ep of edgePositions) {
        const posA = { x: ep.ax, y: ep.ay, z: ep.az };
        const posB = { x: ep.bx, y: ep.by, z: ep.bz };
        if (edgeMatchesEndpoints(oc, edge, posA, posB)) {
          mk.Add_2(radius, edge);
          added++;
          break;
        }
      }
      exp.Next();
    }
    if (added === 0) return shape;
    return finalizeFilletBuilder(mk, shape);
  });
}

// ── Face-based chamfer / fillet ──────────────────────────────────────────
// Selecting a FACE in the viewport (e.g. the top cap of a cylinder) sends
// a list of `{nx, ny, nz}` face-normal entries instead of edge endpoints.
// To chamfer/fillet the boundary of those faces, walk every face of the
// shape, compute its outward normal, match against the requested normals,
// and add every edge of each matching face to the builder.  Edges shared
// between two matching faces are added only once.

function computeFaceNormal(oc, face) {
  // For both planar and curved faces, use BRepAdaptor_Surface to read the
  // surface derivatives at the centre of the UV domain and take their
  // cross product.  For curved faces this gives the normal at the mid-
  // point; for the cap of a cylinder/cone this is exactly the cap normal.
  let adaptor;
  try {
    adaptor = new oc.BRepAdaptor_Surface_2(face, false);
  } catch {
    return null;
  }
  const u = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
  const v = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
  const pnt = new oc.gp_Pnt_1();
  const du = new oc.gp_Vec_1();
  const dv = new oc.gp_Vec_1();
  try {
    adaptor.D1(u, v, pnt, du, dv);
  } catch {
    return null;
  }
  const cross = du.Crossed(dv);
  const mag = cross.Magnitude();
  if (mag < 1e-9) return null;
  // OCC face orientation flips the geometric normal when the face is
  // REVERSED in the shell.
  const reversed =
    face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  const sign = reversed ? -1 : 1;
  return {
    x: (cross.X() / mag) * sign,
    y: (cross.Y() / mag) * sign,
    z: (cross.Z() / mag) * sign,
  };
}

function edgeEndpointKey(oc, edge) {
  const verts = [];
  const exp = new oc.TopExp_Explorer_2(
    edge,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (exp.More()) {
    const v = oc.TopoDS.Vertex_1(exp.Current());
    const p = oc.BRep_Tool.Pnt(v);
    verts.push(
      `${Math.round(p.X() * 1000)},${Math.round(p.Y() * 1000)},${Math.round(p.Z() * 1000)}`,
    );
    exp.Next();
  }
  return verts.sort().join("|");
}

// Walk `shape`'s faces.  For each face whose outward normal matches any
// entry in `faceNormals` (within `eps`), invoke `onEdge(edge)` for every
// unique edge of that face.  `addedKeys` is the dedup set, shared across
// calls so an edge between two matching faces is only added once.
function forEachEdgeOfMatchingFaces(
  oc,
  shape,
  faceNormals,
  addedKeys,
  onEdge,
  eps = 0.05,
) {
  let added = 0;
  const faceExp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const n = computeFaceNormal(oc, face);
    if (!n) {
      faceExp.Next();
      continue;
    }
    const matched = faceNormals.some((req) => {
      if (
        Math.abs(req.nx - n.x) >= eps ||
        Math.abs(req.ny - n.y) >= eps ||
        Math.abs(req.nz - n.z) >= eps
      ) {
        return false;
      }
      // If the stored selection carries a centroid sample point, require
      // it to lie ON this face.  Two coplanar faces of a CSG result
      // (e.g. the top of a stepped solid, or a holed extrude's outer
      // top + the hole's top rim) share a normal, and without this
      // check chamferShapeBy would apply the operation to every one.
      if (req.cx == null) return true;
      const pnt = new oc.gp_Pnt_3(req.cx, req.cy, req.cz);
      const vMk = new oc.BRepBuilderAPI_MakeVertex(pnt);
      const vertex = vMk.Vertex();
      const dist = new oc.BRepExtrema_DistShapeShape_2(
        vertex,
        face,
        oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
        oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      );
      dist.Perform();
      if (!dist.IsDone() || dist.NbSolution() < 1) return false;
      return dist.Value() < 0.05;
    });
    if (matched) {
      // Walk EVERY edge of the matched face — both the outer wire and any
      // inner wires (holes).  When the user selects the top of an object
      // with holes, they expect the chamfer/fillet to be applied to the
      // outer perimeter AND the hole's perimeter (the hole stays open,
      // just with a chamfered top edge).  OCC's BRepFilletAPI handles
      // concave (hole) edges correctly as long as the chamfer/fillet
      // amount is small relative to the hole size.
      const edgeExp = new oc.TopExp_Explorer_2(
        face,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (edgeExp.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExp.Current());
        const key = edgeEndpointKey(oc, edge);
        if (!addedKeys.has(key)) {
          onEdge(edge, face);
          addedKeys.add(key);
          added++;
        }
        edgeExp.Next();
      }
    }
    faceExp.Next();
  }
  return added;
}

// Find one adjacent face for the given edge, scanning the parent shape.
// Used as the reference face when applying an angled chamfer (AddDA needs
// to know which face the angle is measured against).
function findAdjacentFace(oc, shape, targetEdge) {
  const targetKey = edgeEndpointKey(oc, targetEdge);
  const faceExp = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (faceExp.More()) {
    const face = oc.TopoDS.Face_1(faceExp.Current());
    const edgeExp = new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (edgeExp.More()) {
      const e = oc.TopoDS.Edge_1(edgeExp.Current());
      if (edgeEndpointKey(oc, e) === targetKey) return face;
      edgeExp.Next();
    }
    faceExp.Next();
  }
  return null;
}

// Chamfer / fillet the boundary of every face whose normal matches one of
// `faceNormals`.  If `edgePositions` is non-empty, those edges are also
// added (so callers can mix face-selection and edge-selection in a single
// operation, matching the UI's behaviour).
//
// `angleRad` is OPTIONAL.  When omitted (or null), uses the simple
// symmetric `Add_2(dist, edge)`.  When provided, uses
// `AddDA(dist, angle, edge, refFace)` so the user can control the slant
// of the chamfer face relative to a reference face — angleRad=π/4 with
// perpendicular adjacent faces is symmetric and matches the no-angle
// case; smaller/larger angles tilt the chamfer toward one face.
export function chamferShapeBy(shape, subGeo, amount = 0.05, angleRad = null) {
  if (!shape) return shape;
  const edgePositions = subGeo?.edges || [];
  const faceNormals = subGeo?.faces || [];
  if (edgePositions.length === 0 && faceNormals.length === 0) return shape;
  return runFilletOp("Chamfer", () => {
    const oc = getOcc();
    const mk = new oc.BRepFilletAPI_MakeChamfer(shape);
    const addedKeys = new Set();
    let added = 0;

    const useAngle = typeof angleRad === "number" && isFinite(angleRad);
    const addEdge = (edge, refFace) => {
      if (useAngle && refFace) {
        mk.AddDA(amount, angleRad, edge, refFace);
      } else {
        mk.Add_2(amount, edge);
      }
    };

    // 1. Add edges from explicit edge endpoints.
    if (edgePositions.length > 0) {
      const exp = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (exp.More()) {
        const edge = oc.TopoDS.Edge_1(exp.Current());
        for (const ep of edgePositions) {
          const posA = { x: ep.ax, y: ep.ay, z: ep.az };
          const posB = { x: ep.bx, y: ep.by, z: ep.bz };
          if (edgeMatchesEndpoints(oc, edge, posA, posB)) {
            const key = edgeEndpointKey(oc, edge);
            if (!addedKeys.has(key)) {
              const refFace = useAngle
                ? findAdjacentFace(oc, shape, edge)
                : null;
              addEdge(edge, refFace);
              addedKeys.add(key);
              added++;
            }
            break;
          }
        }
        exp.Next();
      }
    }

    // 2. Add edges from the boundary of every face matching a requested
    // normal.  When an angle was specified, the matched face is the
    // natural reference.
    if (faceNormals.length > 0) {
      added += forEachEdgeOfMatchingFaces(
        oc,
        shape,
        faceNormals,
        addedKeys,
        (edge, matchedFace) => addEdge(edge, matchedFace),
      );
    }

    if (added === 0) return shape;
    return finalizeFilletBuilder(mk, shape);
  });
}

export function filletShapeBy(shape, subGeo, radius = 0.05) {
  if (!shape) return shape;
  const edgePositions = subGeo?.edges || [];
  const faceNormals = subGeo?.faces || [];
  if (edgePositions.length === 0 && faceNormals.length === 0) return shape;
  return runFilletOp("Fillet", () => {
    const oc = getOcc();
    const mk = new oc.BRepFilletAPI_MakeFillet(
      shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    const addedKeys = new Set();
    let added = 0;

    if (edgePositions.length > 0) {
      const exp = new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      while (exp.More()) {
        const edge = oc.TopoDS.Edge_1(exp.Current());
        for (const ep of edgePositions) {
          const posA = { x: ep.ax, y: ep.ay, z: ep.az };
          const posB = { x: ep.bx, y: ep.by, z: ep.bz };
          if (edgeMatchesEndpoints(oc, edge, posA, posB)) {
            const key = edgeEndpointKey(oc, edge);
            if (!addedKeys.has(key)) {
              mk.Add_2(radius, edge);
              addedKeys.add(key);
              added++;
            }
            break;
          }
        }
        exp.Next();
      }
    }

    if (faceNormals.length > 0) {
      added += forEachEdgeOfMatchingFaces(
        oc,
        shape,
        faceNormals,
        addedKeys,
        (edge) => mk.Add_2(radius, edge),
      );
    }

    if (added === 0) return shape;
    return finalizeFilletBuilder(mk, shape);
  });
}

// ── Transforms (apply translation/rotation to a shape) ───────────────────

export function transformShape(shape, position, rotation) {
  if (!shape) return shape;
  const oc = getOcc();
  // We want world = T · R_z · R_y · R_x · local (i.e. rotate the local
  // point in XYZ-Euler order, then translate to world).  OCC's
  // `gp_Trsf::Multiply(T)` is `this = this * T`, so to build
  //    trsf = T · R_z · R_y · R_x
  // we must SET translation first and then `Multiply` with R_z, R_y,
  // R_x in that order.  The old order (rotations first, translation
  // last) produced trsf = R_x · R_y · R_z · T, which translates BEFORE
  // rotating — visible as a boolean cut whose hole lands at the
  // wrong world XZ when the input has a non-zero polyCentroid offset
  // (e.g. an extrude on a global plane).
  const trsf = new oc.gp_Trsf_1();
  if (position) {
    trsf.SetTranslation_1(new oc.gp_Vec_4(position.x, position.y, position.z));
  }
  if (rotation) {
    if (rotation.z) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(0, 0, 1)),
        rotation.z,
      );
      trsf.Multiply(r);
    }
    if (rotation.y) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(0, 1, 0)),
        rotation.y,
      );
      trsf.Multiply(r);
    }
    if (rotation.x) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(1, 0, 0)),
        rotation.x,
      );
      trsf.Multiply(r);
    }
  }
  const mk = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return mk.Shape();
}
