// Cog tool: the centre-picking click and the live preview.  While the Centre
// button is live, the cog is previewed under the cursor -- snapped onto an
// existing point when one is close -- and a click puts its centre there.  Once
// placed, the preview follows the dialog's values, so it shows exactly what
// Confirm will make.  The state and the commit live in store/sketchCogSlice.js.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  cogShapeFromTool,
  cogToolProblem,
} from "../../store/sketchCogSlice.js";
import { cogShapeContours } from "../cogGeometry.js";
import { makeLine } from "./sketchPatternPreview.js";

export const COG_PREVIEW_COLOR = 0x6c3fd4;

export function createSketchCogHelpers({
  scene,
  objectsRef,
  itemsRef,
  selectedIdRef,
  renderer,
}) {
  let previewObjs = [];
  // Where the centre would go if clicked now (sketch coordinates), while the
  // Centre button is live.
  let hovered = null;

  const activeSketch = () => {
    const item = itemsRef.current.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = item ? objectsRef.current[item.id] : null;
    return item && sketchMesh ? { item, sketchMesh } : null;
  };

  const clearCogPreview = () => {
    previewObjs.forEach((o) => {
      scene.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    });
    previewObjs = [];
  };

  const updateCogPreview = () => {
    clearCogPreview();
    const store = useStore.getState();
    const tool = store.sketchCogState;
    if (store.activeSketchTool !== "cog" || !tool) return;
    const sketch = activeSketch();
    if (!sketch) return;
    const centre = tool.picking ? hovered : tool.centre;
    if (!centre) return;
    const { sketchMesh } = sketch;
    const toW = (x, y) =>
      new THREE.Vector3(x, y, 0.006)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const resolution = renderer.getSize(new THREE.Vector2());
    const add = (pts, opts) => {
      const line = makeLine(pts, {
        color: COG_PREVIEW_COLOR,
        resolution,
        renderOrder: 1009,
        ...opts,
      });
      scene.add(line);
      previewObjs.push(line);
    };

    // The centre as a cross, always -- even while the values are invalid.
    const r = 0.18;
    add([toW(centre.x - r, centre.y), toW(centre.x + r, centre.y)], {
      linewidth: 2,
    });
    add([toW(centre.x, centre.y - r), toW(centre.x, centre.y + r)], {
      linewidth: 2,
    });

    // Values that can't make a gear draw no outline; the dialog says why.
    const placed = { ...tool, centre };
    if (cogToolProblem(placed)) return;
    for (const contour of cogShapeContours(cogShapeFromTool(placed)))
      add(
        [...contour, contour[0]].map((q) => toW(q.x, q.y)),
        { linewidth: 2, dashed: tool.picking, opacity: 0.85 },
      );
  };

  // The point a click would take: an existing point (a corner, an end, a
  // circle's centre...) when the cursor is close to one, else the cursor.
  const pointAt = (screenX, screenY, findSnap, screenToSketchLocal) => {
    const sketch = activeSketch();
    if (!sketch) return null;
    const { item, sketchMesh } = sketch;
    const snap = findSnap(screenX, screenY, item.shapes || [], sketchMesh);
    if (snap) return { x: snap.x, y: snap.y, snapped: true };
    const local = screenToSketchLocal(screenX, screenY, sketchMesh);
    return local ? { x: local.x, y: local.y, snapped: false } : null;
  };

  const cogHoverAt = (screenX, screenY, findSnap, screenToSketchLocal) => {
    const tool = useStore.getState().sketchCogState;
    if (!tool?.picking) {
      hovered = null;
      return;
    }
    hovered = pointAt(screenX, screenY, findSnap, screenToSketchLocal);
    renderer.domElement.style.cursor = hovered?.snapped
      ? "pointer"
      : "crosshair";
    updateCogPreview();
  };

  const handleCogClick = (screenX, screenY, findSnap, screenToSketchLocal) => {
    const tool = useStore.getState().sketchCogState;
    if (!tool?.picking) return;
    const at = pointAt(screenX, screenY, findSnap, screenToSketchLocal);
    if (!at) return;
    hovered = null;
    useStore.getState().pickCogCentre(at);
  };

  const resetCogHover = () => {
    hovered = null;
  };

  return {
    clearCogPreview,
    updateCogPreview,
    cogHoverAt,
    handleCogClick,
    resetCogHover,
  };
}
