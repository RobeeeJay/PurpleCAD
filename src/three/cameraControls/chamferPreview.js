// Live preview of an in-progress chamfer/fillet: while ChamferOverlay is
// open with a selection, debounced calls run the SAME chamferOrFilletItem
// recipe Confirm will use and overlay the result's outline as a wireframe —
// so the user sees the new chamfer/fillet contour update as they add/remove
// faces or edit distance/angle, without a solid overlay hiding the
// picked-face highlight underneath.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import {
  buildChamferSourceAndSubGeo,
  chamferResultTransform,
} from "./chamferCommit.js";
import { EXTRUDE_FACE_HIGHLIGHT } from "../theme.js";

export function createChamferPreviewHelpers({ scene, itemsRef }) {
  let previewLines = null;
  let requestId = 0;

  const removePreviewLines = () => {
    if (!previewLines) return;
    scene.remove(previewLines);
    previewLines.geometry.dispose();
    previewLines.material.dispose();
    previewLines = null;
  };

  const clearChamferPreview = () => {
    requestId++; // invalidate any in-flight request
    removePreviewLines();
  };

  // Recompute and swap in the preview outline for the current selection +
  // distance/angle.  Safe to call on every keystroke / selection toggle —
  // stale async results (superseded by a newer call) are discarded.
  const updateChamferPreview = async (distanceMm, angleDeg) => {
    const myRequest = ++requestId;
    const {
      chamferSelectMode,
      selectedSubGeometry,
      chamferRetargetTarget,
      curveResolution,
    } = useStore.getState();
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
    const printPrecision = curveResolution === "print" ? 0.01 : null;
    const retargeting = chamferRetargetTarget?.itemId === item.id;

    const { source, subGeo } = buildChamferSourceAndSubGeo({
      item,
      items,
      selectedSubGeometry,
      amount,
      segments,
      printPrecision,
      retargeting,
    });
    if (subGeo.edges.length === 0 && subGeo.faces.length === 0) {
      clearChamferPreview();
      return;
    }

    let result;
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
    } catch {
      result = null;
    }
    // A newer request superseded this one (selection/params changed again
    // while we were awaiting OCC) — drop this result.
    if (myRequest !== requestId) return;
    // Leave whatever preview is currently shown when the geometry is
    // unworkable (eg distance too large) — better than flickering it away.
    if (!result) return;

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

    removePreviewLines();
    previewLines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: EXTRUDE_FACE_HIGHLIGHT,
        depthTest: false,
      }),
    );
    previewLines.position.set(position.x, position.y, position.z);
    previewLines.rotation.set(
      rotation.x || 0,
      rotation.y || 0,
      rotation.z || 0,
    );
    previewLines.renderOrder = 999;
    scene.add(previewLines);
  };

  return { updateChamferPreview, clearChamferPreview };
}
