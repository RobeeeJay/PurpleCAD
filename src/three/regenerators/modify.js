// Face-modify regenerators: chamfer/fillet, push-pull, shell, draft, hole and
// simplify.
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
  simplifyMesh,
  rebuildSurfaces,
} from "../occClient.js";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { resolveChainedPosition } from "./shared.js";

// The selection is coordinates in the frame of the source it was picked on:
// that source's centring (its regenerator's centerOffset; none for an
// extrude).  A relink can bind a source centred differently -- an appended
// chamfer picked against the emboss under it (offset 0) was later rebound to
// the previous chamfer's result (offset z 14), so its rim points sat 14 units
// off the body.  On a faceted body the normal fallback hid that; on an exact
// one it matched hundreds of lettering edges and the chamfer failed.  Shift
// the selection by (authored - current) centring.  A recipe from before the
// authored centring was recorded is in one of two frames -- as it is, or the
// raw frame under the current centring -- and takes the one whose points lie
// nearer the source's body.
function selectionInSourceFrame(subGeo, regenerator, source) {
  const zero = { cx: 0, cy: 0, cz: 0 };
  const cur = source?.regenerator?.centerOffset ?? zero;
  const by = (auth) => ({
    cx: auth.cx - cur.cx,
    cy: auth.cy - cur.cy,
    cz: auth.cz - cur.cz,
  });
  const moved = (d) =>
    Math.abs(d.cx) > 1e-9 || Math.abs(d.cy) > 1e-9 || Math.abs(d.cz) > 1e-9;
  if (regenerator.sourceCenterOffset) {
    const d = by(regenerator.sourceCenterOffset);
    return moved(d) ? shiftSelection(subGeo, d) : subGeo;
  }
  const d = by(zero);
  const P = source?.geometryData?.positions;
  if (!moved(d) || !P?.length) return subGeo;
  // How far the selection's points are from the body: each from its nearest
  // mesh vertex (an edge is where the mesh has vertices; in the wrong frame
  // the points land mid-face, where an exact face's mesh has none).  A bounding
  // box can't tell: both frames often fall inside it.
  const pts = (sel) =>
    sel.edges
      .flatMap((e) => [
        [e.ax, e.ay, e.az],
        [e.bx, e.by, e.bz],
      ])
      .concat(
        sel.faces.filter((f) => f.cx != null).map((f) => [f.cx, f.cy, f.cz]),
      );
  const off = (sel) => {
    let sum = 0;
    for (const [x, y, z] of pts(sel)) {
      let best = Infinity;
      for (let i = 0; i < P.length; i += 3) {
        const d = (P[i] - x) ** 2 + (P[i + 1] - y) ** 2 + (P[i + 2] - z) ** 2;
        if (d < best) best = d;
      }
      sum += Math.sqrt(best);
    }
    return sum;
  };
  const shifted = shiftSelection(subGeo, d);
  return off(shifted) < off(subGeo) ? shifted : subGeo;
}

// An appended chamfer re-runs the merged selection -- the previous chamfer's
// edges, then its own -- on the PRE-chamfer source.  A relink can rebind its
// source to that previous chamfer's RESULT, where the first edges are already
// bevelled away: matched by their normals alone, each took up to four
// unrelated edges of the body and the chamfer failed.  When the source is the
// chamfer whose selection this one starts with, drop that part; the source has
// already done it.
function withoutAppliedEdges(subGeo, source) {
  const prior = source?.regenerator;
  const done = prior?.kind === "chamfer" ? prior.subGeo?.edges || [] : [];
  const edges = subGeo.edges || [];
  if (done.length === 0 || done.length >= edges.length) return subGeo;
  const same = (a, b) =>
    ["ax", "ay", "az", "bx", "by", "bz"].every(
      (k) => Math.abs(a[k] - b[k]) < 1e-9,
    );
  if (!done.every((e, i) => same(e, edges[i]))) return subGeo;
  return { ...subGeo, edges: edges.slice(done.length) };
}

// A selection moved by d: edge end points and face sample points; normals
// don't change under a translation.
function shiftSelection(sel, d) {
  const face = (f) =>
    f.cx == null
      ? f
      : { ...f, cx: f.cx + d.cx, cy: f.cy + d.cy, cz: f.cz + d.cz };
  const edge = (e) => ({
    ...e,
    ax: e.ax + d.cx,
    ay: e.ay + d.cy,
    az: e.az + d.cz,
    bx: e.bx + d.cx,
    by: e.by + d.cy,
    bz: e.bz + d.cz,
  });
  return {
    ...sel,
    edges: (sel.edges || []).map(edge),
    faces: (sel.faces || []).map(face),
  };
}

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
    selectionInSourceFrame(
      withoutAppliedEdges(rawSubGeo, source),
      regenerator,
      source,
    ),
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

// Simplify a mesh body's baked mesh natively, held to a measured deviation or
// cut to a triangle count.  The result is in the body's own local frame, so
// it keeps the body's position, rotation and scale.  `params` is what the
// dialog stores: { mode: "deviation", toleranceMm } or
// { mode: "triangles", targetTriangles }.
export async function simplifySource(source, params) {
  const g = source?.geometryData;
  if (!g?.positions?.length) return null;
  const deviation = params.mode === "deviation";
  const r = await simplifyMesh({
    positions: g.positions,
    indices: g.indices,
    mode: params.mode,
    value: deviation
      ? params.toleranceMm / MM_PER_UNIT
      : params.targetTriangles,
  });
  if (!r) return null;
  return {
    // Flat-shaded like an imported mesh: a smooth normal averaged across a
    // simplified mesh's large triangles would bend the light across edges.
    geometryData: {
      positions: r.positions,
      indices: r.indices,
      normals: null,
      flat: true,
    },
    stats: {
      trianglesBefore: r.trianglesBefore,
      trianglesAfter: r.trianglesAfter,
      maxDeviationMm: r.maxDeviation * MM_PER_UNIT,
    },
  };
}

// Rebuild a simplify from its live source: the source's mesh at the current
// resolution, simplified again with the stored parameters.
export async function regenerateSimplify(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const source = regenerator.source;
  let result;
  try {
    result = await simplifySource(source, regenerator);
  } catch (err) {
    console.warn(
      `Simplify regen failed (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    { cx: 0, cy: 0, cz: 0 },
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    stats: result.stats,
  };
}

// Rebuild a mesh body's baked mesh as exact faces: each region recognised as
// a plane, cylinder, cone, sphere, torus or oval wall becomes one face on it,
// the rest stay triangles (occOps.js#rebuildSurfaces).  In the body's own
// frame, like Simplify.  Throws with the reason when the rebuilt solid is
// refused; the body then stays a mesh.
export async function convertSource(source, params, printPrecision) {
  const g = source?.geometryData;
  if (!g?.positions?.length) return null;
  const r = await rebuildSurfaces({
    positions: g.positions,
    indices: g.indices,
    tolerance: params.toleranceMm / MM_PER_UNIT,
    printPrecision,
  });
  if (!r) return null;
  return {
    geometryData: { ...r.geometryData, normals: null },
    brep: r.brep,
    stats: {
      faces: r.faces,
      faceTypes: r.faceTypes,
      volumeMm3: r.volume * MM_PER_UNIT ** 3,
      meshVolumeMm3: r.meshVolume * MM_PER_UNIT ** 3,
      maxEdgeToleranceMm: r.maxEdgeTolerance * MM_PER_UNIT,
    },
  };
}

// Rebuild a conversion from its source mesh at the current Resolution, as
// Simplify does.
export async function regenerateConvert(
  regenerator,
  accumulatedItems,
  printPrecision,
  currentPosition,
) {
  const source = regenerator.source;
  let result;
  try {
    result = await convertSource(source, regenerator, printPrecision);
  } catch (err) {
    console.warn(
      `Convert to surfaces regen failed (${err.message}); keeping previous geometry.`,
    );
    return null;
  }
  if (!result) return null;
  const { position, base: basePosition } = resolveChainedPosition(
    source,
    { cx: 0, cy: 0, cz: 0 },
    currentPosition,
    regenerator.basePosition,
  );
  return {
    position,
    basePosition,
    geometryData: result.geometryData,
    brep: result.brep,
    stats: result.stats,
  };
}
