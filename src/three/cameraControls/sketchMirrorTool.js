// Mirror tool: pick a mirror line, then click geometry to toggle a live
// reflected preview across it. Confirm creates the mirrored copies (handled
// by store.confirmMirror); this module only owns the picking clicks and the
// preview overlay.

import { useStore } from "../../store";
import { MIRRORABLE_TYPES, mirrorShapeGeometry } from "../sketchMirror.js";
import { sketchMirrorColorFor } from "../theme.js";
import { buildPatternPreviewObjects } from "./sketchPatternPreview.js";

export function createSketchMirrorHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  sketchShapesGroupRef,
  renderer,
}) {
  let previewObjs = [];

  const clearMirrorPreview = () => {
    previewObjs.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    previewObjs = [];
  };

  const updateMirrorPreview = () => {
    clearMirrorPreview();
    const mirrorState = useStore.getState().sketchMirrorState;
    if (useStore.getState().activeSketchTool !== "mirror" || !mirrorState)
      return;
    if (mirrorState.lineIdx == null) return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const lineShape = shapes[mirrorState.lineIdx];
    if (!lineShape) return;
    const theme = useStore.getState().theme;

    const sourceShapes = [];
    const copyShapes = [];
    mirrorState.shapeIndices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      sourceShapes.push(shape);
      const mirrored = mirrorShapeGeometry(shape, lineShape);
      if (mirrored) copyShapes.push(mirrored);
    });

    buildPatternPreviewObjects({
      sketchMesh,
      sourceShapes,
      copyShapes,
      color: sketchMirrorColorFor(theme),
      theme,
      renderer,
    }).forEach((o) => {
      scene.add(o);
      previewObjs.push(o);
    });
  };

  // Pick the mirror line, then toggle shapes to mirror. Hits the same line
  // objects used for ordinary selection, skipping offset/mirror copies (they
  // can't be picked as the mirror line or mirrored themselves).
  const handleMirrorClick = (screenX, screenY, hitTestSketchLines, makeRay) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchGroup = sketchShapesGroupRef?.current;
    if (!selItem || !sketchGroup) return;
    const lineObjs = sketchGroup.children.filter(
      (c) =>
        c.userData.shapeIdx != null &&
        !c.userData.isOffset &&
        !c.userData.isMirror,
    );
    const hits = hitTestSketchLines(makeRay(screenX, screenY), lineObjs);
    if (hits.length === 0 || hits[0].object.userData.shapeIdx == null) return;
    const idx = hits[0].object.userData.shapeIdx;
    const shapes = selItem.shapes || [];
    const mirrorState = useStore.getState().sketchMirrorState;
    if (!mirrorState) return;
    if (mirrorState.lineIdx == null) {
      if (shapes[idx]?.type !== "line") return;
      useStore.getState().setMirrorLine(idx);
    } else {
      if (idx === mirrorState.lineIdx) return;
      if (!MIRRORABLE_TYPES.includes(shapes[idx]?.type)) return;
      useStore.getState().toggleMirrorShape(idx);
    }
    updateMirrorPreview();
  };

  return { clearMirrorPreview, updateMirrorPreview, handleMirrorClick };
}
