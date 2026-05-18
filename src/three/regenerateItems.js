import * as THREE from "three";
import { buildBrushTransform } from "./csgUtils.js";
// Use the in-process ops directly rather than going through occClient.
// The store dynamically imports this file, so its transitive deps end up
// in the worker bundle (via Vite's `inlineDynamicImports` for workers);
// importing occClient here would create a cycle (occClient → worker →
// regenerateItems → occClient).  The trade-off is that resolution-toggle
// regeneration runs on the main thread — live chamfer/CSG creation still
// goes through the worker via BevelSection / CombineSection.
import { ops } from "./occOps.js";

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
//
// Regeneration is async because both branches go through occClient, which
// posts to the OCC Web Worker in the browser and runs in-process in node.

async function regenerateChamfer(regenerator, accumulatedItems, printPrecision) {
  const subGeo = regenerator.subGeo || { edges: [], faces: [] };
  if ((subGeo.edges?.length || 0) === 0 && (subGeo.faces?.length || 0) === 0)
    return null;
  const result = await ops.chamferOrFilletItem({
    source: regenerator.source,
    subGeo,
    amount: regenerator.amount ?? 0.05,
    angleRad: regenerator.angleRad ?? null,
    segments: regenerator.segments,
    allItems: accumulatedItems,
    printPrecision,
  });
  if (!result) return null;
  const { geometryData, centerOffset: { cx, cy, cz } } = result;
  // World position = source's brush position + centroid offset rotated
  // into world space (so chained chamfers stay anchored to their source).
  const brushPos = buildBrushTransform(regenerator.source).position;
  const rot = regenerator.source.rotation || { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3(cx, cy, cz);
  local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
  return {
    position: {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    },
    geometryData,
  };
}

async function regenerateBoolean(regenerator, accumulatedItems, printPrecision) {
  const inputs = regenerator.inputIds
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean);
  if (inputs.length < 2) return null;
  return ops.performCsg({
    selectedItems: inputs,
    operation: regenerator.op,
    printPrecision,
    allItems: accumulatedItems,
  });
}

export async function regenerateItemsForResolution(items, printPrecision) {
  if (!items || items.length === 0) return items;
  const out = [];
  let changed = false;
  // Sequential: each iteration can depend on earlier results in `out`
  // (e.g. a boolean whose inputIds reference items we just regenerated).
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
      result = await regenerateChamfer(r, out, printPrecision);
    } else if (r.kind === "boolean") {
      result = await regenerateBoolean(r, out, printPrecision);
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
