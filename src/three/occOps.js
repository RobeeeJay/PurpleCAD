// Pure OCC operation bodies, shared between the worker (occ.worker.js)
// and the in-process fallback used by node tests and pre-worker browsers.
//
// Each op takes a plain-JS args object and returns a Promise resolving to
// a plain-JS result (or null for no-ops).  No TopoDS_Shape ever escapes
// these functions — when a single user action needs multiple OCC steps,
// they compose those steps inside one op so only the final tessellation
// crosses the boundary.

import { ensureOcc } from "./occ/init.js";
import {
  buildItemShapeLocal,
  buildBrushTransform,
} from "./csgUtils.js";
import {
  booleanOp,
  chamferShapeBy,
  filletShapeBy,
  transformShape,
} from "./occ/operations.js";
import { tessellate, tessellateToData } from "./occ/tessellate.js";

// Compute axis-aligned bbox over a flat [x,y,z, x,y,z, ...] positions
// array.  Used by every op that centres its output around its bbox —
// inlining keeps occOps free of three.js so the worker bundle doesn't
// pull THREE in just to call Box3.
function bboxOf(positions) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Apply a chamfer (segments===1) or fillet (segments>1) and return the
// centred tessellation plus the bbox-centre offset the caller uses to
// place the new item in world space.
async function chamferOrFilletItem({
  source,
  subGeo,
  amount,
  angleRad,
  segments,
  allItems,
  printPrecision,
}) {
  await ensureOcc();
  const sourceShape = buildItemShapeLocal(source, allItems);
  if (!sourceShape) return null;
  const result =
    segments === 1
      ? chamferShapeBy(sourceShape, subGeo, amount, angleRad)
      : filletShapeBy(sourceShape, subGeo, amount);
  if (!result || result === sourceShape) return null;
  const data = tessellateToData(result, printPrecision);
  if (!data) return null;

  const arr = data.positions;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = new Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    centered[i] = arr[i] - cx;
    centered[i + 1] = arr[i + 1] - cy;
    centered[i + 2] = arr[i + 2] - cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: data.normals,
      indices: data.indices,
    },
    centerOffset: { cx, cy, cz },
  };
}

// Build each item's OCC shape in world space and combine them with the
// given boolean operation, then tessellate and centre the result around
// its bbox.  `position` is the world-space bbox centre (== where the
// caller should place the new item so its mesh origin is its volumetric
// centre).
async function performCsg({
  selectedItems,
  allItems,
  operation,
  printPrecision,
}) {
  await ensureOcc();
  const sources = allItems || selectedItems;
  const shapes = [];
  for (const item of selectedItems) {
    const local = buildItemShapeLocal(item, sources);
    if (!local) continue;
    const { position, rotation } = buildBrushTransform(item);
    const world = transformShape(local, position, rotation);
    if (world) shapes.push(world);
  }
  if (shapes.length < 2) return null;
  const result = booleanOp(operation, shapes);
  if (!result) return null;
  const tess = tessellate(result, printPrecision ?? null);
  if (!tess) return null;
  const posAttr = tess.getAttribute("position");
  const normAttr = tess.getAttribute("normal");
  const idxAttr = tess.index;
  const positions = Array.from(posAttr.array);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }
  return {
    position: { x: cx, y: cy, z: cz },
    geometryData: {
      positions,
      normals: normAttr ? Array.from(normAttr.array) : null,
      indices: idxAttr ? Array.from(idxAttr.array) : null,
    },
  };
}

export const ops = {
  chamferOrFilletItem,
  performCsg,
};
