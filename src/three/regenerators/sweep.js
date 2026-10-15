// Sweep regenerators: revolve, pipe and loft — the ops that build a solid by
// moving a profile along an axis or path.  Split out of regenerateItems.js.

import { withLivePolygons } from "../csgUtils.js";
import { revolveItem, pipeItem, loftItem } from "../occClient.js";
import { resolveChainedPosition } from "./shared.js";

export async function regenerateRevolve(
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

export async function regeneratePipe(
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

export async function regenerateLoft(
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
