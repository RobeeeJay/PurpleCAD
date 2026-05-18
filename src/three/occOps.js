// Pure OCC operation bodies, shared between the worker (occ.worker.js)
// and the in-process fallback used by node tests and pre-worker browsers.
//
// Each op takes a plain-JS args object and returns a Promise resolving to
// a plain-JS result (or null for no-ops).  No TopoDS_Shape ever escapes
// these functions — when a single user action needs multiple OCC steps,
// they compose those steps inside one op so only the final tessellation
// crosses the boundary.

import { ensureOcc } from "./occ/init.js";
import { buildItemShapeLocal } from "./csgUtils.js";
import { chamferShapeBy, filletShapeBy } from "./occ/operations.js";
import { tessellateToData } from "./occ/tessellate.js";

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
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < arr.length; i += 3) {
    if (arr[i] < minX) minX = arr[i];
    if (arr[i] > maxX) maxX = arr[i];
    if (arr[i + 1] < minY) minY = arr[i + 1];
    if (arr[i + 1] > maxY) maxY = arr[i + 1];
    if (arr[i + 2] < minZ) minZ = arr[i + 2];
    if (arr[i + 2] > maxZ) maxZ = arr[i + 2];
  }
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

export const ops = {
  chamferOrFilletItem,
};
