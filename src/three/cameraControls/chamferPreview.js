// Live preview of an in-progress chamfer/fillet (create, retarget, and edit):
// debounced calls run the SAME chamferOrFilletItem recipe Confirm/Save will
// use and show the result as a translucent shaded fill plus a wireframe
// outline, updating as the user adds/removes faces or edits distance/angle.
//
// The source object is GHOSTED (dimmed, edge lines hidden) while previewing —
// a chamfer is subtractive, so without ghosting the original solid still fills
// the corner the chamfer cuts away and hides the (smaller) result behind it.
// The object stays `visible` so it's still pickable for face selection; only
// its appearance is dimmed.  The picked-face selection highlight (renderOrder
// 995-997, separate overlay) draws on top of the dimmed object and the fill.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { activePrecision } from "../resolution.js";
import {
  buildChamferSourceAndSubGeo,
  chamferResultTransform,
  chamferPreviewKey,
  stashChamferPreview,
} from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const GHOST_OPACITY = 0.12;

export function createChamferPreviewHelpers({ scene, itemsRef, objectsRef }) {
  let previewGroup = null;
  let ghosted = null; // { mesh, opacity, transparent, depthWrite, uOpacity, edges }
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

  // Dim the source mesh so the chamfered result reads clearly on top of it.
  // Keeps `visible` true (raycasting/picking ignores opacity) so the user can
  // still add/remove faces during a create/retarget preview.
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
    // Hide the object's own edge lines so they don't reinforce the original
    // (pre-chamfer) silhouette and compete with the preview outline.
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

  const clearChamferPreview = () => {
    requestId++; // invalidate any in-flight request
    removePreview();
    unghostSource();
  };

  // Run the chamfer/fillet recipe and overlay its outline as a wireframe.
  // Shared by the create/retarget preview (selection-driven) and the edit
  // preview (replays a committed chamfer's stored source/subGeo with new
  // params).  `myRequest` guards against a newer call superseding this one.
  const runAndShow = async ({
    myRequest,
    source,
    subGeo,
    amount,
    angleRad,
    segments,
    items,
    printPrecision,
    ghostItemId,
  }) => {
    let result;
    let failure = null;
    try {
      const { chamferOrFilletItem } = await import("../occClient.js");
      result = await chamferOrFilletItem({
        source,
        subGeo,
        amount,
        angleRad,
        segments,
        allItems: items,
        printPrecision,
      });
    } catch (err) {
      result = null;
      failure = err?.message || "The chamfer couldn't be built at this size.";
    }
    // A newer request superseded this one (params changed again while we were
    // awaiting OCC) — drop this result.
    if (myRequest !== requestId) return;
    const key = chamferPreviewKey({
      source,
      subGeo,
      amount,
      angleRad,
      segments,
      printPrecision,
    });
    if (failure) {
      // Say so now, in the dialog, and stop showing a preview of some OTHER
      // size as if it were this one.  The failure is stashed like a result so
      // Confirm on these same values reports it at once instead of spending
      // the same long OCC run to fail again.
      removePreview();
      unghostSource();
      stashChamferPreview(key, { error: failure });
      useStore.getState().setChamferPreviewError(failure);
      return;
    }
    // Cancelled (no result, no error): leave the current preview alone.
    if (!result) return;
    useStore.getState().setChamferPreviewError(null);

    // Remember this result so Confirm can commit it directly — it will build
    // the identical recipe, so re-running the OCC op there is pure waste.
    stashChamferPreview(key, result);

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

    // Dim the source now that we have a workable result — done here (not
    // before the OCC call) so a failed/too-large distance leaves the object
    // at full opacity instead of flickering it dim with nothing to show.
    ghostSource(ghostItemId);

    removePreview();
    const group = new THREE.Group();

    // Near-opaque shaded solid of the result.  The source is ghosted behind
    // it (and writes no depth), so the preview can use real depth testing and
    // a lit material — making the new bevel/round faces read as a solid object
    // rather than the faint translucent overlay it was before.  Neutral grey,
    // NOT blue, so blue stays reserved for the picked faces being chamfered.
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

    // Dark edge outline, like a normal object's wireframe, for crisp
    // definition against the light fill.  depthTest:false so the full contour
    // reads even where the ghosted source would otherwise interfere.
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

  // Recompute and swap in the preview outline for the current selection +
  // distance/angle.  Safe to call on every keystroke / selection toggle —
  // stale async results (superseded by a newer call) are discarded.
  const updateChamferPreview = async (distanceMm, angleDeg) => {
    const myRequest = ++requestId;
    const { chamferSelectMode, selectedSubGeometry, chamferEditTarget } =
      useStore.getState();
    if (!chamferSelectMode || !selectedSubGeometry) {
      clearChamferPreview();
      return;
    }
    const hasSelection =
      (selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0;
    if (!hasSelection) {
      clearChamferPreview();
      return;
    }

    const items = itemsRef.current;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    const segments = chamferSelectMode === "chamfer" ? 1 : 3;
    const amount = distanceMm / MM_PER_UNIT;
    const angleRad =
      segments === 1 && Math.abs(angleDeg - 45) > 0.1
        ? (angleDeg * Math.PI) / 180
        : null;
    const printPrecision = activePrecision();

    const { source, subGeo } = buildChamferSourceAndSubGeo({
      item,
      items,
      selectedSubGeometry,
      amount,
      segments,
      printPrecision,
      editing: chamferEditTarget?.itemId === item.id,
    });
    if (subGeo.edges.length === 0 && subGeo.faces.length === 0) {
      clearChamferPreview();
      return;
    }

    await runAndShow({
      myRequest,
      source,
      subGeo,
      amount,
      angleRad,
      segments,
      items,
      printPrecision,
      ghostItemId: item.id,
    });
  };

  return {
    updateChamferPreview,
    clearChamferPreview,
  };
}
