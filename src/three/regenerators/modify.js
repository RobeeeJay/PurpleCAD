// Face-modify regenerators: chamfer/fillet, push-pull, shell, draft and hole.
// Each rebuilds one op from its frozen recipe against the LIVE source, then
// re-anchors the result with resolveChainedPosition.  Split out of
// regenerateItems.js.

import {
  withLivePolygons,
  withLiveDepth,
  remapExtrudeFaceSelections,
} from "../csgUtils.js";
import {
  chamferOrFilletItem,
  pushPullFaces,
  shellItem,
  holeItem,
  draftItem,
} from "../occClient.js";
import { resolveChainedPosition } from "./shared.js";

export async function regenerateChamfer(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  currentDepth,
  solidOpts = null,
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
      ...(solidOpts || {}),
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
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    // Present only when the caller passed retainResult (timeline solid cache);
    // undefined on the live-preview path, which releases its result as before.
    shapeId: result.shapeId,
  };
}

export async function regeneratePushPull(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  currentDepth,
  solidOpts = null,
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
      ...(solidOpts || {}),
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
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    // Present only when the caller passed retainResult (timeline solid cache);
    // undefined on the live-preview path, which releases its result as before.
    shapeId: result.shapeId,
  };
}

// Rebuild a shell from its live source.  Mirrors regeneratePushPull without a
// face selection: re-derive the source, hollow it, and (if the source tracks a
// sketch and the position was dropped) recompute the bbox-centred position.
export async function regenerateShell(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  solidOpts = null,
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
    result = await shellItem({
      source,
      thickness: regenerator.thickness ?? 0,
      allItems: liveItems,
      printPrecision,
      ...(solidOpts || {}),
    });
  } catch (err) {
    console.warn(
      `Shell regen failed (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    // Present only when the caller passed retainResult (timeline solid cache);
    // undefined on the live-preview path, which releases its result as before.
    shapeId: result.shapeId,
  };
}

// Rebuild a draft from its live source.  Mirrors regenerateShell.
export async function regenerateDraft(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  solidOpts = null,
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
    result = await draftItem({
      source,
      neutral: regenerator.neutral,
      faces: regenerator.faces || [],
      angleDeg: regenerator.angleDeg ?? 0,
      flip: !!regenerator.flip,
      allItems: liveItems,
      printPrecision,
      ...(solidOpts || {}),
    });
  } catch (err) {
    console.warn(
      `Draft regen failed (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    // Present only when the caller passed retainResult (timeline solid cache);
    // undefined on the live-preview path, which releases its result as before.
    shapeId: result.shapeId,
  };
}

// Rebuild a drilled hole from its live source.  Mirrors regenerateShell.
export async function regenerateHole(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
  solidOpts = null,
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
    result = await holeItem({
      source,
      hole: regenerator.hole,
      allItems: liveItems,
      printPrecision,
      ...(solidOpts || {}),
    });
  } catch (err) {
    console.warn(`Hole regen failed (${err.message}); keeping geometry.`);
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    result.centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    centerOffset: result.centerOffset,
    // Present only when the caller passed retainResult (timeline solid cache);
    // undefined on the live-preview path, which releases its result as before.
    shapeId: result.shapeId,
  };
}
