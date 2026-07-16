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
  shellItem,
  holeItem,
  embossItem,
  draftItem,
  revolveItem,
  pipeItem,
  loftItem,
  pattern3dItem,
  performCsg,
} from "./occClient.js";
import { buildEmbossStamp } from "./embossGeometry.js";
import { MM_PER_UNIT } from "./sceneObjects.js";

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

// Re-anchor a chained op's item position to its LIVE source every recalc.
//
// A chamfer/emboss/hole/… is placed at its source's brush position plus its
// bbox-centre offset; the user may then gizmo-MOVE it, adding a world delta.
// Storing the absolute position and KEEPING it (the old behaviour) breaks the
// instant an insert/edit repoints the source (relinkSourceChain): the geometry
// rebuilds on the NEW source while the position stays pinned to the OLD one, so
// the object shifts — the recurring "inserting a chamfer after a chamfer moves
// the body" bug.  Instead we remember the SOURCE BRUSH position we last anchored
// to (regenerator.basePosition) and shift the on-screen position by however much
// that brush point moved.  Deliberately keyed on the brush point alone, NOT the
// centre-offset: a resolution toggle re-tessellates and nudges the bbox centre
// slightly, and we must NOT let that jitter the object (the old code kept the
// position fixed on a toggle for exactly this reason).
export function resolveChainedPosition(
  source,
  centerOffset,
  currentPosition,
  storedBrush,
) {
  const brushPos = buildBrushTransform(source).position;
  // Common path: shift the current position by the source-brush delta, so an
  // insert/edit that moved the source carries the body with it, while a
  // resolution toggle (same source, zero delta) leaves it untouched.
  if (storedBrush && currentPosition) {
    return {
      position: {
        x: currentPosition.x + (brushPos.x - storedBrush.x),
        y: currentPosition.y + (brushPos.y - storedBrush.y),
        z: currentPosition.z + (brushPos.z - storedBrush.z),
      },
      base: brushPos,
    };
  }
  // Legacy item (no recorded brush) but a position exists: keep it, and record
  // the brush so the NEXT recalc can re-anchor precisely.
  if (currentPosition) return { position: currentPosition, base: brushPos };
  // No current position (a fresh sketch-driven rebuild): place it at the full
  // source-anchored base (brush + centre-offset rotated into the source frame).
  const { cx, cy, cz } = centerOffset;
  const rot = source.rotation || { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3(cx, cy, cz).applyEuler(
    new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
  );
  return {
    position: {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    },
    base: brushPos,
  };
}

async function regenerateChamfer(
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

async function regeneratePushPull(
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
async function regenerateShell(
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
async function regenerateDraft(
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
async function regenerateHole(
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

// Find the underlying extrude (through csg sources) whose profile is the wall's
// cross-section.
const wallExtrude = (item) => {
  let it = item;
  while (it && !it.profile?.polygon2D && it.regenerator?.source)
    it = it.regenerator.source;
  return it?.profile?.polygon2D ? it : null;
};

export function reviveDevelopable(faceSet, liveSource /*, frozenSource */) {
  const dev = faceSet?.developable;
  if (
    !dev ||
    !Array.isArray(dev.curve) ||
    !Array.isArray(dev.e1) ||
    !Array.isArray(dev.e2)
  )
    return faceSet;
  // REBUILD the wrap curve from the LIVE wall cross-section (its outer profile
  // in the developable's e1/e2 frame), so the relief follows the current size.
  // buildDevelopableConformMesh anchors the text at the curve point NEAREST the
  // face — not by index — so a freshly-sampled curve needs no alignment; the
  // text just re-centres on the resized wall.  norms are the radial-normalised
  // curve; arc is cumulative length (matching extractDevelopableProfile).
  const ext = wallExtrude(liveSource);
  const poly = ext?.profile?.polygon2D;
  if (!Array.isArray(poly) || poly.length < 3) return faceSet;
  const pc = ext.profile.profileCentroid || { x: 0, y: 0 };
  const [e1x, e1y] = dev.e1; // z-component is 0 for a profile-plane wall
  const [e2x, e2y] = dev.e2;
  const curve = poly.map((p) => {
    const x = p.x - pc.x,
      y = p.y - pc.y;
    return { u: x * e1x + y * e1y, v: x * e2x + y * e2y };
  });
  const norms = curve.map(({ u, v }) => {
    const r = Math.hypot(u, v) || 1;
    return { u: u / r, v: v / r };
  });
  const arc = [0];
  for (let i = 1; i < curve.length; i++)
    arc.push(
      arc[i - 1] +
        Math.hypot(curve[i].u - curve[i - 1].u, curve[i].v - curve[i - 1].v),
    );
  return { ...faceSet, developable: { ...dev, curve, arc, norms } };
}

// The emboss face/faceSet anchors are absolute coordinates in the frame the
// emboss was AUTHORED in.  A relink (reorder / delete of an upstream step) can
// swap the source kind — an extrude delivers its raw local frame, a csg is
// bbox-centred by its centerOffset — so translate the anchors by
// (authoredOffset - currentOffset) to express them in the CURRENT source's
// frame.  The wrap curve itself is centroid-relative (reviveDevelopable), so
// only the absolute pieces move: the face point, the developable's axial extent
// (aMin/aMax along the axis), and the cylinder/sphere fit centres.
export function shiftEmbossFrame(face, faceSet, regenerator, source) {
  const auth = regenerator.sourceCenterOffset;
  if (!auth) return { face, faceSet }; // legacy recipe — keep today's behaviour
  const cur = source?.regenerator?.centerOffset ?? { cx: 0, cy: 0, cz: 0 };
  const dx = auth.cx - cur.cx,
    dy = auth.cy - cur.cy,
    dz = auth.cz - cur.cz;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9)
    return { face, faceSet };
  const shiftPt = (p) =>
    p && p.cx != null
      ? { ...p, cx: p.cx + dx, cy: p.cy + dy, cz: p.cz + dz }
      : p;
  const out = { face: shiftPt(face), faceSet };
  if (faceSet) {
    const fs = { ...faceSet };
    if (fs.developable) {
      const dev = fs.developable;
      const along = dev.axis
        ? dx * dev.axis[0] + dy * dev.axis[1] + dz * dev.axis[2]
        : 0;
      fs.developable = {
        ...dev,
        ...(Number.isFinite(dev.aMin) ? { aMin: dev.aMin + along } : null),
        ...(Number.isFinite(dev.aMax) ? { aMax: dev.aMax + along } : null),
      };
    }
    if (fs.cylinder) fs.cylinder = shiftPt(fs.cylinder);
    if (fs.sphere) fs.sphere = shiftPt(fs.sphere);
    out.faceSet = fs;
  }
  return out;
}

// Rebuild an emboss/deboss relief from its live source + sketch geometry.  The
// stamp is recomputed from the (possibly edited) sketch profiles each pass.
async function regenerateEmboss(
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
  // Express the authored anchors in the CURRENT source's frame (a relink may
  // have swapped the source kind — see shiftEmbossFrame).
  const { face: frameFace, faceSet: frameFaceSet } = shiftEmbossFrame(
    regenerator.face,
    regenerator.faceSet,
    regenerator,
    source,
  );
  // Re-derive the wrap curve from the live wall so the relief follows a resized
  // profile instead of wrapping the baked (old-radius) developable.
  const liveFaceSet = reviveDevelopable(
    frameFaceSet,
    source,
    regenerator.source,
  );
  const stamp =
    buildEmbossStamp(
      regenerator.profiles,
      frameFace,
      regenerator.params,
      liveItems,
      printPrecision,
      liveFaceSet,
      source?.scale?.x ?? 1,
    ) || regenerator.stamp;
  let result;
  try {
    result = await embossItem({
      source,
      stamp,
      allItems: liveItems,
      printPrecision,
      ...(solidOpts || {}),
    });
  } catch (err) {
    console.warn(`Emboss regen failed (${err.message}); keeping geometry.`);
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
    shapeId: result.shapeId,
    stamp,
  };
}

// Rebuild a texture (bump-map displacement) from its live source: base mesh →
// displace by the stored heightfield params → bbox-centred result.  Pure JS
// displacement (textureDisplace.js); only the base tessellation touches OCC.
async function regenerateTexture(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const { displaceMeshAsync } = await import("./textureWorkerClient.js");
  const { assertTriBudget } = await import("./textureDisplace.js");
  const { decodeHeightfield } = await import("./textureImage.js");
  const liveItems = accumulatedItems.map((i) =>
    withLivePolygons(i, accumulatedItems, printPrecision),
  );
  const source = withLivePolygons(
    regenerator.source,
    liveItems,
    printPrecision,
  );
  const { face: frameFace, faceSet: frameFaceSet } = shiftEmbossFrame(
    regenerator.face,
    regenerator.faceSet,
    regenerator,
    source,
  );
  let result = null;
  try {
    let mesh = source.geometryData;
    if (!mesh?.positions?.length) {
      const { tessellateItem } = await import("./occClient.js");
      const tess = await tessellateItem({
        source,
        allItems: liveItems,
        printPrecision,
      });
      mesh = tess?.geometryData;
    }
    const heightfield = await decodeHeightfield(regenerator.params.png);
    if (mesh && heightfield) {
      const p = regenerator.params;
      const sc = source?.scale?.x ?? 1;
      const mm = (v) => v / MM_PER_UNIT / sc;
      assertTriBudget(
        regenerator.faceTris,
        frameFaceSet,
        source.dimensions,
        Math.max(mm(p.resolutionMm ?? 1), 1e-4),
        p.resolutionMm,
      );
      result = await displaceMeshAsync({
        mesh,
        face: frameFace,
        faceSet: frameFaceSet,
        faceTris: regenerator.faceTris,
        heightfield,
        params: {
          projection: p.projection,
          sizeU: Math.max(mm(p.sizeMm ?? 10), 1e-6),
          depth: mm(p.depthMm ?? 1),
          offsetU: mm(p.offsetHMm ?? 0),
          offsetV: mm(p.offsetVMm ?? 0),
          rotationRad: ((p.rotationDeg ?? 0) * Math.PI) / 180,
          wrap: !!p.wrap,
          resolution: Math.max(mm(p.resolutionMm ?? 1), 1e-4),
        },
      });
    }
  } catch (err) {
    console.warn(`Texture regen failed (${err.message}); keeping geometry.`);
    return null;
  }
  if (!result) return null;
  // Bbox-centre (the csg convention) and re-anchor like every chained op.
  const pos = result.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  const centerOffset = {
    cx: (min[0] + max[0]) / 2,
    cy: (min[1] + max[1]) / 2,
    cz: (min[2] + max[2]) / 2,
  };
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] -= centerOffset.cx;
    pos[i + 1] -= centerOffset.cy;
    pos[i + 2] -= centerOffset.cz;
  }
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    centerOffset,
    currentPosition,
    regenerator.basePosition,
  );
  return { position, basePosition, geometryData: result, centerOffset };
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

// A multi-area extrude fused into one body, self-contained: the prism recipes
// (extrude item defs) are embedded in `extrudeDefs` rather than referenced as
// separate store items, so the whole multi-area extrude is ONE timeline entry.
// Optional `inputIds` are host solids (a boss) fused in too.  Each prism is
// rebuilt from its live sketch polygon so the union tracks sketch edits.
async function regenerateExtrudeUnion(
  regenerator,
  accumulatedItems,
  printPrecision,
) {
  const prisms = (regenerator.extrudeDefs || []).map((d) =>
    withLivePolygons(d, accumulatedItems, printPrecision),
  );
  const hosts = (regenerator.inputIds || [])
    .map((id) => accumulatedItems.find((i) => i.id === id))
    .filter(Boolean)
    .map((i) => withLivePolygons(i, accumulatedItems, printPrecision));
  const inputs = [...prisms, ...hosts];
  if (inputs.length < 1) return null;
  return performCsg({
    selectedItems: inputs,
    operation: "union",
    printPrecision,
    allItems: accumulatedItems,
  });
}

// `onProgress({ current, total })` fires after each item that ACTUALLY
// needed regeneration completes — used by the orchestrator to drive the
// busy-indicator's timeline-recalculation progress bar.  Items that
// skip the regen path (no regenerator, or already at the requested
// precision) are NOT counted: there's nothing to wait for there.
// `solidCtx`, when present (the timeline JIT cache path only), lets each
// single-input op consume a cached input solid instead of rebuilding its whole
// recipe in OCC, and hand its own result solid back to the cache:
//   { inputs: Map<itemId, shapeId|null>, results: Map<itemId, shapeId> }
// The op still builds the source JS object + remaps its subGeo (cheap), so the
// cached input — which always reflects the current sketch, because a changed
// input is recomputed-and-recached before its consumer runs here — stays
// consistent with the remap.  Absent solidCtx (live preview / resolution
// sweep), ops release their result as before and nothing is cached.
export async function regenerateItemsForResolution(
  items,
  printPrecision,
  onProgress = null,
  solidCtx = null,
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
    // Timeline cache path: hand this op its cached input solid (or null → the
    // op rebuilds from source) and ask it to retain its result so we can cache
    // it.  Only the single-input ops below participate.
    const solidOpts = solidCtx
      ? {
          sourceShapeId: solidCtx.inputs.get(item.id) ?? null,
          retainResult: true,
        }
      : null;
    // Single-input ops take a cached input solid (solidOpts); the rest ignore
    // it.  `opts` is null on the retry path (rebuild from the recipe source).
    const dispatch = (opts) => {
      switch (r.kind) {
        case "chamfer":
          return regenerateChamfer(
            r,
            out,
            printPrecision,
            item.position,
            item.depth,
            opts,
          );
        case "pushpull":
          return regeneratePushPull(
            r,
            out,
            printPrecision,
            item.position,
            item.depth,
            opts,
          );
        case "shell":
          return regenerateShell(r, out, printPrecision, item.position, opts);
        case "hole":
          return regenerateHole(r, out, printPrecision, item.position, opts);
        case "emboss":
          return regenerateEmboss(r, out, printPrecision, item.position, opts);
        case "texture":
          return regenerateTexture(r, out, printPrecision, item.position);
        case "draft":
          return regenerateDraft(r, out, printPrecision, item.position, opts);
        case "revolve":
          return regenerateRevolve(r, out, printPrecision, item.position);
        case "pipe":
          return regeneratePipe(r, out, printPrecision, item.position);
        case "loft":
          return regenerateLoft(r, out, printPrecision, item.position);
        case "pattern3d":
          return regenerate3dPattern(r, out, printPrecision, item.position);
        case "boolean":
          return regenerateBoolean(r, out, printPrecision);
        case "extrudeUnion":
          return regenerateExtrudeUnion(r, out, printPrecision);
        default:
          return null;
      }
    };
    let result = await dispatch(solidOpts);
    // A cached input can be stale for this op (upstream topology/frame drift on
    // a mid-timeline insert) even when a full recipe rebuild would succeed.  If
    // the cached path failed, retry once rebuilding from the source before
    // flagging the step bad.
    if (!result && solidOpts?.sourceShapeId != null) {
      result = await dispatch({ ...solidOpts, sourceShapeId: null });
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
        r.kind === "shell" ||
        r.kind === "hole" ||
        r.kind === "emboss" ||
        r.kind === "draft" ||
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
    // Hand this op's retained result solid to the timeline cache so the next
    // op in the chain can consume it instead of rebuilding.  Only set when the
    // op actually retained one (single-input ops on the solidCtx path).
    if (solidCtx && result.shapeId != null) {
      solidCtx.results.set(item.id, result.shapeId);
    }
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
        r.kind === "shell" ||
        r.kind === "hole" ||
        r.kind === "emboss" ||
        r.kind === "draft" ||
        r.kind === "revolve" ||
        r.kind === "pipe" ||
        r.kind === "loft" ||
        r.kind === "pattern3d") &&
      result.centerOffset
    ) {
      nextRegen.centerOffset = result.centerOffset;
    }
    // Remember the source-anchored base we placed this op at, so the next recalc
    // can re-anchor the user's move-delta onto a fresh base (resolveChainedPosition)
    // instead of leaving the position pinned to a stale source after an insert/edit.
    if (result.basePosition) nextRegen.basePosition = result.basePosition;
    // Carry the freshly-recomputed stamp so buildItemShapeLocal stays in sync
    // with the live sketch geometry.
    if (r.kind === "emboss" && result.stamp) nextRegen.stamp = result.stamp;
    out.push({
      ...item,
      position: result.position,
      geometryData: result.geometryData,
      regenerator: nextRegen,
    });
  }
  return changed ? out : items;
}
