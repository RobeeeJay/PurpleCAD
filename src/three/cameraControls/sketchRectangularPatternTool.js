// Rectangular Pattern tool: click geometry to toggle a live preview of its
// translated repeats on an X/Y grid. Confirm creates the copies (handled by
// store.confirmRectangularPattern); this module only owns the toggle clicks
// and the preview overlay.

import * as THREE from "three";
import { useStore } from "../../store";
import { getSketchShapePoints } from "../sceneObjects.js";
import {
  RECTANGULAR_PATTERNABLE_TYPES,
  translateShapeGeometry,
} from "../sketchRectangularPattern.js";
import { sketchRectangularPatternColorFor } from "../theme.js";

export function createSketchRectangularPatternHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  sketchShapesGroupRef,
}) {
  let previewObjs = [];

  const clearRectangularPatternPreview = () => {
    previewObjs.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    previewObjs = [];
  };

  const updateRectangularPatternPreview = () => {
    clearRectangularPatternPreview();
    const patternState = useStore.getState().sketchRectangularPatternState;
    if (
      useStore.getState().activeSketchTool !== "rectangularPattern" ||
      !patternState
    )
      return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const countX = Math.max(1, Math.round(patternState.countX) || 1);
    const countY = Math.max(1, Math.round(patternState.countY) || 1);
    const { offsetX, offsetY } = patternState;
    const theme = useStore.getState().theme;
    const mat = new THREE.LineDashedMaterial({
      color: sketchRectangularPatternColorFor(theme),
      depthTest: false,
      transparent: true,
      opacity: 0.6,
      dashSize: 0.08,
      gapSize: 0.05,
    });
    patternState.shapeIndices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      for (let i = 0; i < countX; i++) {
        for (let j = 0; j < countY; j++) {
          if (i === 0 && j === 0) continue;
          const translated = translateShapeGeometry(
            shape,
            i * offsetX,
            j * offsetY,
          );
          if (!translated) continue;
          const pts = getSketchShapePoints(translated, sketchMesh);
          if (pts.length < 2) continue;
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            mat,
          );
          line.computeLineDistances();
          line.renderOrder = 1008;
          scene.add(line);
          previewObjs.push(line);
        }
      }
    });
  };

  // Toggle the clicked shape in/out of the pattern. Hits the same line
  // objects used for ordinary selection, skipping offset/mirror/pattern
  // copies.
  const handleRectangularPatternClick = (
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
    const patternState = useStore.getState().sketchRectangularPatternState;
    if (!patternState) return;

    const lineObjs = sketchGroup.children.filter(
      (c) =>
        c.userData.shapeIdx != null &&
        !c.userData.isOffset &&
        !c.userData.isMirror &&
        !c.userData.isCircularPattern &&
        !c.userData.isRectangularPattern,
    );
    const hits = hitTestSketchLines(makeRay(screenX, screenY), lineObjs);
    if (hits.length === 0 || hits[0].object.userData.shapeIdx == null) return;
    const idx = hits[0].object.userData.shapeIdx;
    if (!RECTANGULAR_PATTERNABLE_TYPES.includes(shapes[idx]?.type)) return;
    useStore.getState().toggleRectangularPatternShape(idx);
    updateRectangularPatternPreview();
  };

  return {
    clearRectangularPatternPreview,
    updateRectangularPatternPreview,
    handleRectangularPatternClick,
  };
}
