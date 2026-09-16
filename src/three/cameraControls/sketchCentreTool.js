// Centre tool: the picking clicks and the live preview.  A "shape" here is the
// connected geometry under the cursor -- the same set a double-click selects --
// so a rectangle drawn as four joined lines is picked as one.  Hovering while a
// pick button is live previews exactly the set a click would take; once both
// shapes are picked, a dashed ghost shows where Confirm will put Shape A.  The
// state and the commit live in store/sketchCentreSlice.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { centreMove, moveShape } from "../../store/sketchCentreSlice.js";
import { collectConnectedShapes } from "../sketchGeometry.js";
import { getSketchShapePoints } from "../sceneObjects.js";
import { makeLine } from "./sketchPatternPreview.js";

export const CENTRE_A_COLOR = 0xff8844;
export const CENTRE_B_COLOR = 0x00c8a0;

export function createSketchCentreHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  sketchShapesGroupRef,
  renderer,
}) {
  let previewObjs = [];
  // The set under the cursor while a pick button is live; kept here so a
  // store-driven redraw (a pick, an offset edit) doesn't drop the hover.
  let hovered = null;

  const activeSketch = () => {
    const item = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = item ? objectsRef.current[item.id] : null;
    return item && sketchMesh ? { item, sketchMesh } : null;
  };

  const clearCentrePreview = () => {
    previewObjs.forEach((o) => {
      scene.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    });
    previewObjs = [];
  };

  const add = (o) => {
    scene.add(o);
    previewObjs.push(o);
  };

  const drawSet = (sketchMesh, shapes, color, { dashed, width }) => {
    const resolution = renderer.getSize(new THREE.Vector2());
    for (const shape of shapes) {
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) continue;
      add(
        makeLine(pts, {
          color,
          linewidth: width,
          dashed,
          resolution,
          opacity: dashed ? 0.85 : 1,
          renderOrder: 1009,
        }),
      );
    }
  };

  const drawCross = (sketchMesh, at, color) => {
    const r = 0.18;
    const toW = (x, y) =>
      new THREE.Vector3(x, y, 0.006)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const resolution = renderer.getSize(new THREE.Vector2());
    for (const [a, b] of [
      [toW(at.x - r, at.y), toW(at.x + r, at.y)],
      [toW(at.x, at.y - r), toW(at.x, at.y + r)],
    ])
      add(
        makeLine([a, b], {
          color,
          linewidth: 2,
          resolution,
          renderOrder: 1010,
        }),
      );
  };

  const updateCentrePreview = () => {
    clearCentrePreview();
    const store = useStore.getState();
    const tool = store.sketchCentreState;
    if (store.activeSketchTool !== "centre" || !tool) return;
    const sketch = activeSketch();
    if (!sketch) return;
    const { item, sketchMesh } = sketch;
    const shapes = item.shapes || [];
    const pick = (idxs) => idxs.map((i) => shapes[i]).filter(Boolean);

    drawSet(sketchMesh, pick(tool.shapesA), CENTRE_A_COLOR, { width: 3 });
    drawSet(sketchMesh, pick(tool.shapesB), CENTRE_B_COLOR, { width: 3 });
    if (tool.picking && hovered)
      drawSet(
        sketchMesh,
        pick(hovered),
        tool.picking === "A" ? CENTRE_A_COLOR : CENTRE_B_COLOR,
        { width: 2.5, dashed: true },
      );

    if (tool.shapesA.length && tool.shapesB.length) {
      const move = centreMove(
        shapes,
        tool.shapesA,
        tool.shapesB,
        tool.offsetX,
        tool.offsetY,
      );
      if (move) {
        const ghost = pick(tool.shapesA).map((s) =>
          moveShape(s, move.dx, move.dy),
        );
        drawSet(sketchMesh, ghost, CENTRE_A_COLOR, {
          width: 2,
          dashed: true,
        });
        drawCross(sketchMesh, move.target, CENTRE_B_COLOR);
      }
    }
  };

  // The connected set under the cursor: a line / arc / curve / circle body, or
  // a standalone point (points aren't line objects, so they need a snap).
  const shapeSetAt = (
    screenX,
    screenY,
    hitTestSketchLines,
    makeRay,
    findSnap,
  ) => {
    const sketch = activeSketch();
    const group = sketchShapesGroupRef?.current;
    if (!sketch || !group) return null;
    const { item, sketchMesh } = sketch;
    const shapes = item.shapes || [];
    const lineObjs = group.children.filter(
      (c) =>
        c.userData.shapeIdx != null &&
        !c.userData.isOffset &&
        !c.userData.isMirror &&
        !c.userData.isCircularPattern &&
        !c.userData.isRectangularPattern,
    );
    const hits = hitTestSketchLines(makeRay(screenX, screenY), lineObjs);
    let idx = hits[0]?.object?.userData?.shapeIdx ?? null;
    if (idx == null) {
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (snap && shapes[snap.shapeIdx]?.type === "point") idx = snap.shapeIdx;
    }
    if (idx == null) return null;
    return collectConnectedShapes(idx, shapes, item.constraints || []).sort(
      (a, b) => a - b,
    );
  };

  const sameSet = (a, b) =>
    a === b ||
    (a && b && a.length === b.length && a.every((v, i) => v === b[i]));

  const centreHoverAt = (
    screenX,
    screenY,
    hitTestSketchLines,
    makeRay,
    findSnap,
  ) => {
    const tool = useStore.getState().sketchCentreState;
    const next = tool?.picking
      ? shapeSetAt(screenX, screenY, hitTestSketchLines, makeRay, findSnap)
      : null;
    renderer.domElement.style.cursor = next ? "pointer" : "";
    if (sameSet(next, hovered)) return;
    hovered = next;
    updateCentrePreview();
  };

  const handleCentreClick = (
    screenX,
    screenY,
    hitTestSketchLines,
    makeRay,
    findSnap,
  ) => {
    const tool = useStore.getState().sketchCentreState;
    if (!tool?.picking) return;
    const set = shapeSetAt(
      screenX,
      screenY,
      hitTestSketchLines,
      makeRay,
      findSnap,
    );
    if (!set) return;
    hovered = null;
    useStore.getState().pickCentreShape(set);
  };

  // Hover belongs to the pick in progress; forget it when the tool closes.
  const resetCentreHover = () => {
    hovered = null;
  };

  return {
    clearCentrePreview,
    updateCentrePreview,
    centreHoverAt,
    handleCentreClick,
    resetCentreHover,
  };
}
