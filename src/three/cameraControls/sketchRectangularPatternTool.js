// Rectangular Pattern tool: click geometry to toggle a live preview of its
// translated repeats on an X/Y grid. Confirm creates the copies (handled by
// store.confirmRectangularPattern); this module only owns the toggle clicks
// and the preview overlay.

import { useStore } from "../../store";
import { variablesToMap } from "../../utils/formulas.js";
import {
  RECTANGULAR_PATTERNABLE_TYPES,
  translateShapeGeometry,
  resolveRectPatternParams,
} from "../sketchRectangularPattern.js";
import { sketchRectangularPatternColorFor } from "../theme.js";
import { buildPatternPreviewObjects } from "./sketchPatternPreview.js";

export function createSketchRectangularPatternHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  sketchShapesGroupRef,
  renderer,
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
    const { countX, countY, offsetX, offsetY } = resolveRectPatternParams(
      patternState,
      variablesToMap(useStore.getState().variables),
    );
    const theme = useStore.getState().theme;

    const sourceShapes = [];
    const copyShapes = [];
    patternState.shapeIndices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      sourceShapes.push(shape);
      for (let i = 0; i < countX; i++) {
        for (let j = 0; j < countY; j++) {
          if (i === 0 && j === 0) continue;
          const translated = translateShapeGeometry(
            shape,
            i * offsetX,
            j * offsetY,
          );
          if (translated) copyShapes.push(translated);
        }
      }
    });

    buildPatternPreviewObjects({
      sketchMesh,
      sourceShapes,
      copyShapes,
      color: sketchRectangularPatternColorFor(theme),
      renderer,
    }).forEach((o) => {
      scene.add(o);
      previewObjs.push(o);
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
