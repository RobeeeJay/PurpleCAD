import * as THREE from "three";
import { buildBrushTransform, performCsg } from "./csgUtils.js";
import { makePrimitiveShape } from "./occ/primitives.js";
import {
  chamferShape,
  filletShape,
} from "./occ/operations.js";
import { tessellateToData } from "./occ/tessellate.js";

// Items that came from CSG or chamfer operations store a `regenerator`
// field describing how to re-run the operation.  This lets us recompute
// their geometry whenever the user toggles the resolution setting — so
// primitives (sphere/cylinder/torus) baked into a boolean or chamfer at
// preview resolution can be refreshed to print quality and back without
// redoing the edit.
//
// Shape of the regenerator field:
//   • Boolean op:  { kind: "boolean", op: "union"|..., inputIds: [a, b, …] }
//   • Chamfer:     { kind: "chamfer", source: {...preChamferItem},
//                    subGeo: { edges, faces }, amount, segments }
//   • (Legacy "bevel" entries from before the OCC migration are ignored —
//     callers should regenerate the item via the new chamfer flow.)

function regenerateChamfer(regenerator, printPrecision) {
  const source = regenerator.source;
  const sourceShape = makePrimitiveShape(source);
  if (!sourceShape) return null;
  const edges = regenerator.subGeo?.edges || [];
  if (edges.length === 0) return null;
  const op = regenerator.segments === 1 ? chamferShape : filletShape;
  const result = op(sourceShape, edges, regenerator.amount ?? 0.05);
  if (!result) return null;
  const data = tessellateToData(result, printPrecision);
  if (!data) return null;
  // Centre, compute world position via source's brush transform.
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
  const centered = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    centered[i] = arr[i] - cx;
    centered[i + 1] = arr[i + 1] - cy;
    centered[i + 2] = arr[i + 2] - cz;
  }
  const brushPos = buildBrushTransform(source).position;
  const rot = source.rotation || { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3(cx, cy, cz);
  local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
  return {
    position: {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    },
    geometryData: {
      positions: Array.from(centered),
      normals: data.normals,
      indices: data.indices,
    },
  };
}

function regenerateBoolean(regenerator, accumulatedItems, printPrecision) {
  const inputs = regenerator.inputIds
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean);
  if (inputs.length < 2) return null;
  return performCsg(inputs, regenerator.op, { printPrecision });
}

export function regenerateItemsForResolution(items, printPrecision) {
  if (!items || items.length === 0) return items;
  const out = [];
  let changed = false;
  for (const item of items) {
    const r = item.regenerator;
    if (!r) {
      out.push(item);
      continue;
    }
    if (r.regeneratedAt === printPrecision && item.geometryData) {
      out.push(item);
      continue;
    }
    let result = null;
    if (r.kind === "chamfer") {
      result = regenerateChamfer(r, printPrecision);
    } else if (r.kind === "boolean") {
      result = regenerateBoolean(r, out, printPrecision);
    }
    if (!result) {
      out.push(item);
      continue;
    }
    changed = true;
    out.push({
      ...item,
      position: result.position,
      geometryData: result.geometryData,
      regenerator: { ...r, regeneratedAt: printPrecision },
    });
  }
  return changed ? out : items;
}
