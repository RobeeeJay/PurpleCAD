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
import {
  SKETCH_SELECTION_GREEN,
  SKETCH_SELECTION_BLUE,
  SKETCH_SELECTION_TEAL,
  SKETCH_PIVOT_COLOR,
} from "../theme.js";

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
  let bezierHandles = []; // dotted tangent lines + control-point dots for a
  // selected bezier (rebuilt on selection and while its handles drag)

  const setCoincidentFirstOverlay = (o) => {
    coincidentFirstOverlay = o;
  };

  // Extra highlights for the elements picked so far in a multi-pick constraint
  // (a line's whole span, alongside the point ring in coincidentFirstOverlay).
  // Shown in the SELECTION colours so a pending pick reads like a selection;
  // cleared together with the point ring.
  let constraintPickOverlays = [];
  const addConstraintPickLine = (shape, sketchMesh) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: SKETCH_SELECTION_BLUE,
      linewidth: 2.5,
      depthTest: false,
      dashed: !!shape.dashed,
      dashSize: shape.dashed ? 0.1 : 0,
      gapSize: shape.dashed ? 0.06 : 0,
      resolution: renderer.getSize(new THREE.Vector2()),
    });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1005;
    scene.add(line);
    constraintPickOverlays.push(line);
  };

  const clearBezierHandles = () => {
    bezierHandles.forEach((o) => {
      scene.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    bezierHandles = [];
  };

  // Dotted tangent handles (p0→p1, p3→p2) plus a dot at each control point, so a
  // selected bezier exposes draggable handles that reshape the curve.
  const renderBezierHandles = (shape, sketchMesh) => {
    clearBezierHandles();
    if (!shape || shape.type !== "bezier") return;
    const toW = (p) =>
      new THREE.Vector3(p.x, p.y, 0.007)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    for (const [a, b] of [
      [shape.p0, shape.p1],
      [shape.p3, shape.p2],
    ]) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([toW(a), toW(b)]),
        new THREE.LineDashedMaterial({
          color: SKETCH_PIVOT_COLOR,
          dashSize: 0.08,
          gapSize: 0.05,
          depthTest: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 1006;
      scene.add(line);
      bezierHandles.push(line);
    }
    for (const p of [shape.p1, shape.p2]) {
      const dot = makeRingOverlay(
        p,
        sketchMesh,
        SKETCH_PIVOT_COLOR,
        0.14,
        0.009,
      );
      dot.renderOrder = 1007;
      scene.add(dot);
      bezierHandles.push(dot);
    }
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
    clearBezierHandles();
    clearRotationHandle();
  };

  const clearCoincidentFirstOverlay = () => {
    if (coincidentFirstOverlay) {
      scene.remove(coincidentFirstOverlay);
      coincidentFirstOverlay.geometry.dispose();
      coincidentFirstOverlay.material.dispose();
      coincidentFirstOverlay = null;
    }
    constraintPickOverlays.forEach((o) => {
      scene.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    constraintPickOverlays = [];
  };

  const ringPoints = (localPt, sketchMesh, R = 0.25, zOff = 0.009) => {
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, zOff);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    return Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(localPt.x + Math.cos(a) * R, localPt.y + Math.sin(a) * R);
    });
  };

  const moveRing = (ring, localPt, sketchMesh) => {
    ring.geometry.dispose();
    ring.geometry = new THREE.BufferGeometry().setFromPoints(
      ringPoints(localPt, sketchMesh),
    );
  };

  const makeRingOverlay = (
    localPt,
    sketchMesh,
    color,
    R = 0.25,
    zOff = 0.009,
  ) => {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        ringPoints(localPt, sketchMesh, R, zOff),
      ),
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
      SKETCH_SELECTION_GREEN,
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
      // Match the blue used for multi-selected lines so selection reads
      // consistently whether one line or several are picked.  Dash the overlay
      // for construction lines so the highlight reads as dotted like the line.
      const mat = new LineMaterial({
        color: SKETCH_SELECTION_BLUE,
        linewidth: 2.5,
        depthTest: false,
        dashed: !!shape.dashed,
        dashSize: shape.dashed ? 0.1 : 0,
        gapSize: shape.dashed ? 0.06 : 0,
        resolution: renderer.getSize(new THREE.Vector2()),
      });
      sketchSelectionOverlay = new Line2(geo, mat);
      sketchSelectionOverlay.computeLineDistances();
      sketchSelectionOverlay.renderOrder = 1005;
      scene.add(sketchSelectionOverlay);
    }
    useStore.getState().setSelectedSketchElement({ type: "line", shapeIdx });
    // The store, not itemsRef: a just-pasted shape is not in itemsRef yet.
    const selItem = useStore
      .getState()
      .items.find((i) => i.id === selectedIdRef.current);
    if (selItem)
      buildRotationHandleFor(selItem.shapes || [], [shapeIdx], sketchMesh);
    renderBezierHandles(shape, sketchMesh);
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
    // The click that seeded this selection may have drawn a single highlight.
    // With no selected element left to say where it belongs, nothing would ever
    // move it again, and it stayed behind when a constraint moved the line.
    if (indices.length > 0) clearSketchSelectionOverlay();
    clearMultiSelectOverlays();
    useStore.getState().setSketchMultiSelectedIndices([...indices]);
    // Read items from the store, not itemsRef, as refreshSketchSelectionOverlay
    // does: a caller that has just added shapes (paste) runs before React
    // re-syncs itemsRef, which would not have them yet -- and the new
    // selection would be set with nothing drawn to show it.
    const selItem = useStore
      .getState()
      .items.find((i) => i.id === selectedIdRef.current);
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    buildRotationHandleFor(shapes, indices, sketchMesh);
    indices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      // A standalone point can join the multiselect (midpoint pairs a point
      // with a line/arc/curve) — mark it with a ring since it has no polyline.
      if (shape.type === "point") {
        const ring = makeRingOverlay(
          { x: shape.x, y: shape.y },
          sketchMesh,
          SKETCH_SELECTION_BLUE,
        );
        ring.userData.shapeIdx = idx;
        scene.add(ring);
        multiSelectOverlays.push(ring);
        return;
      }
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: SKETCH_SELECTION_BLUE,
        linewidth: 2.5,
        depthTest: false,
        dashed: !!shape.dashed,
        dashSize: shape.dashed ? 0.1 : 0,
        gapSize: shape.dashed ? 0.06 : 0,
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
      color: SKETCH_SELECTION_TEAL,
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
    // A committed dimension / constraint refreshes the selection — that ends the
    // pick phase, so drop any pending constraint-pick highlights (the green ring
    // and blue line spans).  Refresh isn't called mid-pick, so this is safe.
    clearCoincidentFirstOverlay();
    const state = useStore.getState();
    // Read items from the store, not itemsRef: this runs synchronously right
    // after a store update, before React re-renders and re-syncs itemsRef.
    const selItem0 = state.items.find((i) => i.id === selectedIdRef.current);
    const sketchMesh0 = selItem0 ? objectsRef.current[selItem0.id] : null;
    // A multi-selection (e.g. two lines a parallel/tangent constraint just moved)
    // has no single green overlay — glue its blue highlights to the new geometry.
    const multi = state.sketchMultiSelectedIndices;
    if (selItem0 && sketchMesh0 && multi && multi.length > 0) {
      updateSelectionForDrag(selItem0.shapes || [], sketchMesh0, true);
    }
    if (!sketchSelectionOverlay) return;
    const sel = state.selectedSketchElement;
    if (!sel) return;
    const selItem = selItem0;
    const sketchMesh = sketchMesh0;
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
      new THREE.LineBasicMaterial({
        color: SKETCH_PIVOT_COLOR,
        depthTest: false,
      }),
    );
    line.renderOrder = 1006;
    scene.add(line);
    objects.push(line);
    const pivot = makeRingOverlay(
      center,
      sketchMesh,
      SKETCH_PIVOT_COLOR,
      0.12,
      0.008,
    );
    pivot.renderOrder = 1006;
    scene.add(pivot);
    objects.push(pivot);
    const knob = makeRingOverlay(
      grip,
      sketchMesh,
      SKETCH_PIVOT_COLOR,
      0.22,
      0.008,
    );
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
      if (!s) return;
      if (s.type === "point") {
        moveRing(o, s, sketchMesh);
        return;
      }
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
    if (sketchSelectionOverlay && sel?.type === "point") {
      const p = getShapePoint(shapes[sel.shapeIdx], sel.pointKey);
      if (p) moveRing(sketchSelectionOverlay, p, sketchMesh);
    }
    // Keep a selected bezier's tangent handles glued to the live curve.
    if (sel?.type === "line" && shapes[sel.shapeIdx]?.type === "bezier")
      renderBezierHandles(shapes[sel.shapeIdx], sketchMesh);
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
  // Suppressed when the selection is orientation-locked: a horizontal/vertical
  // constraint pins a side to a world axis, so rotation would break it.  Angle
  // constraints are RELATIVE (rotation-invariant), so they don't lock — a square
  // built from 90° angle constraints can still rotate as a rigid body.
  const buildRotationHandleFor = (shapes, indices, sketchMesh) => {
    const state = useStore.getState();
    const selItem = state.items.find((i) => i.id === selectedIdRef.current);
    // Projected geometry is immovable — it can't be rotated, so a selection of
    // only projected shapes shows no rotation handle.
    const rotatable = indices.filter((i) => !shapes[i]?.projection);
    if (rotatable.length === 0) {
      clearRotationHandle();
      return;
    }
    const idxSet = new Set(rotatable);
    const locked = (selItem?.constraints || []).some(
      (c) =>
        (c.type === "horizontal" || c.type === "vertical") &&
        idxSet.has(c.shapeIdx),
    );
    if (locked) {
      clearRotationHandle();
      return;
    }
    const pts = [];
    rotatable.forEach((idx) => {
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
    addConstraintPickLine,
    makeRingOverlay,
    sketchSelectPoint,
    sketchSelectLine,
    clearMultiSelectOverlays,
    showMultiSelectOverlays,
    clearDragIndicator,
    showDragIndicator,
    // Where each highlight actually sits, in sketch-local coordinates: e2e can
    // only compare them with the geometry by reading the drawn objects.
    selectionHighlights: (sketchMesh) => {
      const report = (o, kind, shapeIdx) => {
        const box = new THREE.Box3().setFromObject(o);
        if (o.geometry?.setPositions) {
          const a = o.geometry.attributes.instanceStart.array;
          const b = o.geometry.attributes.instanceEnd.array;
          box.makeEmpty();
          for (const arr of [a, b])
            for (let i = 0; i + 2 < arr.length; i += 3)
              box.expandByPoint(
                new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2]),
              );
        }
        const lo = sketchMesh.worldToLocal(box.min.clone());
        const hi = sketchMesh.worldToLocal(box.max.clone());
        return {
          kind,
          shapeIdx,
          minX: Math.min(lo.x, hi.x),
          maxX: Math.max(lo.x, hi.x),
          minY: Math.min(lo.y, hi.y),
          maxY: Math.max(lo.y, hi.y),
        };
      };
      return [
        ...(sketchSelectionOverlay
          ? [report(sketchSelectionOverlay, "single", null)]
          : []),
        ...multiSelectOverlays.map((o) =>
          report(o, "multi", o.userData.shapeIdx ?? null),
        ),
        ...constraintPickOverlays.map((o) => report(o, "pick", null)),
        ...(coincidentFirstOverlay
          ? [report(coincidentFirstOverlay, "pick", null)]
          : []),
      ];
    },
    hasSketchSelectionOverlay: () => sketchSelectionOverlay !== null,
    hasMultiSelectOverlays: () => multiSelectOverlays.length > 0,
  };
}
