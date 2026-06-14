// Circular Pattern tool: pick a centre point, then click geometry to toggle a
// live preview of its rotated repeats around it. Confirm creates the rotated
// copies (handled by store.confirmCircularPattern); this module only owns the
// picking clicks and the preview overlay.

import * as THREE from "three";
import { useStore } from "../../store";
import { getSnapPoints, getShapePoint } from "../sceneObjects/sketchShapes.js";
import {
  CIRCULAR_PATTERNABLE_TYPES,
  rotateShapeGeometry,
} from "../sketchCircularPattern.js";
import { sketchCircularPatternColorFor } from "../theme.js";
import { buildPatternPreviewObjects } from "./sketchPatternPreview.js";

const PICK_PX = 20;

export function createSketchCircularPatternHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  sketchShapesGroupRef,
  cameraRef,
  renderer,
}) {
  let previewObjs = [];

  const clearCircularPatternPreview = () => {
    previewObjs.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    previewObjs = [];
  };

  const updateCircularPatternPreview = () => {
    clearCircularPatternPreview();
    const patternState = useStore.getState().sketchCircularPatternState;
    if (
      useStore.getState().activeSketchTool !== "circularPattern" ||
      !patternState
    )
      return;
    if (patternState.centerShapeIdx == null) return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const centerShape = shapes[patternState.centerShapeIdx];
    if (!centerShape) return;
    const center = getShapePoint(centerShape, patternState.centerPointKey);
    if (!center) return;
    const count = Math.max(2, Math.round(patternState.count) || 2);
    const theme = useStore.getState().theme;

    const sourceShapes = [];
    const copyShapes = [];
    patternState.shapeIndices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      sourceShapes.push(shape);
      for (let index = 1; index < count; index++) {
        const angle = (index * 2 * Math.PI) / count;
        const rotated = rotateShapeGeometry(shape, center, angle);
        if (rotated) copyShapes.push(rotated);
      }
    });

    buildPatternPreviewObjects({
      sketchMesh,
      sourceShapes,
      copyShapes,
      color: sketchCircularPatternColorFor(theme),
      theme,
      renderer,
    }).forEach((o) => {
      scene.add(o);
      previewObjs.push(o);
    });
  };

  // Pick the centre point (nearest snap point under the cursor), then toggle
  // shapes to pattern. Hits the same line objects used for ordinary
  // selection, skipping offset/mirror/circular-pattern copies.
  const handleCircularPatternClick = (
    screenX,
    screenY,
    hitTestSketchLines,
    makeRay,
  ) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchGroup = sketchShapesGroupRef?.current;
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchGroup || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const patternState = useStore.getState().sketchCircularPatternState;
    if (!patternState) return;

    if (patternState.centerShapeIdx == null) {
      // Pick the nearest snap point under the cursor as the centre.
      const rect = renderer.domElement.getBoundingClientRect();
      let best = null;
      let bestDist = Infinity;
      getSnapPoints(shapes).forEach((pt) => {
        const world = new THREE.Vector3(pt.x, pt.y, 0.003)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const ndc = world.clone().project(cameraRef.current);
        const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
        const dist = Math.hypot(screenX - sx, screenY - sy);
        if (dist < PICK_PX && dist < bestDist) {
          best = pt;
          bestDist = dist;
        }
      });
      if (!best) return;
      useStore
        .getState()
        .setCircularPatternCenter(best.shapeIdx, best.pointKey);
    } else {
      const lineObjs = sketchGroup.children.filter(
        (c) =>
          c.userData.shapeIdx != null &&
          !c.userData.isOffset &&
          !c.userData.isMirror &&
          !c.userData.isCircularPattern,
      );
      const hits = hitTestSketchLines(makeRay(screenX, screenY), lineObjs);
      if (hits.length === 0 || hits[0].object.userData.shapeIdx == null) return;
      const idx = hits[0].object.userData.shapeIdx;
      if (!CIRCULAR_PATTERNABLE_TYPES.includes(shapes[idx]?.type)) return;
      useStore.getState().toggleCircularPatternShape(idx);
    }
    updateCircularPatternPreview();
  };

  return {
    clearCircularPatternPreview,
    updateCircularPatternPreview,
    handleCircularPatternClick,
  };
}
