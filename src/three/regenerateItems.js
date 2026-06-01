import * as THREE from "three";
import { buildBrushTransform, extrudeWithLivePolygon } from "./csgUtils.js";
// Routed through occClient → the OCC worker.  This file is no longer
// imported from the store (the orchestrator in regenerateOrchestrator.js
// is what Viewport pulls in), so it's outside the worker's transitive
// graph and the previous cycle no longer applies.
import { chamferOrFilletItem, performCsg } from "./occClient.js";

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

// Re-derive any extrude profile in an item (or, recursively, in a chamfer's
// source) from its sketch at the requested precision, so curved holes/outlines
// tessellate finer at print resolution.  The Electron OCC bridge can't import
// this ESM helper and otherwise builds prisms from the stored preview polygon;
// occOps.js does this inside buildItemShapeLocal.  CRUCIAL: the SAME live
// polygon must feed both the OCC shape AND the brush position
// (buildBrushTransform adds R·polyCentroid, which buildItemShapeLocal subtracts
// — they only cancel if both use the same polygon, else the object shifts when
// print resolution is toggled).
function withLivePolygons(item, allItems, precision) {
  if (!item) return item;
  if (item.type === "extrude") {
    return extrudeWithLivePolygon(item, allItems, precision);
  }
  if (
    item.type === "csg" &&
    item.regenerator?.kind === "chamfer" &&
    item.regenerator.source
  ) {
    return {
      ...item,
      regenerator: {
        ...item.regenerator,
        source: withLivePolygons(item.regenerator.source, allItems, precision),
      },
    };
  }
  return item;
}

async function regenerateChamfer(
  regenerator,
  accumulatedItems,
  printPrecision,
) {
  const subGeo = regenerator.subGeo || { edges: [], faces: [] };
  if ((subGeo.edges?.length || 0) === 0 && (subGeo.faces?.length || 0) === 0)
    return null;
  const source = withLivePolygons(
    regenerator.source,
    accumulatedItems,
    printPrecision,
  );
  const result = await chamferOrFilletItem({
    source,
    subGeo,
    amount: regenerator.amount ?? 0.05,
    angleRad: regenerator.angleRad ?? null,
    segments: regenerator.segments,
    allItems: accumulatedItems,
    printPrecision,
  });
  if (!result) return null;
  const {
    geometryData,
    centerOffset: { cx, cy, cz },
  } = result;
  // World position = source's brush position + centroid offset rotated into
  // world space.  Use the SAME (live) source as the shape build above so the
  // polyCentroid terms cancel and the object doesn't shift on a resolution
  // toggle.
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
    geometryData,
    // Propagated up so the regenerator gets the freshly-computed
    // centerOffset stamped in (regen at a different precision can
    // produce a slightly different bbox).
    centerOffset: { cx, cy, cz },
  };
}

async function regenerateBoolean(
  regenerator,
  accumulatedItems,
  printPrecision,
) {
  const inputs = regenerator.inputIds
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean);
  if (inputs.length < 2) return null;
  // Rebuild each input from its live (current-precision) polygon so the OCC
  // shapes match the positions the chamfer regen just stamped — otherwise a
  // chamfered-extrude input goes in with a coarse-polygon shape but a
  // fine-polygon position and the boolean result jumps on a resolution toggle.
  const liveInputs = inputs.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  return performCsg({
    selectedItems: liveInputs,
    operation: regenerator.op,
    printPrecision,
    allItems: accumulatedItems,
  });
}

// `onProgress({ current, total })` fires after each item that ACTUALLY
// needed regeneration completes — used by the orchestrator to drive the
// busy-indicator's timeline-recalculation progress bar.  Items that
// skip the regen path (no regenerator, or already at the requested
// precision) are NOT counted: there's nothing to wait for there.
export async function regenerateItemsForResolution(
  items,
  printPrecision,
  onProgress = null,
) {
  if (!items || items.length === 0) return items;
  const total = items.reduce((n, item) => {
    const r = item.regenerator;
    if (!r) return n;
    if (r.regeneratedAt === printPrecision && item.geometryData) return n;
    return n + 1;
  }, 0);
  if (onProgress) onProgress({ current: 0, total });
  let progressed = 0;
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
    progressed += 1;
    if (onProgress) onProgress({ current: progressed, total });
    if (!result) {
      out.push(item);
      continue;
    }
    changed = true;
    // Carry the freshly-computed centerOffset back onto the chamfer
    // regenerator so buildItemShapeLocal stays in sync with the bbox
    // a re-tessellation just produced.
    const nextRegen = { ...r, regeneratedAt: printPrecision };
    if (r.kind === "chamfer" && result.centerOffset) {
      nextRegen.centerOffset = result.centerOffset;
    }
    out.push({
      ...item,
      position: result.position,
      geometryData: result.geometryData,
      regenerator: nextRegen,
    });
  }
  return changed ? out : items;
}
