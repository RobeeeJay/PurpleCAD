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
  if (pts.length < 2) return false;
  const close = (a, b) =>
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.z - b.z) < eps;
  return (
    (close(pts[0], posA) && close(pts[1], posB)) ||
    (close(pts[0], posB) && close(pts[1], posA))
  );
}

export function chamferShape(shape, edgePositions, amount = 0.05) {
  if (!shape || !edgePositions || edgePositions.length === 0) return shape;
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
  mk.Build();
  if (!mk.IsDone()) return shape;
  return mk.Shape();
}

// ── Fillet (rounded) ─────────────────────────────────────────────────────
export function filletShape(shape, edgePositions, radius = 0.05) {
  if (!shape || !edgePositions || edgePositions.length === 0) return shape;
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
  mk.Build();
  if (!mk.IsDone()) return shape;
  return mk.Shape();
}

// ── Transforms (apply translation/rotation to a shape) ───────────────────

export function transformShape(shape, position, rotation) {
  if (!shape) return shape;
  const oc = getOcc();
  const trsf = new oc.gp_Trsf_1();
  // Compose rotations in XYZ order (matches THREE.Euler default).
  if (rotation) {
    if (rotation.x) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(
          new oc.gp_Pnt_3(0, 0, 0),
          new oc.gp_Dir_4(1, 0, 0),
        ),
        rotation.x,
      );
      trsf.Multiply(r);
    }
    if (rotation.y) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(
          new oc.gp_Pnt_3(0, 0, 0),
          new oc.gp_Dir_4(0, 1, 0),
        ),
        rotation.y,
      );
      trsf.Multiply(r);
    }
    if (rotation.z) {
      const r = new oc.gp_Trsf_1();
      r.SetRotation_1(
        new oc.gp_Ax1_2(
          new oc.gp_Pnt_3(0, 0, 0),
          new oc.gp_Dir_4(0, 0, 1),
        ),
        rotation.z,
      );
      trsf.Multiply(r);
    }
  }
  if (position) {
    const t = new oc.gp_Trsf_1();
    t.SetTranslation_1(new oc.gp_Vec_4(position.x, position.y, position.z));
    trsf.Multiply(t);
  }
  const mk = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return mk.Shape();
}
