import * as THREE from "three";
import {
  buildBrushTransform,
  withLivePolygons,
  withLiveDepth,
  remapExtrudeFaceSelections,
} from "./csgUtils.js";
// Routed through occClient → the OCC worker.  This file is no longer
// imported from the store (the orchestrator in regenerateOrchestrator.js
// is what Viewport pulls in), so it's outside the worker's transitive
// graph and the previous cycle no longer applies.
import {
  chamferOrFilletItem,
  pushPullFaces,
  revolveItem,
  pipeItem,
  loftItem,
  pattern3dItem,
  performCsg,
} from "./occClient.js";

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

async function regenerateChamfer(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  currentDepth,
) {
  const rawSubGeo = regenerator.subGeo || { edges: [], faces: [] };
  if (
    (rawSubGeo.edges?.length || 0) === 0 &&
    (rawSubGeo.faces?.length || 0) === 0
  )
    return null;
  // In Electron the OCC bridge can't re-derive an extrude's profile from its
  // sketch, so it builds whatever polygon2D each item carries.  When the
  // chamfer's source is a union/boolean, its extrude inputs are looked up by id
  // in `allItems` on the bridge — so pre-bake the live polygon into EVERY item,
  // not just the source, or the union rebuilds at the OLD sketch size and the
  // chamfer stays stale after a dimension change. (occOps re-derives in-process,
  // which is why this only bit the packaged app.)
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    withLiveDepth(regenerator.source, currentDepth),
    liveItems,
    printPrecision,
  );
  // A sketch edit moves the polygon edges a side-face chamfer was bound to —
  // re-point the face selections at the live edges so OCC can still find them.
  const subGeo = remapExtrudeFaceSelections(
    rawSubGeo,
    regenerator.source,
    source,
  );
  // A no-match throws inside chamferOrFilletItem; swallow it so one
  // un-resolvable chamfer keeps its last-good geometry instead of aborting the
  // whole timeline recalc (which left every downstream step stale).
  let result;
  try {
    result = await chamferOrFilletItem({
      source,
      subGeo,
      amount: regenerator.amount ?? 0.05,
      angleRad: regenerator.angleRad ?? null,
      segments: regenerator.segments,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Chamfer/fillet regen couldn't re-match its selection (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  // Keep the item's existing position.  The re-tessellated geometry is centred
  // on its own bbox (centerOffset), so the rendered centre is item.position
  // regardless of precision — and that's exactly where the user already sees
  // (and may have gizmo-rotated) the object.  Recomputing the position from the
  // source's brush transform moves it: the source rotation no longer matches
  // the item's once the bevelled object has been rotated independently.  Only
  // the mesh density should change on a resolution toggle.
  let position = currentPosition;
  if (!position) {
    const { cx, cy, cz } = result.centerOffset;
    const brushPos = buildBrushTransform(source).position;
    const rot = source.rotation || { x: 0, y: 0, z: 0 };
    const local = new THREE.Vector3(cx, cy, cz);
    local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
    position = {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    };
  }
  return {
    position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

async function regeneratePushPull(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  currentDepth,
) {
  const rawSubGeo = regenerator.subGeo || { faces: [] };
  if ((rawSubGeo.faces?.length || 0) === 0) return null;
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    withLiveDepth(regenerator.source, currentDepth),
    liveItems,
    printPrecision,
  );
  // A sketch edit moves the polygon edges a side-face selection was bound to —
  // re-point the face selections at the live edges so OCC can still find them.
  const subGeo = remapExtrudeFaceSelections(
    rawSubGeo,
    regenerator.source,
    source,
  );
  let result;
  try {
    result = await pushPullFaces({
      source,
      subGeo,
      distance: regenerator.distance ?? 0,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Push/pull regen couldn't re-match its selection (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  // Keep the item's existing position (same rationale as regenerateChamfer):
  // the re-tessellated geometry is bbox-centred, so the rendered centre is
  // already item.position regardless of precision.
  let position = currentPosition;
  if (!position) {
    const { cx, cy, cz } = result.centerOffset;
    const brushPos = buildBrushTransform(source).position;
    const rot = source.rotation || { x: 0, y: 0, z: 0 };
    const local = new THREE.Vector3(cx, cy, cz);
    local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
    position = {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    };
  }
  return {
    position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

async function regenerateRevolve(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    regenerator.source,
    liveItems,
    printPrecision,
  );
  let result;
  try {
    result = await revolveItem({
      source,
      axis: regenerator.axis,
      angleRad: regenerator.angleRad,
      prismSides: regenerator.prismSides,
      offsetPerRotation: regenerator.offsetPerRotation,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Revolve regen couldn't rebuild (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  // The revolve bbox-centres its result; recompute the world centre from the
  // profile's sketch-plane brush transform + the fresh centre offset so the
  // origin tracks a sketch edit (recalculateTimeline drops currentPosition).
  let position = currentPosition;
  if (!position) {
    const { cx, cy, cz } = result.centerOffset;
    const brushPos = buildBrushTransform(source).position;
    const rot = source.rotation || { x: 0, y: 0, z: 0 };
    const local = new THREE.Vector3(cx, cy, cz);
    local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
    position = {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    };
  }
  return {
    position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

async function regeneratePipe(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const profileSource = withLivePolygons(
    regenerator.profileSource,
    liveItems,
    printPrecision,
  );
  let result;
  try {
    result = await pipeItem({
      profileSource,
      pathRef: regenerator.pathRef,
      twistTurns: regenerator.twistTurns,
      autoRotate: regenerator.autoRotate,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Pipe regen couldn't rebuild (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  // Pipe is built in world, so the bbox centre IS the position; recalculate-
  // Timeline drops currentPosition to let a sketch edit re-centre the origin.
  return {
    position: currentPosition || result.position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

async function regenerateLoft(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const profileSource = withLivePolygons(
    regenerator.profileSource,
    liveItems,
    printPrecision,
  );
  const secondProfileSource = withLivePolygons(
    regenerator.secondProfileSource,
    liveItems,
    printPrecision,
  );
  let result;
  try {
    result = await loftItem({
      profileSource,
      secondProfileSource,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Loft regen couldn't rebuild (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  // Built in world, so the bbox centre is the position; recalculateTimeline
  // drops currentPosition to let a sketch edit re-centre the origin.
  return {
    position: currentPosition || result.position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

// Resolve a 3D pattern's live params: mirror/circular read the plane object's
// frame (origin + normal); circular uses the normal as the rotation axis.
function resolvePatternParams(r, items) {
  if (r.patternType === "rectangular") {
    return {
      countX: r.countX,
      countY: r.countY,
      countZ: r.countZ,
      dx: r.dx,
      dy: r.dy,
      dz: r.dz,
    };
  }
  // A circular pattern carries a baked axis (a picked sketch line / face edge).
  if (r.patternType === "circular" && r.axisOrigin && r.axisDir) {
    return {
      origin: r.axisOrigin,
      axis: r.axisDir,
      count: r.count,
      angleRad: r.angleRad,
      axialOffset: r.axialOffset,
    };
  }
  const plane = items.find((i) => i.id === r.planeId);
  if (!plane) return null;
  const rot = plane.rotation || { x: 0, y: 0, z: 0 };
  const nv = new THREE.Vector3(0, 0, 1).applyEuler(
    new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
  );
  const origin = plane.position || { x: 0, y: 0, z: 0 };
  const normal = { x: nv.x, y: nv.y, z: nv.z };
  if (r.patternType === "mirror") return { origin, normal };
  return { origin, axis: normal, count: r.count, angleRad: r.angleRad };
}

async function regenerate3dPattern(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const params = resolvePatternParams(regenerator, liveItems);
  if (!params) return null;
  let result;
  try {
    result = await pattern3dItem({
      patternType: regenerator.patternType,
      sourceId: regenerator.sourceId,
      params,
      allItems: liveItems,
      printPrecision,
    });
  } catch (err) {
    console.warn(
      `Pattern regen couldn't rebuild (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  return {
    position: currentPosition || result.position,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
  };
}

async function regenerateBoolean(
  regenerator,
  accumulatedItems,
  printPrecision,
) {
  const inputs = (regenerator.inputIds || [])
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean);
  // 0 inputs → nothing to rebuild (keep last geometry).  1 input is valid: a
  // multi-area union reduced to a single region fuses to just that prism, so
  // the dropped region's geometry actually disappears instead of lingering.
  if (inputs.length < 1) return null;
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
      result = await regenerateChamfer(
        r,
        out,
        printPrecision,
        item.position,
        item.depth,
      );
    } else if (r.kind === "pushpull") {
      result = await regeneratePushPull(
        r,
        out,
        printPrecision,
        item.position,
        item.depth,
      );
    } else if (r.kind === "revolve") {
      result = await regenerateRevolve(r, out, printPrecision, item.position);
    } else if (r.kind === "pipe") {
      result = await regeneratePipe(r, out, printPrecision, item.position);
    } else if (r.kind === "loft") {
      result = await regenerateLoft(r, out, printPrecision, item.position);
    } else if (r.kind === "pattern3d") {
      result = await regenerate3dPattern(r, out, printPrecision, item.position);
    } else if (r.kind === "boolean") {
      result = await regenerateBoolean(r, out, printPrecision);
    }
    progressed += 1;
    if (onProgress) onProgress({ current: progressed, total });
    if (!result) {
      // A chamfer/fillet that was asked to rebuild but produced nothing — the
      // selection couldn't be re-matched or OCC rejected it after the geometry
      // changed.  Keep its last-good mesh but flag it so the timeline marks the
      // step bad until the user retargets / re-applies it.  Stop re-attempting
      // (settle regeneratedAt) so a clean pass doesn't spam OCC every recalc.
      if (
        r.kind === "chamfer" ||
        r.kind === "pushpull" ||
        r.kind === "revolve" ||
        r.kind === "pipe" ||
        r.kind === "loft" ||
        r.kind === "pattern3d"
      ) {
        changed = true;
        out.push({
          ...item,
          regenerator: {
            ...r,
            regeneratedAt: printPrecision,
            regenFailed: true,
          },
        });
      } else {
        out.push(item);
      }
      continue;
    }
    changed = true;
    // Carry the freshly-computed centerOffset back onto the chamfer
    // regenerator so buildItemShapeLocal stays in sync with the bbox
    // a re-tessellation just produced.  Clear any prior failure flag.
    const nextRegen = {
      ...r,
      regeneratedAt: printPrecision,
      regenFailed: false,
    };
    if (
      (r.kind === "chamfer" ||
        r.kind === "pushpull" ||
        r.kind === "revolve" ||
        r.kind === "pipe" ||
        r.kind === "loft" ||
        r.kind === "pattern3d") &&
      result.centerOffset
    ) {
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
