// Trim tool: while the button is held, trim any plain line under the cursor;
// the whole drag is ONE undo step (the snapshot is taken on the first trim,
// tracked by trimSnapshotRef — reset by the mouse handlers at gesture
// start/end).  Split out of sketchInteraction.js.

import { useStore } from "../../store";

export function createSketchTrimTool(
  { renderer, itemsRef, selectedIdRef, objectsRef, sketchShapesGroupRef },
  {
    hitTestSketchLines,
    makeRay,
    screenToSketchLocal,
    clearHoverLineHighlight,
    applyHoverLineHighlight,
  },
) {
  // False until the first trim of a drag takes the undo snapshot; the mouse
  // handlers reset it to false on button-down and button-up.
  const trimSnapshotRef = { current: false };

  // The trim tool's pickable lines: original (non-copy, non-offset) shapes only.
  const trimLineObjs = () => {
    const group = sketchShapesGroupRef?.current;
    if (!group) return [];
    return group.children.filter(
      (c) =>
        c.userData.shapeIdx != null &&
        !c.userData.isOffset &&
        !c.userData.isMirror &&
        !c.userData.isCircularPattern &&
        !c.userData.isRectangularPattern &&
        !c.userData.isCornerBridge,
    );
  };

  const trimHitIdx = (clientX, clientY, selItem) => {
    const hits = hitTestSketchLines(makeRay(clientX, clientY), trimLineObjs());
    const idx = hits[0]?.object?.userData?.shapeIdx;
    if (idx == null) return null;
    return (selItem.shapes || [])[idx]?.type === "line" ? idx : null;
  };

  // Trim whatever plain line is under the cursor.  Called on click and on every
  // move while dragging, so a drag "eats" lines continuously.
  const tryTrimAt = (clientX, clientY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const lineIdx = trimHitIdx(clientX, clientY, selItem);
    if (lineIdx == null) return;
    const local = screenToSketchLocal(clientX, clientY, sketchMesh);
    if (!local) return;
    useStore
      .getState()
      .trimSketchLine(
        selItem.id,
        lineIdx,
        local.x,
        local.y,
        !trimSnapshotRef.current,
      );
    trimSnapshotRef.current = true;
  };

  // Hover feedback for the trim tool: light the line a click would trim.
  const trimHoverAt = (clientX, clientY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    if (!selItem || !sketchShapesGroupRef?.current) {
      clearHoverLineHighlight();
      renderer.domElement.style.cursor = "";
      return;
    }
    const hits = hitTestSketchLines(makeRay(clientX, clientY), trimLineObjs());
    const obj = hits[0]?.object;
    const idx = obj?.userData?.shapeIdx;
    if (idx != null && (selItem.shapes || [])[idx]?.type === "line") {
      applyHoverLineHighlight(obj);
      renderer.domElement.style.cursor = "crosshair";
    } else {
      clearHoverLineHighlight();
      renderer.domElement.style.cursor = "";
    }
  };

  return { tryTrimAt, trimHoverAt, trimSnapshotRef };
}
