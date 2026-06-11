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

// Find the "modify" history entry that holds itemId's current chamfer/fillet
// recipe — the one retargetChamferEntry needs to update in place.
export const findChamferEntryId = (history, itemId) =>
  [...history]
    .reverse()
    .find(
      (h) =>
        h.instruction?.type === "modify" &&
        h.instruction.itemId === itemId &&
        h.instruction.patches?.regenerator?.kind === "chamfer",
    )?.id;

// Arm a chamfer/fillet retarget: pre-select the faces/edges the original
// operation used (shifted from the source frame back into this item's
// rendered, bbox-centred frame) and open ChamferOverlay in the matching
// mode. The user can then add/remove picks (live preview via the existing
// selectedSubGeometry highlight) before confirming.
export const beginChamferRetarget = (itemId, entryId) => {
  const store = useStore.getState();
  const item = store.items.find((i) => i.id === itemId);
  const prior = item?.regenerator;
  if (!prior || prior.kind !== "chamfer") return;
  const { cx, cy, cz } = prior.centerOffset || { cx: 0, cy: 0, cz: 0 };
  const rendered = shiftSelectionToSource(prior.subGeo || {}, {
    cx: -cx,
    cy: -cy,
    cz: -cz,
  });
  store.setSelectedSubGeometry({ itemId, ...rendered });
  store.setChamferSelectMode(prior.segments === 1 ? "chamfer" : "fillet");
  store.setChamferRetargetTarget({ itemId, entryId });
};

// Derive the OCC source shape + subGeo selection for a chamfer/fillet —
// shared by the live preview and the Confirm commit so both run the exact
// same recipe. Three cases, in priority order:
//  - retargeting: re-run against the FROZEN pre-chamfer source, replacing
//    (not appending to) its subGeo with the current selection.
//  - appending: a prior chamfer/fillet with the same amount/segments exists
//    — re-run on ITS source with the union of its subGeo and the new picks.
//  - fresh: snapshot the current item (with its live polygon/depth) as the
//    source and use the selection as-is.
export const buildChamferSourceAndSubGeo = ({
  item,
  items,
  selectedSubGeometry,
  amount,
  segments,
  printPrecision,
  retargeting,
}) => {
  const prior = item.regenerator;
  if (retargeting) {
    const source = withLivePolygons(
      withLiveDepth({ ...prior.source }, item.depth ?? prior.source.depth),
      items,
      printPrecision,
    );
    const subGeo = shiftSelectionToSource(
      selectedSubGeometry,
      prior.centerOffset,
    );
    return { source, subGeo };
  }
  if (
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
  entryId,
) => {
  const { geometryData, centerOffset } = result;
  // Store the topologically-resolved selection (edges carry their adjacent
  // face normals) so the chamfer re-matches its edges after a sketch /
  // variable resize moves their coordinates.
  const storedSubGeo = result.resolvedSubGeo || subGeo;

  const { position } = chamferResultTransform(source, centerOffset);

  const patches = {
    type: "csg",
    position,
    regenerator: {
      ...regenBase,
      source,
      subGeo: storedSubGeo,
      // bbox-centre offset in the source's LOCAL frame.
      centerOffset,
    },
    geometryData,
  };

  // Retargeting an existing chamfer/fillet updates that step's patches
  // in place; a first-time apply() inserts a new "Chamfered"/"Filleted"
  // history entry.
  const store = useStore.getState();
  if (entryId) store.retargetChamferEntry(entryId, patches);
  else store.modifyItem(item.id, patches, label);
  store.clearSelectedSubGeometry();
};
