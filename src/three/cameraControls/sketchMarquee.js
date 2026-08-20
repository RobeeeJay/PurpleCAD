// Marquee box selection: the drag-a-rectangle overlay.  Two flavours —
// updateMarquee (the normal selection box: draws the rect AND selects every
// shape with an endpoint inside it, unioned with the pre-drag selection for a
// shift-marquee) and drawProjectMarquee (the Project tool's teal box, which
// only draws, no selection).  Split out of sketchInteraction.js; the mouse
// handlers set marqueeBaseRef (the pre-drag selection to union with) and call
// clearMarqueeRect on gesture end.

import * as THREE from "three";
import { useStore } from "../../store";
import { sketchLineColorFor } from "../theme.js";
import { getSnapPoints } from "../sceneObjects.js";
import {
  isOffsetShapeIdx,
  isMirrorShapeIdx,
  isCircularPatternShapeIdx,
  isRectangularPatternShapeIdx,
  isCornerBridgeIdx,
} from "./sketchDragLifecycle.js";

export function createSketchMarquee(
  {
    scene,
    itemsRef,
    selectedIdRef,
    objectsRef,
    marqueeStartRef,
    multiSelectedRef,
  },
  { screenToSketchLocal, showMultiSelectOverlays },
) {
  let marqueeRectObj = null;
  // The selection to union a shift-marquee with; the mouse handler seeds it on
  // button-down ([...current] for shift, [] otherwise).
  const marqueeBaseRef = { current: [] };

  const clearMarqueeRect = () => {
    if (marqueeRectObj) {
      scene.remove(marqueeRectObj);
      marqueeRectObj.geometry.dispose();
      marqueeRectObj.material.dispose();
      marqueeRectObj = null;
    }
  };

  // The Project tool's marquee box — drawn in projection teal, no shape select.
  const drawProjectMarquee = (screenX, screenY) => {
    clearMarqueeRect();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh || !marqueeStartRef.current) return;
    const p1 = screenToSketchLocal(
      marqueeStartRef.current.x,
      marqueeStartRef.current.y,
      sketchMesh,
    );
    const p2 = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!p1 || !p2) return;
    const toW = (lx, ly) =>
      new THREE.Vector3(lx, ly, 0.008)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const corners = [
      toW(p1.x, p1.y),
      toW(p2.x, p1.y),
      toW(p2.x, p2.y),
      toW(p1.x, p2.y),
      toW(p1.x, p1.y),
    ];
    marqueeRectObj = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(corners),
      new THREE.LineBasicMaterial({
        color: 0x37b8a0,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    marqueeRectObj.renderOrder = 1010;
    scene.add(marqueeRectObj);
  };

  const updateMarquee = (screenX, screenY) => {
    clearMarqueeRect();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh || !marqueeStartRef.current) return;
    const p1 = screenToSketchLocal(
      marqueeStartRef.current.x,
      marqueeStartRef.current.y,
      sketchMesh,
    );
    const p2 = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!p1 || !p2) return;
    const toW = (lx, ly) => {
      const v = new THREE.Vector3(lx, ly, 0.008);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const corners = [
      toW(p1.x, p1.y),
      toW(p2.x, p1.y),
      toW(p2.x, p2.y),
      toW(p1.x, p2.y),
      toW(p1.x, p1.y),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(corners);
    const mat = new THREE.LineBasicMaterial({
      color: sketchLineColorFor(useStore.getState().theme),
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    marqueeRectObj = new THREE.Line(geo, mat);
    marqueeRectObj.renderOrder = 1010;
    scene.add(marqueeRectObj);
    // Find shapes with any endpoint inside the marquee bounds
    const minX = Math.min(p1.x, p2.x),
      maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y),
      maxY = Math.max(p1.y, p2.y);
    const shapes = selItem.shapes || [];
    const inRect = new Set();
    getSnapPoints(shapes).forEach((pt) => {
      if (
        pt.x >= minX &&
        pt.x <= maxX &&
        pt.y >= minY &&
        pt.y <= maxY &&
        !isOffsetShapeIdx(selItem, pt.shapeIdx) &&
        !isMirrorShapeIdx(selItem, pt.shapeIdx) &&
        !isCircularPatternShapeIdx(selItem, pt.shapeIdx) &&
        !isRectangularPatternShapeIdx(selItem, pt.shapeIdx) &&
        !isCornerBridgeIdx(selItem, pt.shapeIdx)
      )
        inRect.add(pt.shapeIdx);
    });
    // Shift-marquee adds to the pre-drag selection; otherwise it replaces.
    const union = new Set(marqueeBaseRef.current);
    inRect.forEach((i) => union.add(i));
    multiSelectedRef.current = [...union];
    showMultiSelectOverlays(multiSelectedRef.current);
  };

  return {
    clearMarqueeRect,
    drawProjectMarquee,
    updateMarquee,
    marqueeBaseRef,
  };
}
