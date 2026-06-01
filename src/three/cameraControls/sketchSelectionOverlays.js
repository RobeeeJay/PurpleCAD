// Sketch selection overlay meshes: the green ring/line that marks the selected
// point or line, the orange coincident-first-point ring, the blue multi-select
// highlights, and the cyan drag indicator.  Owns only those transient overlay
// meshes — the index/marquee/drag *state* lives in sketchInteraction, which
// drives these builders (passing indices/positions as arguments).  Split out of
// sketchInteraction.js.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { useStore } from "../../store";
import { getSketchShapePoints, getShapePoint } from "../sceneObjects.js";

export function createSketchSelectionOverlays({
  scene,
  renderer,
  objectsRef,
  itemsRef,
  selectedIdRef,
}) {
  let sketchSelectionOverlay = null;
  let coincidentFirstOverlay = null;
  let multiSelectOverlays = [];
  let currentDragIndicator = null;

  const setCoincidentFirstOverlay = (o) => {
    coincidentFirstOverlay = o;
  };

  const clearSketchSelectionOverlay = () => {
    if (sketchSelectionOverlay) {
      scene.remove(sketchSelectionOverlay);
      if (sketchSelectionOverlay.geometry)
        sketchSelectionOverlay.geometry.dispose();
      if (sketchSelectionOverlay.material)
        sketchSelectionOverlay.material.dispose();
      sketchSelectionOverlay = null;
    }
  };

  const clearCoincidentFirstOverlay = () => {
    if (coincidentFirstOverlay) {
      scene.remove(coincidentFirstOverlay);
      coincidentFirstOverlay.geometry.dispose();
      coincidentFirstOverlay.material.dispose();
      coincidentFirstOverlay = null;
    }
  };

  const makeRingOverlay = (
    localPt,
    sketchMesh,
    color,
    R = 0.25,
    zOff = 0.009,
  ) => {
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, zOff);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const pts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(localPt.x + Math.cos(a) * R, localPt.y + Math.sin(a) * R);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    line.renderOrder = 1007;
    return line;
  };

  const sketchSelectPoint = (snap, sketchMesh) => {
    clearSketchSelectionOverlay();
    sketchSelectionOverlay = makeRingOverlay(
      { x: snap.x, y: snap.y },
      sketchMesh,
      0x00ff88,
    );
    scene.add(sketchSelectionOverlay);
    useStore.getState().setSelectedSketchElement({
      type: "point",
      shapeIdx: snap.shapeIdx,
      pointKey: snap.pointKey,
    });
  };

  const sketchSelectLine = (shapeIdx, shape, sketchMesh) => {
    clearSketchSelectionOverlay();
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length >= 2) {
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: 0x00ff88,
        linewidth: 2.5,
        depthTest: false,
        resolution: renderer.getSize(new THREE.Vector2()),
      });
      sketchSelectionOverlay = new Line2(geo, mat);
      sketchSelectionOverlay.computeLineDistances();
      sketchSelectionOverlay.renderOrder = 1005;
      scene.add(sketchSelectionOverlay);
    }
    useStore.getState().setSelectedSketchElement({ type: "line", shapeIdx });
  };

  const clearMultiSelectOverlays = () => {
    useStore.getState().setSketchMultiSelectedIndices([]);
    multiSelectOverlays.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    multiSelectOverlays = [];
  };

  const showMultiSelectOverlays = (indices) => {
    clearMultiSelectOverlays();
    useStore.getState().setSketchMultiSelectedIndices([...indices]);
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    indices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: 0x44aaff,
        linewidth: 2.5,
        depthTest: false,
        resolution: renderer.getSize(new THREE.Vector2()),
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 1005;
      scene.add(line);
      multiSelectOverlays.push(line);
    });
  };

  const clearDragIndicator = () => {
    if (currentDragIndicator) {
      scene.remove(currentDragIndicator);
      currentDragIndicator.geometry.dispose();
      currentDragIndicator.material.dispose();
      currentDragIndicator = null;
    }
  };

  const showDragIndicator = (localPt, sketchMesh) => {
    clearDragIndicator();
    const R = 0.18;
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0.008);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const circlePts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(localPt.x + Math.cos(a) * R, localPt.y + Math.sin(a) * R);
    });
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffcc,
      depthTest: false,
    });
    currentDragIndicator = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circlePts),
      mat,
    );
    currentDragIndicator.renderOrder = 1006;
    scene.add(currentDragIndicator);
  };

  // Rebuild the green selection overlay at the selected element's CURRENT
  // geometry.  The overlay is a standalone scene mesh — not part of the sketch
  // shapes group that React rebuilds on every shape change — so without this it
  // lingers at the pre-edit position when a dimension or variable edit moves
  // the line.  No-op unless something is actually selected.
  const refreshSketchSelectionOverlay = () => {
    if (!sketchSelectionOverlay) return;
    const state = useStore.getState();
    const sel = state.selectedSketchElement;
    if (!sel) return;
    // Read items from the store, not itemsRef: this runs synchronously right
    // after a store update, before React re-renders and re-syncs itemsRef.
    const selItem = state.items.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shape = (selItem.shapes || [])[sel.shapeIdx];
    if (!shape) return;
    if (sel.type === "line") {
      sketchSelectLine(sel.shapeIdx, shape, sketchMesh);
    } else if (sel.type === "point") {
      const p = getShapePoint(shape, sel.pointKey);
      if (p)
        sketchSelectPoint(
          { x: p.x, y: p.y, shapeIdx: sel.shapeIdx, pointKey: sel.pointKey },
          sketchMesh,
        );
    }
  };

  return {
    setCoincidentFirstOverlay,
    refreshSketchSelectionOverlay,
    clearSketchSelectionOverlay,
    clearCoincidentFirstOverlay,
    makeRingOverlay,
    sketchSelectPoint,
    sketchSelectLine,
    clearMultiSelectOverlays,
    showMultiSelectOverlays,
    clearDragIndicator,
    showDragIndicator,
    hasSketchSelectionOverlay: () => sketchSelectionOverlay !== null,
    hasMultiSelectOverlays: () => multiSelectOverlays.length > 0,
  };
}
