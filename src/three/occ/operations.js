// OCC operations (boolean, chamfer, fillet, transform) via native C++ addon.
//
// All functions accept and return native shape IDs (integers).  The native
// addon allocates a new shape for each operation; callers are responsible
// for releasing IDs they no longer need via occ.releaseShape().
//
// When chamfer/fillet finds no matching edges, the original shapeId is
// returned (same behaviour as the former WASM path which returned the
// unmodified source shape).

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const occ = _require("../../../native/occ-addon/build/Release/occ_addon.node");

export function booleanOp(op, shapes) {
  return occ.booleanOp(shapes, op);
}
export function unionShapes(shapes) {
  return occ.booleanOp(shapes, "union");
}
export function differenceShapes(shapes) {
  return occ.booleanOp(shapes, "difference");
}
export function intersectShapes(shapes) {
  return occ.booleanOp(shapes, "intersection");
}

export function chamferShape(shapeId, edges, amount) {
  if (!Array.isArray(edges) || edges.length === 0) return shapeId;
  const result = occ.chamferShape(shapeId, { edges, faces: [] }, amount, null);
  return result || shapeId;
}

export function chamferShapeBy(shapeId, subGeo, amount, angleRad) {
  const result = occ.chamferShape(shapeId, subGeo, amount, angleRad ?? null);
  return result || shapeId;
}

export function filletShapeBy(shapeId, subGeo, amount) {
  const result = occ.filletShape(shapeId, subGeo, amount);
  return result || shapeId;
}

export function transformShape(shapeId, pos, rot) {
  return occ.transformShape(
    shapeId,
    pos?.x ?? 0,
    pos?.y ?? 0,
    pos?.z ?? 0,
    rot?.x ?? 0,
    rot?.y ?? 0,
    rot?.z ?? 0,
  );
}
