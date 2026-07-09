// Push/pull a solid's faces along their normals: a live translucent preview
// of the in-progress move plus the Confirm-time commit.  Mirrors the
// chamfer pipeline (chamferPreview.js + chamferCommit.js) but for the
// pushPullFaces op — the source object is GHOSTED while previewing so the
// (smaller-on-push / larger-on-pull) result reads clearly on top of it.

import * as THREE from "three";
import { useStore } from "../../store";
import { releaseSolid } from "../solidCache.js";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { activePrecision } from "../resolution.js";
import { withLivePolygons, withLiveDepth } from "../csgUtils.js";
import {
  chamferResultTransform,
  shiftSelectionToSource,
} from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

// Arm a push/pull retarget: pre-select the faces the original op used (shifted
// from the source frame back into this item's rendered, bbox-centred frame)
// and open PushPullOverlay.  The user can then add/remove faces (live preview)
// before confirming, which updates the entry in place.  Mirrors
// beginChamferRetarget.
export const beginPushPullRetarget = (itemId, entryId) => {
  const store = useStore.getState();
  const item = store.items.find((i) => i.id === itemId);
  const prior = item?.regenerator;
  if (!prior || prior.kind !== "pushpull") return;
  const { cx, cy, cz } = prior.centerOffset || { cx: 0, cy: 0, cz: 0 };
  const rendered = shiftSelectionToSource(prior.subGeo || {}, {
    cx: -cx,
    cy: -cy,
    cz: -cz,
  });
  store.setSelectedSubGeometry({
    itemId,
    edges: [],
    faces: rendered.faces,
  });
  store.setPushPullSelectMode("pushpull");
  store.setPushPullRetargetTarget({ itemId, entryId });
};

// Snapshot the item as the push/pull source with its live polygon/depth baked
// in (so a sketch / variable edit before confirming is reflected), plus the
// face-only subGeo selection.  Shared by the preview and the commit so both
// run the exact same recipe.
function buildPushPullSourceAndSubGeo(
  item,
  items,
  selectedSubGeometry,
  printPrecision,
) {
  const source = withLivePolygons(
    withLiveDepth({ ...item }, item.depth),
    items,
    printPrecision,
  );
  const subGeo = { faces: selectedSubGeometry.faces || [] };
  return { source, subGeo };
}

// Run the pushPullFaces recipe and commit the result as a "Pushed"/"Pulled"
// history entry.  Returns true on success, false if OCC produced nothing.
export async function commitPushPull({
  item,
  items,
  selectedSubGeometry,
  distanceMm,
  printPrecision,
}) {
  const { pushPullFaces } = await import("../occClient.js");
  const store = useStore.getState();
  const distance = distanceMm / MM_PER_UNIT;

  // Retargeting replaces the FROZEN source's selection with the current picks
  // (shifted back into the source frame), updating the existing entry in place;
  // a fresh push/pull snapshots the live item as the source and appends a step.
  const retarget = store.pushPullRetargetTarget;
  const retargetEntryId =
    retarget?.itemId === item.id ? retarget.entryId : null;
  const prior = item.regenerator;

  let source, subGeo;
  if (retargetEntryId && prior?.kind === "pushpull") {
    source = withLivePolygons(
      withLiveDepth({ ...prior.source }, item.depth ?? prior.source.depth),
      items,
      printPrecision,
    );
    subGeo = {
      faces: shiftSelectionToSource(selectedSubGeometry, prior.centerOffset)
        .faces,
    };
  } else {
    ({ source, subGeo } = buildPushPullSourceAndSubGeo(
      item,
      items,
      selectedSubGeometry,
      printPrecision,
    ));
  }
  if (subGeo.faces.length === 0) return false;

  const result = await pushPullFaces({
    source,
    subGeo,
    distance,
    allItems: items,
    printPrecision,
  });
  if (!result) return false;

  const { geometryData, centerOffset } = result;
  const { position, basePos } = chamferResultTransform(source, centerOffset);
  store._cameraControls?.clearPushPullPreview?.();
  const patches = {
    type: "csg",
    position,
    regenerator: {
      kind: "pushpull",
      distance,
      source,
      subGeo: result.resolvedSubGeo || subGeo,
      centerOffset,
      basePosition: basePos,
      regeneratedAt: printPrecision,
    },
    geometryData,
  };
  if (retargetEntryId) {
    store.retargetPushPullEntry(retargetEntryId, patches);
    // Fresh committed geometry stays (no recompute) — drop the stale cached solid.
    releaseSolid(retargetEntryId);
  } else
    store.modifyItem(item.id, patches, distance >= 0 ? "Pulled" : "Pushed");
  store.clearSelectedSubGeometry();
  if (retargetEntryId) store.setPushPullRetargetTarget(null);
  return true;
}

export function createPushPullPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewGroup = null;
  let ghosted = null;
  let requestId = 0;

  const removePreview = () => {
    if (!previewGroup) return;
    scene.remove(previewGroup);
    previewGroup.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    previewGroup = null;
  };

  // Dim the source mesh (keeping it pickable) so the result reads on top of it.
  const ghostSource = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh || (ghosted && ghosted.mesh === mesh)) return;
    unghostSource();
    const mat = mesh.material;
    ghosted = {
      mesh,
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
      uOpacity: mat.uniforms?.uOpacity ? mat.uniforms.uOpacity.value : null,
      edges: mesh.children.map((c) => ({ child: c, visible: c.visible })),
    };
    mat.transparent = true;
    mat.depthWrite = false;
    if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = GHOST_OPACITY;
    else mat.opacity = GHOST_OPACITY;
    mat.needsUpdate = true;
    mesh.children.forEach((c) => {
      c.visible = false;
    });
  };

  const unghostSource = () => {
    if (!ghosted) return;
    const { mesh, opacity, transparent, depthWrite, uOpacity, edges } = ghosted;
    const mat = mesh.material;
    if (mat) {
      mat.transparent = transparent;
      mat.depthWrite = depthWrite;
      if (uOpacity != null && mat.uniforms?.uOpacity)
        mat.uniforms.uOpacity.value = uOpacity;
      else mat.opacity = opacity;
      mat.needsUpdate = true;
    }
    edges.forEach(({ child, visible }) => {
      child.visible = visible;
    });
    ghosted = null;
  };

  const clearPushPullPreview = () => {
    requestId++; // invalidate any in-flight request
    removePreview();
    unghostSource();
  };

  // Run the push/pull recipe and overlay its result as a ghosted fill +
  // wireframe.  Shared by the create/retarget preview (selection-driven) and
  // the edit preview (replays a committed op's stored source/subGeo with a new
  // distance).  `myRequest` guards against a newer call superseding this one.
  const runAndShow = async ({
    myRequest,
    source,
    subGeo,
    distance,
    items,
    printPrecision,
    ghostItemId,
  }) => {
    let result;
    try {
      const { pushPullFaces } = await import("../occClient.js");
      result = await pushPullFaces({
        source,
        subGeo,
        distance,
        allItems: items,
        printPrecision,
      });
    } catch {
      result = null;
    }
    // A newer request superseded this one, or the geometry was unworkable —
    // leave whatever preview is currently shown rather than flickering it away.
    if (myRequest !== requestId || !result) return;

    const { positions, normals, indices } = result.geometryData;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    if (normals)
      geometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(normals), 3),
      );
    if (indices)
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (!normals) geometry.computeVertexNormals();

    const { position, rotation } = chamferResultTransform(
      source,
      result.centerOffset,
    );

    ghostSource(ghostItemId);
    removePreview();
    const group = new THREE.Group();

    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_COLOR,
        roughness: 0.55,
        metalness: 0.0,
        transparent: true,
        opacity: 0.92,
      }),
    );
    fill.renderOrder = 990;
    group.add(fill);

    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: WIREFRAME_EDGE_COLOR,
        depthTest: false,
      }),
    );
    lines.renderOrder = 999;
    group.add(lines);

    group.position.set(position.x, position.y, position.z);
    group.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    scene.add(group);
    previewGroup = group;
  };

  // Recompute and swap in the preview for the current selection + distance.
  // Safe to call on every keystroke / selection toggle — stale async results
  // (superseded by a newer call) are discarded.
  const updatePushPullPreview = async (distanceMm) => {
    const myRequest = ++requestId;
    const { pushPullSelectMode, selectedSubGeometry } = useStore.getState();
    if (!pushPullSelectMode || !selectedSubGeometry) {
      clearPushPullPreview();
      return;
    }
    const hasSelection = (selectedSubGeometry.faces?.length ?? 0) > 0;
    if (!hasSelection) {
      clearPushPullPreview();
      return;
    }

    const items = itemsRef.current;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    const printPrecision = activePrecision();
    const { source, subGeo } = buildPushPullSourceAndSubGeo(
      item,
      items,
      selectedSubGeometry,
      printPrecision,
    );
    if (subGeo.faces.length === 0) {
      clearPushPullPreview();
      return;
    }

    await runAndShow({
      myRequest,
      source,
      subGeo,
      distance: distanceMm / MM_PER_UNIT,
      items,
      printPrecision,
      ghostItemId: item.id,
    });
  };

  // Live preview for PushPullEditDialog: replays a committed push/pull's stored
  // recipe (source + subGeo) with the new distance the user is typing, ghosting
  // the existing result mesh so the change is visible before Save.
  const updatePushPullEditPreview = async (regenerator, distanceMm, itemId) => {
    const myRequest = ++requestId;
    if (regenerator?.kind !== "pushpull" || !regenerator.source) {
      clearPushPullPreview();
      return;
    }
    const printPrecision = activePrecision();
    await runAndShow({
      myRequest,
      source: regenerator.source,
      subGeo: regenerator.subGeo || { faces: [] },
      distance: distanceMm / MM_PER_UNIT,
      items: itemsRef.current,
      printPrecision,
      ghostItemId: itemId,
    });
  };

  return {
    updatePushPullPreview,
    updatePushPullEditPreview,
    clearPushPullPreview,
  };
}
