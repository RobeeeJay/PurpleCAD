// Shared tail of the chamfer/fillet pipeline — used by both BevelSection's
// retarget() and ChamferOverlay's apply().  Pure helpers: they read/write
// the store via useStore directly, so they don't need to be hooks.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  buildBrushTransform,
  extrudeWithLivePolygon,
  withLivePolygons,
  withLiveDepth,
} from "../csgUtils.js";
import { releaseSolid } from "../solidCache.js";

// Preview-result cache: Confirm reuses the geometry the live preview already
// computed for the SAME inputs instead of re-running the OCC op — the preview
// ran the identical chamferOrFilletItem recipe moments earlier (mirrors the
// emboss previewCache).  Keyed on everything the result depends on; any
// mismatch (or no preview) falls back to a fresh build.  Consumed on take.
let previewCache = null;
export const chamferPreviewKey = ({
  source,
  subGeo,
  amount,
  angleRad,
  segments,
  printPrecision,
}) =>
  JSON.stringify({
    amount,
    angleRad,
    segments,
    printPrecision,
    sid: source?.id,
    p: source?.position,
    r: source?.rotation,
    sc: source?.scale,
    sg: subGeo,
  });
export function stashChamferPreview(key, result) {
  previewCache = { key, result };
}
export function takeChamferPreview(key) {
  const hit =
    previewCache && previewCache.key === key ? previewCache.result : null;
  previewCache = null; // consume regardless — a stale entry must not linger
  return hit;
}

// The newly-clicked face/edge selection is in the rendered (bbox-centred)
// mesh's frame; prior.subGeo lives in the source's frame, offset by
// -centerOffset.  Shift the new picks back into the source frame so they
// line up with the geometry chamferOrFilletItem will search.
export const shiftSelectionToSource = (sel, centerOffset) => {
  const off = centerOffset || { cx: 0, cy: 0, cz: 0 };
  const shiftFace = (f) =>
    f.cx == null
      ? f
      : { ...f, cx: f.cx + off.cx, cy: f.cy + off.cy, cz: f.cz + off.cz };
  const shiftEdge = (ed) => ({
    ...ed,
    ax: ed.ax + off.cx,
    ay: ed.ay + off.cy,
    az: ed.az + off.cz,
    bx: ed.bx + off.cx,
    by: ed.by + off.cy,
    bz: ed.bz + off.cz,
  });
  return {
    edges: (sel.edges || []).map(shiftEdge),
    faces: (sel.faces || []).map(shiftFace),
  };
};

// Open the CREATION overlay to edit a committed chamfer/fillet.  The timeline
// is restored to the PREVIOUS step so the pre-chamfer body is on screen — the
// op re-runs on its source, and the rim being re-picked doesn't exist on the
// beveled result mesh.  That is exactly the state the user picked against at
// creation, so the stored subGeo (source frame) needs no centerOffset shift.
// The entry's recipe rides along in chamferEditTarget because the replayed
// item no longer carries it.
export const beginChamferEdit = (itemId, entryId) => {
  const store = useStore.getState();
  const idx = store.history.findIndex((h) => h.id === entryId);
  const prior = store.history[idx]?.instruction?.patches?.regenerator;
  if (idx < 1 || !prior || prior.kind !== "chamfer") return;
  store.restoreToHistory(store.history[idx - 1].id);
  store.selectItem(itemId);
  store.setSelectedSubGeometry({
    itemId,
    edges: prior.subGeo?.edges || [],
    faces: prior.subGeo?.faces || [],
  });
  store.setChamferSelectMode(prior.segments === 1 ? "chamfer" : "fillet");
  store.setChamferEditTarget({ itemId, entryId, prior });
};

// Derive the OCC source shape + subGeo selection for a chamfer/fillet —
// shared by the live preview and the Confirm commit so both run the exact
// same recipe. Two cases:
//  - appending: a prior chamfer/fillet with the same amount/segments exists
//    — re-run on ITS source with the union of its subGeo and the new picks.
//  - fresh (also the editing path, which views the pre-chamfer step):
//    snapshot the current item (with its live polygon/depth) as the source
//    and use the selection as-is.
export const buildChamferSourceAndSubGeo = ({
  item,
  items,
  selectedSubGeometry,
  amount,
  segments,
  printPrecision,
  editing,
}) => {
  const prior = item.regenerator;
  // Editing runs with the timeline restored to the pre-chamfer step, so the
  // live item IS the source and the picks are already in its frame — the
  // fresh branch below is the exact creation-time recipe.  Only the append
  // branch must be bypassed: at that step the item's own regenerator can be
  // an EARLIER chamfer, and merging into it would rewrite the wrong entry.
  if (
    !editing &&
    prior?.kind === "chamfer" &&
    prior.amount === amount &&
    prior.segments === segments
  ) {
    // prior.source is the extrude snapshot captured at the FIRST chamfer.
    // After a sketch / variable / depth edit it's stale, so re-derive its
    // live polygon and pull the current depth off the item — otherwise the
    // appended chamfer is built (and positioned via buildBrushTransform) at
    // the old size and the object jumps in height.
    const source = extrudeWithLivePolygon(
      { ...prior.source, depth: item.depth ?? prior.source.depth },
      items,
      printPrecision,
    );
    // The newly-clicked face/edge was picked on THIS item's rendered mesh,
    // whose geometry is bbox-centred (the prior chamfer subtracted its
    // centerOffset).  prior.subGeo lives in the original source's frame, and
    // we re-run the chamfer on that source — so shift the new selection back
    // into the source frame by +centerOffset before merging, or it lands in
    // the wrong place and matches no face (the second chamfer silently does
    // nothing).  The centring is a pure translation, so normals are
    // unchanged.
    const shifted = shiftSelectionToSource(
      selectedSubGeometry,
      prior.centerOffset,
    );
    const subGeo = {
      edges: [...(prior.subGeo?.edges || []), ...shifted.edges],
      faces: [...(prior.subGeo?.faces || []), ...shifted.faces],
    };
    return { source, subGeo };
  }
  // KEEP the source's existing regenerator: buildItemShapeLocal needs it to
  // rebuild a CSG source's OCC shape from its boolean / prior-chamfer recipe.
  // Re-derive the extrude's profile from its CURRENT sketch (withLivePolygons
  // recurses into nested CSG sources too) so the chamfer is built from the
  // live polygon/depth, not a stale one.
  const source = withLivePolygons(
    withLiveDepth({ ...item }, item.depth),
    items,
    printPrecision,
  );
  const subGeo = {
    edges: selectedSubGeometry.edges || [],
    faces: selectedSubGeometry.faces || [],
  };
  return { source, subGeo };
};

// World position for a chamfer/fillet result mesh: the source's brush
// transform plus its bbox-centre offset, rotated into the source's frame.
// Shared by commitChamferResult (final item.position) and the live preview
// (positions the temporary preview mesh identically).
export const chamferResultTransform = (source, centerOffset) => {
  const { cx, cy, cz } = centerOffset;
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
    rotation: rot,
    // The SOURCE brush position alone (no centre-offset).  Stored as the
    // regenerator's basePosition so recalc re-anchors the op to source MOVES only
    // (insert/edit), not to the tiny centre-offset drift a re-tessellation
    // produces on a resolution toggle. See resolveChainedPosition.
    basePos: brushPos,
  };
};

// Turn a chamferOrFilletItem result into the item's new position +
// regenerator and commit it.
export const commitChamferResult = (
  item,
  source,
  result,
  subGeo,
  regenBase,
  label,
  editEntryId,
) => {
  const { geometryData, centerOffset } = result;
  // Store the topologically-resolved selection (edges carry their adjacent
  // face normals) so the chamfer re-matches its edges after a sketch /
  // variable resize moves their coordinates.
  const storedSubGeo = result.resolvedSubGeo || subGeo;

  const { position, basePos } = chamferResultTransform(source, centerOffset);

  const patches = {
    type: "csg",
    position,
    regenerator: {
      ...regenBase,
      source,
      subGeo: storedSubGeo,
      // The frame subGeo is in: its source's centring.  A relink can later
      // bind a source centred differently, and the rebuild shifts the
      // selection by the difference (regenerateChamfer).
      sourceCenterOffset: source.regenerator?.centerOffset ?? {
        cx: 0,
        cy: 0,
        cz: 0,
      },
      // bbox-centre offset in the source's LOCAL frame.
      centerOffset,
      // The SOURCE brush position we anchored this op to.  Recalc shifts the
      // item by however much this point moves, so an upstream insert/edit carries
      // the body along instead of leaving it pinned to a stale source (and a
      // resolution toggle, which doesn't move it, is a no-op). resolveChainedPosition.
      basePosition: basePos,
    },
    geometryData,
  };

  // Editing a committed chamfer/fillet updates that step's patches in place; a
  // first-time apply inserts a new "Chamfered"/"Filleted" history entry.
  const store = useStore.getState();
  if (editEntryId) {
    store.updateChamferEntry(editEntryId, patches);
    // The entry keeps its fresh committed geometry (no recompute), so its OLD
    // cached solid is stale — release it; a downstream consumer then rebuilds
    // from the new baked mesh / recipe instead of the outdated B-rep.
    releaseSolid(editEntryId);
  } else store.modifyItem(item.id, patches, label);
  store.clearSelectedSubGeometry();
};
