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
  let rotationHandle = null; // { center:{x,y}, grip:{x,y}, objects:[...] }

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
    clearRotationHandle();
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
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    if (selItem)
      buildRotationHandleFor(selItem.shapes || [], [shapeIdx], sketchMesh);
  };

  const clearMultiSelectOverlays = () => {
    useStore.getState().setSketchMultiSelectedIndices([]);
    multiSelectOverlays.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    multiSelectOverlays = [];
    clearRotationHandle();
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
    buildRotationHandleFor(shapes, indices, sketchMesh);
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
      line.userData.shapeIdx = idx;
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

  // ── Rotation handle (for rotating the sketch selection about its centre) ──
  const clearRotationHandle = () => {
    if (rotationHandle) {
      rotationHandle.objects.forEach((o) => {
        scene.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      rotationHandle = null;
    }
  };

  // center/grip are local sketch coords; the grip is the grabbable knob and the
  // ring marks the pivot.  A faint line joins them so the affordance reads as a
  // rotation lever.
  const showRotationHandle = (center, grip, sketchMesh) => {
    clearRotationHandle();
    const toW = (x, y) =>
      new THREE.Vector3(x, y, 0.008)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const objects = [];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        toW(center.x, center.y),
        toW(grip.x, grip.y),
      ]),
      new THREE.LineBasicMaterial({ color: 0x00ddff, depthTest: false }),
    );
    line.renderOrder = 1006;
    scene.add(line);
    objects.push(line);
    const pivot = makeRingOverlay(center, sketchMesh, 0x00ddff, 0.12, 0.008);
    pivot.renderOrder = 1006;
    scene.add(pivot);
    objects.push(pivot);
    const knob = makeRingOverlay(grip, sketchMesh, 0x00ddff, 0.22, 0.008);
    knob.renderOrder = 1006;
    scene.add(knob);
    objects.push(knob);
    rotationHandle = { center: { ...center }, grip: { ...grip }, objects };
  };

  const getRotationHandle = () => rotationHandle;

  // Rebuild the rotation handle from the CURRENT store selection + committed
  // shapes — used after a drag commits so the handle sits correctly on the
  // settled geometry (read from the store, since itemsRef hasn't re-synced yet).
  const refreshRotationHandle = () => {
    const state = useStore.getState();
    const selItem = state.items.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) {
      clearRotationHandle();
      return;
    }
    const multiIdx = state.sketchMultiSelectedIndices || [];
    const sel = state.selectedSketchElement;
    const indices =
      multiIdx.length > 0
        ? multiIdx
        : sel?.type === "line"
          ? [sel.shapeIdx]
          : [];
    if (indices.length > 0)
      buildRotationHandleFor(selItem.shapes || [], indices, sketchMesh);
    else clearRotationHandle();
  };

  // Move the static selection overlays (multi-select highlights, green line,
  // rotation handle) to follow the live drag geometry instead of ghosting at the
  // pre-drag position.  `shapes` is the in-flight (un-committed) shapes array.
  // rebuildHandle=false keeps the rotation pivot put during a rotation drag.
  const updateSelectionForDrag = (shapes, sketchMesh, rebuildHandle) => {
    const toPos = (s) => {
      const pts = getSketchShapePoints(s, sketchMesh);
      return pts.length >= 2 ? pts.flatMap((p) => [p.x, p.y, p.z]) : null;
    };
    multiSelectOverlays.forEach((o) => {
      const s = shapes[o.userData.shapeIdx];
      if (!s || !o.geometry?.setPositions) return;
      const pos = toPos(s);
      if (pos) {
        o.geometry.setPositions(pos);
        o.computeLineDistances?.();
      }
    });
    const sel = useStore.getState().selectedSketchElement;
    if (
      sketchSelectionOverlay?.geometry?.setPositions &&
      sel?.type === "line" &&
      shapes[sel.shapeIdx]
    ) {
      const pos = toPos(shapes[sel.shapeIdx]);
      if (pos) {
        sketchSelectionOverlay.geometry.setPositions(pos);
        sketchSelectionOverlay.computeLineDistances?.();
      }
    }
    if (rebuildHandle) {
      const indices = multiSelectOverlays
        .map((o) => o.userData.shapeIdx)
        .filter((i) => i != null);
      const rotIdx =
        indices.length > 0
          ? indices
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (rotIdx.length > 0) buildRotationHandleFor(shapes, rotIdx, sketchMesh);
    }
  };

  // Local-space points that bound a shape, for the rotation pivot + extent.
  const localExtentPoints = (s) => {
    if (!s) return [];
    if (s.type === "line")
      return [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ];
    if (s.type === "rect")
      return [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ];
    if (s.type === "circle")
      return [
        { x: s.cx - s.r, y: s.cy },
        { x: s.cx + s.r, y: s.cy },
        { x: s.cx, y: s.cy - s.r },
        { x: s.cx, y: s.cy + s.r },
      ];
    if (s.type === "arc" || s.type === "ellipse") return [{ x: s.cx, y: s.cy }];
    if (s.type === "bezier") return [s.p0, s.p1, s.p2, s.p3];
    return [];
  };

  // Build the rotation handle around the bbox of the given selected shapes.
  // The handle is always offered; orientation-locking constraints (H/V, angle)
  // restrict the rotation at drag time (the locked lines won't tilt) rather than
  // hiding the affordance.
  const buildRotationHandleFor = (shapes, indices, sketchMesh) => {
    const pts = [];
    indices.forEach((idx) => {
      for (const p of localExtentPoints(shapes[idx])) pts.push(p);
    });
    if (pts.length < 2) {
      clearRotationHandle();
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const margin = Math.max((maxY - minY) / 2, (maxX - minX) / 2, 1) * 0.25 + 1;
    const grip = { x: center.x, y: maxY + margin };
    showRotationHandle(center, grip, sketchMesh);
  };

  return {
    setCoincidentFirstOverlay,
    refreshSketchSelectionOverlay,
    showRotationHandle,
    clearRotationHandle,
    getRotationHandle,
    refreshRotationHandle,
    updateSelectionForDrag,
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
