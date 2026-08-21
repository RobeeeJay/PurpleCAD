// Combining regenerators: 3D patterns, plain booleans, and the fused
// extrudeUnion / extrudeCut bodies whose prism recipes live in the
// regenerator itself.  Split out of regenerateItems.js.

import * as THREE from "three";
import { withLivePolygons, hostFaceExtentAlongNormal } from "../csgUtils.js";
import { pattern3dItem, performCsg } from "../occClient.js";

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

export async function regenerate3dPattern(
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

export async function regenerateBoolean(
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

// A multi-area extrude fused into one body, self-contained: the prism recipes
// (extrude item defs) are embedded in `extrudeDefs` rather than referenced as
// separate store items, so the whole multi-area extrude is ONE timeline entry.
// Optional `inputIds` are host solids (a boss) fused in too.  Each prism is
// rebuilt from its live sketch polygon so the union tracks sketch edits.
// Rebuild a multi-area extrude from its EMBEDDED prism recipes.  `isCut`
// subtracts them from the host solids instead of fusing: the hosts lead so
// performCsg treats them as the difference argument and the prisms as tools.
export async function regenerateExtrudeUnion(
  regenerator,
  accumulatedItems,
  printPrecision,
  isCut = false,
) {
  let prisms = (regenerator.extrudeDefs || []).map((d) =>
    withLivePolygons(d, accumulatedItems, printPrecision),
  );
  const hosts = (regenerator.inputIds || [])
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean)
    .map((i) => withLivePolygons(i, accumulatedItems, printPrecision));
  // A cut whose target vanished would silently rebuild as the union of its
  // prisms — leaving the holes as solid pegs.  Bail instead.
  if (isCut && (hosts.length === 0 || prisms.length === 0)) return null;
  // An offset cut tracks the host face it was started from: re-anchor each
  // prism's startOffset to the host's CURRENT extent along the cut normal
  // (plus the authored inset), so a variable that resizes the body keeps the
  // cut registered to that face instead of leaving it floating in space.
  if (isCut) {
    const ref = prisms.find((pr) => (pr.startOffset || 0) !== 0)?.profile;
    if (ref?.normalWorld && ref.position) {
      const top = hostFaceExtentAlongNormal(
        hosts,
        ref.normalWorld,
        ref.position,
      );
      if (top != null) {
        const inset = regenerator.cutStartInset ?? 0;
        prisms = prisms.map((pr) =>
          (pr.startOffset || 0) !== 0
            ? { ...pr, startOffset: top + inset }
            : pr,
        );
      }
    }
  }
  const inputs = isCut ? [...hosts, ...prisms] : [...prisms, ...hosts];
  if (inputs.length < 1) return null;
  return performCsg({
    selectedItems: inputs,
    operation: isCut ? "difference" : "union",
    printPrecision,
    allItems: accumulatedItems,
  });
}
