// SVG import placement: a parsed SVG isn't committed straight away — its
// shapes show as a movable/scalable teal preview until the user confirms.
// Drag moves it (the mouse handlers drive svgDragRef), the overlay sets the
// scale, commit appends the transformed shapes to the sketch.  Split out of
// sketchInteraction.js; the mouse handlers read/write svgDragRef and call
// updateSvgPreview, so both are returned.

import { useStore } from "../../store";
import { buildPatternPreviewObjects } from "./sketchPatternPreview.js";
import { svgCoincidentConstraints } from "../importGeometry.js";

const transformSvgShapes = (shapes, scale, ox, oy) => {
  const t = (p) => ({ x: p.x * scale + ox, y: p.y * scale + oy });
  return shapes.map((s) =>
    s.type === "line"
      ? {
          type: "line",
          x1: s.x1 * scale + ox,
          y1: s.y1 * scale + oy,
          x2: s.x2 * scale + ox,
          y2: s.y2 * scale + oy,
        }
      : {
          type: "bezier",
          p0: t(s.p0),
          p1: t(s.p1),
          p2: t(s.p2),
          p3: t(s.p3),
        },
  );
};

export function createSketchSvgPlacement({
  scene,
  renderer,
  objectsRef,
  controls,
}) {
  let svgPreviewObjs = [];
  const svgDragRef = { current: null }; // { startLocal, startOffsetX, startOffsetY }

  const clearSvgPreview = () => {
    svgPreviewObjs.forEach((o) => {
      scene.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    });
    svgPreviewObjs = [];
  };

  const updateSvgPreview = () => {
    clearSvgPreview();
    const svg = useStore.getState().svgImport;
    if (!svg) return;
    const sketchMesh = objectsRef.current[svg.sketchId];
    if (!sketchMesh) return;
    const shapes = transformSvgShapes(
      svg.shapes,
      svg.scale,
      svg.offsetX,
      svg.offsetY,
    );
    buildPatternPreviewObjects({
      sketchMesh,
      sourceShapes: shapes,
      copyShapes: [],
      color: 0x44aaff,
      renderer,
    }).forEach((o) => {
      scene.add(o);
      svgPreviewObjs.push(o);
    });
  };

  controls.updateSvgPreview = updateSvgPreview;
  controls.commitSvgPlacement = () => {
    const store = useStore.getState();
    const svg = store.svgImport;
    if (svg) {
      const placed = transformSvgShapes(
        svg.shapes,
        svg.scale,
        svg.offsetX,
        svg.offsetY,
      );
      const baseIdx = (
        store.items.find((i) => i.id === svg.sketchId)?.shapes || []
      ).length;
      store.addSketchShapes(
        svg.sketchId,
        placed,
        svgCoincidentConstraints(placed, baseIdx),
      );
    }
    clearSvgPreview();
    svgDragRef.current = null;
    store.clearSvgImport();
  };
  controls.cancelSvgPlacement = () => {
    clearSvgPreview();
    svgDragRef.current = null;
    useStore.getState().clearSvgImport();
  };

  return { svgDragRef, updateSvgPreview, clearSvgPreview };
}
