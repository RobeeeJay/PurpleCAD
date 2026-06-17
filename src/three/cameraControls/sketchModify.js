// Chamfer / bevel modify mode: takes a sketch-corner click and either
// trims the two adjacent lines to insert a straight cut (chamfer) or
// fits a tangent arc between them (bevel).  showModifyPreview renders
// a live yellow ghost of the result; applyModify commits via
// store.applySketchModify.  The edit is purely local (only the two clicked
// legs move) so it never drags unrelated, unconstrained geometry.

import * as THREE from "three";
import { useStore } from "../../store";
import { getSketchShapePoints, MM_PER_UNIT } from "../sceneObjects.js";
import { buildChamferEdit } from "../sketchGeometry.js";
import { SKETCH_MODIFY_HIGHLIGHT } from "../theme.js";

// Setback (chamfer) / radius (bevel), in scene units, read live from the store
// so the toolbar input drives the same value the preview and commit use.
const modifyDist = () =>
  (useStore.getState().sketchModifyDistMm ?? 2.5) / MM_PER_UNIT;

export function createSketchModifyHelpers(
  { scene, renderer, objectsRef, itemsRef, selectedIdRef },
  { findSnap },
) {
  let modifyPreviewObjs = [];
  const clearModifyPreview = () => {
    modifyPreviewObjs.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    modifyPreviewObjs = [];
  };

  const findJunction = (snap, shapes, constraints) => {
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let aIdx, aKey, bIdx, bKey;
      if (c.shapeAIdx === snap.shapeIdx && c.pointA === snap.pointKey) {
        aIdx = c.shapeAIdx;
        aKey = c.pointA;
        bIdx = c.shapeBIdx;
        bKey = c.pointB;
      } else if (c.shapeBIdx === snap.shapeIdx && c.pointB === snap.pointKey) {
        aIdx = c.shapeBIdx;
        aKey = c.pointB;
        bIdx = c.shapeAIdx;
        bKey = c.pointA;
      } else continue;
      if (shapes[aIdx]?.type === "line" && shapes[bIdx]?.type === "line")
        return { aIdx, aKey, bIdx, bKey, constraint: c };
    }
    return null;
  };

  // Locate the junction under the cursor and build its chamfer/bevel edit.
  const editAt = (screenX, screenY, mode) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return null;
    const shapes = selItem.shapes || [];
    const constraints = selItem.constraints || [];
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (!snap) return null;
    const junc = findJunction(snap, shapes, constraints);
    if (!junc) return null;
    const edit = buildChamferEdit(shapes, junc, mode, modifyDist());
    if (!edit) return null;
    return { selItem, sketchMesh, shapes, junc, edit };
  };

  const applyModify = (screenX, screenY, mode) => {
    const found = editAt(screenX, screenY, mode);
    if (!found) return;
    const { junc, edit } = found;
    const updates = new Map(edit.updates);
    const juncConstraint = junc.constraint;
    // Replace the old corner coincident with the bridge element + its joins; the
    // two trimmed legs are the only existing shapes that change.
    useStore
      .getState()
      .applySketchModify(
        selectedIdRef.current,
        updates,
        edit.newShape,
        (c) => c === juncConstraint,
        edit.newConstraints,
      );
    clearModifyPreview();
  };

  const showModifyPreview = (screenX, screenY, mode) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) {
      clearModifyPreview();
      return;
    }
    const found = editAt(screenX, screenY, mode);
    if (!found) {
      clearModifyPreview();
      // crosshair while hovering the sketch but not over a chamferable junction.
      const snap = findSnap(screenX, screenY, selItem.shapes || [], sketchMesh);
      renderer.domElement.style.cursor = snap ? "crosshair" : "";
      return;
    }
    clearModifyPreview();
    renderer.domElement.style.cursor = "pointer";
    const { edit } = found;
    const previewMat = new THREE.LineBasicMaterial({
      color: SKETCH_MODIFY_HIGHLIGHT,
      depthTest: false,
    });
    const addPreview = (shape) => {
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        previewMat,
      );
      l.renderOrder = 1008;
      scene.add(l);
      modifyPreviewObjs.push(l);
    };
    // The two trimmed legs and the new bridge element, exactly as committed.
    for (const [, s] of edit.updates) addPreview(s);
    addPreview(edit.newShape);
  };

  return { clearModifyPreview, applyModify, showModifyPreview };
}
