// Sketch-mode interaction: all the stateful sketch subsystem extracted from
// cameraControls.js.  Owns the sketch selection / marquee / multi-select /
// drag / clipboard / long-press-menu state plus the sketch element-selection,
// dragging, region-fill, and constraint helpers, and the sketch sub-factories
// (modify / constraint-click / draw).  Returns the sketch branches of the
// mouse/keyboard handlers (onSketch* return true when they handled the event)
// so cameraControls can stay a thin dispatcher.  The foundational geometry
// helpers (screenToSketchLocal, pointInPolygon2D, makeRay, hitTestSketchLines),
// snap helpers, and hover/constraint-selection visuals live in cameraControls
// and are passed in — they are shared with the extrude and 3D-view paths.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  getSketchShapePoints,
  getSnapPoints,
  getShapeLength,
  getShapePoint,
  moveShapePoint,
  rebuildConstraintIconsForDrag,
  rebuildPointDotsForDrag,
  polyArea,
  snapUnitToIntervalMm,
} from "../sceneObjects.js";
import {
  applyHVEnforcement,
  enforceConstraints,
} from "../sketchConstraints.js";
import {
  translateShape,
  rotateShape,
  collectConnectedShapes,
} from "../sketchGeometry.js";
import {
  solveConstraints,
  fieldsForPoint,
  varFields,
} from "../sketchSolver.js";
import { SKETCH_LINE_COLOR, SKETCH_HOVER_POINT_LINE_COLOR } from "../theme.js";
import {
  selectedSketchLineIndices,
  offsetSelectedSketchGeometry,
} from "../sketchModifyActions.js";
import { createSketchSelectionOverlays } from "./sketchSelectionOverlays.js";
import { createSketchModifyHelpers } from "./sketchModify.js";
import { createSketchConstraintHandlers } from "./sketchConstraintHandlers.js";
import { createSketchDrawHelpers } from "./sketchDraw.js";

// An offset copy is inert while its offset constraint exists — driven by its
// original, it must not be selectable/draggable on its own.
const isOffsetShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "offset" && c.shapeIdx === idx,
  );

export function createSketchInteraction(
  {
    scene,
    renderer,
    cameraRef,
    objectsRef,
    itemsRef,
    selectedIdRef,
    sketchModeRef,
    sketchShapesGroupRef,
    sketchDrawRef,
    activeSketchToolRef,
    dimHintRef,
    extrudeSelectModeRef,
    sketchPlacementModeRef,
    cameraControlsRef,
    propagateConstraintsRef,
  },
  {
    screenToSketchLocal,
    pointInPolygon2D,
    makeRay,
    hitTestSketchLines,
    clearSnapIndicator,
    showSnapIndicator,
    findSnap,
    makePreviewLine2,
    clearAllSketchHover,
    updateSketchHover,
    clearHoverLineHighlight,
    applyHoverLineHighlight,
    showHoverPointIndicator,
    clearHoverPointIndicator,
    clearConstraintHoverHighlight,
    applyConstraintHoverHighlight,
    clearConstraintSelection,
    reapplyConstraintSelectionVisual,
    selectConstraint,
    getSelectedConstraintIdx,
    cancelExtrude,
    clearStartHighlight,
    setSketchDrawPhase,
    isMac,
  },
) {
  const controls = cameraControlsRef.current;

  // ── Sketch drawing preview cleanup ────────────────────────────────────────
  const clearSketchPreview = () => {
    const draw = sketchDrawRef.current;
    if (draw) {
      draw.previewObjects.forEach((obj) => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      draw.previewObjects = [];
    }
  };
  const clearHoverFills = () => {
    const g = sketchShapesGroupRef?.current;
    if (g)
      g.children.forEach((c) => {
        if (c.userData.isRegionFill) c.visible = false;
      });
  };

  const updateHoverFills = (screenX, screenY) => {
    const g = sketchShapesGroupRef?.current;
    if (!g) return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) {
      clearHoverFills();
      return;
    }
    const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) {
      clearHoverFills();
      return;
    }
    // First pass: determine which fill is the best match.
    // Priority: highest renderOrder first; among equal renderOrders prefer smallest
    // polygon area so that a small inner region (e.g. a circle sitting inside a triangle)
    // always wins over the triangle when both are at the same nesting depth.
    let bestFill = null;
    for (const c of g.children) {
      if (!c.userData.isRegionFill) continue;
      const inOuter = pointInPolygon2D(localPt, c.userData.polygon2D);
      const inHole = (c.userData.holes2D || []).some((h) =>
        pointInPolygon2D(localPt, h),
      );
      if (inOuter && !inHole) {
        const cOrder = c.renderOrder ?? 0;
        const bOrder = bestFill ? (bestFill.renderOrder ?? 0) : -1;
        const cArea = polyArea(c.userData.polygon2D);
        const bArea = bestFill
          ? polyArea(bestFill.userData.polygon2D)
          : Infinity;
        if (
          !bestFill ||
          cOrder > bOrder ||
          (cOrder === bOrder && cArea < bArea)
        )
          bestFill = c;
      }
    }
    // Second pass: show only the best match
    g.children.forEach((c) => {
      if (!c.userData.isRegionFill) return;
      c.visible = c === bestFill;
    });
  };
  let multiSelectedIndices = [];
  let marqueeStartScreen = null;
  let marqueeActive = false;
  let marqueeRectObj = null;
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let sketchClipboard = null; // { shapes: [...], constraints: [...] }
  let longPressTimer = null;
  let longPressMenuOpen = false;

  // ── Selection / coincident-first / multi-select / drag overlay meshes ─────
  const {
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
    hasSketchSelectionOverlay,
    hasMultiSelectOverlays,
    getRotationHandle,
    refreshRotationHandle,
    updateSelectionForDrag,
  } = createSketchSelectionOverlays({
    scene,
    renderer,
    objectsRef,
    itemsRef,
    selectedIdRef,
  });

  // Exposed on cameraControlsRef so SketchOverlays can drive hover/select for
  // the long-press context menu without duplicating these highlight functions.
  controls.highlightForMenu = (item) => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    if (item.kind === "point") {
      showHoverPointIndicator({ x: item.localX, y: item.localY }, sketchMesh);
      // Match the cursor-hover behaviour: tint the point's owner line amber.
      const g = sketchShapesGroupRef?.current;
      const ownerLine = g?.children.find(
        (c) =>
          c.userData.shapeIdx === item.shapeIdx &&
          !c.userData.isConstraintObj &&
          c.material?.color,
      );
      if (ownerLine)
        applyHoverLineHighlight(ownerLine, SKETCH_HOVER_POINT_LINE_COLOR);
    } else if (item.kind === "line") {
      const g = sketchShapesGroupRef?.current;
      if (g) {
        const lineObj = g.children.find(
          (c) =>
            c.userData.shapeIdx === item.shapeIdx &&
            !c.userData.isConstraintObj &&
            c.material?.color,
        );
        if (lineObj) applyHoverLineHighlight(lineObj);
      }
    } else if (item.kind === "constraint") {
      applyConstraintHoverHighlight(item.shapeIndices, item.constraintColor);
    }
  };
  controls.clearMenuHighlight = () => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
  };
  controls.selectMenuItem = (item) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    clearAllSketchHover();
    if (item.kind === "point") {
      sketchSelectPoint(
        {
          x: item.localX,
          y: item.localY,
          shapeIdx: item.shapeIdx,
          pointKey: item.pointKey,
        },
        sketchMesh,
      );
    } else if (item.kind === "line") {
      const shape = (selItem.shapes || [])[item.shapeIdx];
      if (shape) sketchSelectLine(item.shapeIdx, shape, sketchMesh);
    } else if (item.kind === "constraint") {
      selectConstraint(item.constraintIdx);
    }
  };

  const clearMarqueeRect = () => {
    if (marqueeRectObj) {
      scene.remove(marqueeRectObj);
      marqueeRectObj.geometry.dispose();
      marqueeRectObj.material.dispose();
      marqueeRectObj = null;
    }
  };

  const updateMarquee = (screenX, screenY) => {
    clearMarqueeRect();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh || !marqueeStartScreen) return;
    const p1 = screenToSketchLocal(
      marqueeStartScreen.x,
      marqueeStartScreen.y,
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
      color: SKETCH_LINE_COLOR,
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
        !isOffsetShapeIdx(selItem, pt.shapeIdx)
      )
        inRect.add(pt.shapeIdx);
    });
    multiSelectedIndices = [...inRect];
    showMultiSelectOverlays(multiSelectedIndices);
  };

  const clearSketchSelection = () => {
    clearSketchSelectionOverlay();
    useStore.getState().setSelectedSketchElement(null);
    clearMultiSelectOverlays();
    multiSelectedIndices = [];
  };

  // Whenever sketch shapes are mutated (any store items change while in sketch
  // mode), the selection overlay drawn at the old position becomes a ghost.
  // Clear it so the user sees the updated geometry without stale highlights.
  const unsubItems = useStore.subscribe(
    (state) => state.items,
    () => {
      if (!sketchModeRef.current) return;
      if (hasSketchSelectionOverlay()) clearSketchSelectionOverlay();
      if (hasMultiSelectOverlays()) {
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
      }
      clearConstraintHoverHighlight();
      clearConstraintSelection();
    },
  );

  const trySelectSketchElement = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    // Point hit first (ignore offset-copy points — they're inert).
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (snap && !isOffsetShapeIdx(selItem, snap.shapeIdx)) {
      sketchSelectPoint(snap, sketchMesh);
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      return;
    }
    // Line hit
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null && !c.userData.isOffset,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const shape = shapes[shapeIdx];
        if (shape) {
          sketchSelectLine(shapeIdx, shape, sketchMesh);
          const len = getShapeLength(shape);
          if (len !== null && dimHintRef.current) {
            const rect2 = renderer.domElement.getBoundingClientRect();
            dimHintRef.current.textContent = `${len.toFixed(1)} mm`;
            dimHintRef.current.style.display = "block";
            dimHintRef.current.style.left = `${screenX - rect2.left + 16}px`;
            dimHintRef.current.style.top = `${screenY - rect2.top - 10}px`;
          }
          return;
        }
      }
    }
    // Region-fill click: select all boundary shapes that form the hovered area
    const localForFill = screenToSketchLocal(screenX, screenY, sketchMesh);
    const sketchGroup2 = sketchShapesGroupRef?.current;
    if (localForFill && sketchGroup2) {
      // Sort fills so higher renderOrder (inner fills) are checked first
      const fillMeshes = sketchGroup2.children
        .filter((c) => c.userData.isRegionFill)
        .sort((a, b) => (b.renderOrder ?? 0) - (a.renderOrder ?? 0));
      for (const fill of fillMeshes) {
        const inOuter = pointInPolygon2D(localForFill, fill.userData.polygon2D);
        const inHole = (fill.userData.holes2D || []).some((h) =>
          pointInPolygon2D(localForFill, h),
        );
        if (inOuter && !inHole) {
          const indices = fill.userData.shapeIndices || [];
          if (indices.length > 0) {
            multiSelectedIndices = indices;
            showMultiSelectOverlays(indices);
            clearSketchSelectionOverlay();
            useStore.getState().setSelectedSketchElement(null);
            if (dimHintRef.current) dimHintRef.current.style.display = "none";
            return;
          }
        }
      }
    }
    clearSketchSelection();
    if (dimHintRef.current) dimHintRef.current.style.display = "none";
  };
  // ── Sketch element dragging ───────────────────────────────────────────────
  let sketchDrag = null; // { kind:"point"|"shape", shapeIdx, pointKey?, sketchMesh, selItemId, anchorLocal, origShape }

  const updateSketchLineGeo = (lineObj, newShape, sketchMesh) => {
    const pts = getSketchShapePoints(newShape, sketchMesh);
    if (pts.length < 2) return;
    lineObj.geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    lineObj.computeLineDistances();
  };

  // Wrapper: reads shapes/constraints from store, delegates to enforceConstraints.
  const propagateConstraints = (
    selItemId,
    primaryIdx,
    primaryShape,
    primaryPointKey = null,
    preSeeded = null,
  ) => {
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return new Map([[primaryIdx, primaryShape]]);
    return enforceConstraints(
      selItem.shapes || [],
      selItem.constraints || [],
      primaryIdx,
      primaryShape,
      primaryPointKey,
      preSeeded,
    );
  };

  const mapToArray = (map) => {
    const a = [];
    map.forEach((s, i) => (a[i] = s));
    return a;
  };

  // Drag propagation via the full numerical solver: the dragged point(s) are
  // pinned at their target and the whole constraint system is solved around
  // them.  Handles coupled cases the propagation rules can't (e.g. dragging a
  // corner of an angle-constrained square keeps every angle 90°).  Returns a
  // Map<idx, shape> of the solved geometry.  `placed` is a Map<idx, shape> of
  // shapes whose listed point(s) are explicitly placed (pinned); `pointKeys` is
  // a Map<idx, pointKey|null> — null pins the whole shape (a rigid translate).
  // `warm` (an array of the previous frame's solved shapes) is the starting
  // configuration: solving incrementally from it keeps each drag frame cheap.
  const solveDrag = (selItemId, placed, pointKeys, warm) => {
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return placed;
    const warmed = warm && warm.length > 0;
    const input = (warmed ? warm : selItem.shapes || []).slice();
    const fixed = new Set();
    for (const [idx, s] of placed) {
      const key = pointKeys.get(idx);
      if (key) {
        // Pin only the placed point; the rest of this shape keeps its warm
        // position so the solve stays incremental.
        const target = getShapePoint(s, key);
        input[idx] =
          target && input[idx] ? moveShapePoint(input[idx], key, target) : s;
        for (const f of fieldsForPoint(s, key)) fixed.add(`${idx}:${f}`);
      } else {
        input[idx] = s; // whole shape placed (rigid translate / rotate)
        for (const f of varFields(s)) fixed.add(`${idx}:${f}`);
      }
    }
    const { shapes } = solveConstraints(input, selItem.constraints || [], {
      fixed,
      maxIter: warmed ? 30 : 60,
    });
    const out = new Map();
    shapes.forEach((s, i) => out.set(i, s));
    return out;
  };

  // Expose propagateConstraints so Viewport can enforce constraints immediately
  // after adding or editing them (outside a drag operation).
  if (propagateConstraintsRef)
    propagateConstraintsRef.current = propagateConstraints;

  // ── Chamfer / Bevel helpers ───────────────────────────────────────────────
  const sketchModify = createSketchModifyHelpers(
    { scene, renderer, objectsRef, itemsRef, selectedIdRef },
    { findSnap, propagateConstraints },
  );
  const { clearModifyPreview, applyModify, showModifyPreview } = sketchModify;

  // ── Sketch constraint click handlers (distance / coincident / on-line) ────
  const sketchConstraints = createSketchConstraintHandlers(
    {
      scene,
      renderer,
      cameraRef,
      objectsRef,
      itemsRef,
      selectedIdRef,
      sketchShapesGroupRef,
    },
    {
      findSnap,
      hitTestSketchLines,
      makeRay,
      propagateConstraints,
      makeRingOverlay,
      clearCoincidentFirstOverlay,
      clearSketchSelection,
      setCoincidentFirstOverlay,
    },
  );
  const { handleDistanceConstraintClick, handleCoincidentClick } =
    sketchConstraints;
  const applySketchDragMove = (screenX, screenY, shiftKey) => {
    if (!sketchDrag) return;
    const { kind, sketchMesh, selItemId, anchorLocal } = sketchDrag;
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return;

    let localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) return;

    // ── Rotation drag: rotate the selection about its centre ────────────────
    if (kind === "rotate") {
      const { indices, origShapes, center } = sketchDrag;
      let angle =
        Math.atan2(localPt.y - center.y, localPt.x - center.x) -
        sketchDrag.startAngle;
      const snapCfg = useStore.getState();
      if (snapCfg.snapEnabled && snapCfg.snapAngleDeg > 0) {
        const step = (snapCfg.snapAngleDeg * Math.PI) / 180;
        angle = Math.round(angle / step) * step;
      }
      const pendingShapes = new Map();
      indices.forEach((idx, i) => {
        const r = rotateShape(origShapes[i], center.x, center.y, angle);
        if (r) pendingShapes.set(idx, r);
      });
      sketchDrag.pendingShapes = pendingShapes;
      // Pin the rotated shapes and solve the rest of the system around them, so
      // any geometry connected to the selection (but not selected) follows.
      const rotKeys = new Map();
      for (const idx of pendingShapes.keys()) rotKeys.set(idx, null);
      const allMoved = solveDrag(
        selItemId,
        new Map(pendingShapes),
        rotKeys,
        sketchDrag.solverWarm,
      );
      sketchDrag.solverWarm = mapToArray(allMoved);
      sketchDrag.multiPropagated = allMoved;
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchGroup) {
        allMoved.forEach((shape, idx) => {
          const lineObj = sketchGroup.children.find(
            (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
          );
          if (lineObj) updateSketchLineGeo(lineObj, shape, sketchMesh);
        });
        const tempShapes = (selItem.shapes || []).slice();
        allMoved.forEach((s, i) => {
          tempShapes[i] = s;
        });
        rebuildConstraintIconsForDrag(
          sketchGroup,
          selItem.constraints || [],
          tempShapes,
          sketchMesh,
          renderer,
          useStore.getState().dimensionsVisible,
        );
        rebuildPointDotsForDrag(sketchGroup, tempShapes, sketchMesh);
        reapplyConstraintSelectionVisual();
        // Highlights follow the rotation; keep the pivot put (rebuildHandle=false).
        updateSelectionForDrag(tempShapes, sketchMesh, false);
      }
      clearHoverFills();
      return;
    }

    // ── Multi-shape drag ───────────────────────────────────────────────────
    if (kind === "multi") {
      const { multiIndices, multiOrigShapes } = sketchDrag;
      // Snap the dragged anchor to the grid so the whole group lands on it.
      const snapCfg = useStore.getState();
      const anchorNow =
        snapCfg.snapEnabled && snapCfg.snapDistanceMm > 0
          ? {
              x: snapUnitToIntervalMm(localPt.x, snapCfg.snapDistanceMm),
              y: snapUnitToIntervalMm(localPt.y, snapCfg.snapDistanceMm),
            }
          : localPt;
      const dx = anchorNow.x - anchorLocal.x;
      const dy = anchorNow.y - anchorLocal.y;
      const pendingShapes = new Map();
      multiIndices.forEach((idx, i) => {
        const moved = translateShape(multiOrigShapes[i], dx, dy);
        if (moved) pendingShapes.set(idx, moved);
      });
      sketchDrag.pendingShapes = pendingShapes;
      // Pin the whole moved group and solve the rest of the system around it.
      const multiKeys = new Map();
      for (const idx of pendingShapes.keys()) multiKeys.set(idx, null);
      const allMoved = solveDrag(
        selItemId,
        new Map(pendingShapes),
        multiKeys,
        sketchDrag.solverWarm,
      );
      sketchDrag.solverWarm = mapToArray(allMoved);
      sketchDrag.multiPropagated = allMoved;
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchGroup) {
        allMoved.forEach((shape, idx) => {
          const lineObj = sketchGroup.children.find(
            (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
          );
          if (lineObj) updateSketchLineGeo(lineObj, shape, sketchMesh);
        });
        const tempShapes = (selItem.shapes || []).slice();
        allMoved.forEach((s, i) => {
          tempShapes[i] = s;
        });
        rebuildConstraintIconsForDrag(
          sketchGroup,
          selItem.constraints || [],
          tempShapes,
          sketchMesh,
          renderer,
          useStore.getState().dimensionsVisible,
        );
        rebuildPointDotsForDrag(sketchGroup, tempShapes, sketchMesh);
        reapplyConstraintSelectionVisual();
        updateSelectionForDrag(tempShapes, sketchMesh, true);
      }
      clearHoverFills();
      return;
    }

    const { shapeIdx, pointKey, origShape } = sketchDrag;
    let pointSnapped = false;
    if (!shiftKey) {
      const others = selItem.shapes.filter((_, i) => i !== shapeIdx);
      const snap = findSnap(screenX, screenY, others, sketchMesh);
      if (snap) {
        localPt = { x: snap.x, y: snap.y };
        pointSnapped = true;
      }
    }
    // Snap-to-grid: when enabled and not already snapped to existing geometry,
    // round the in-plane position to the configured world-space interval.
    const snapCfg = useStore.getState();
    if (!pointSnapped && snapCfg.snapEnabled && snapCfg.snapDistanceMm > 0) {
      localPt = {
        x: snapUnitToIntervalMm(localPt.x, snapCfg.snapDistanceMm),
        y: snapUnitToIntervalMm(localPt.y, snapCfg.snapDistanceMm),
      };
    }

    let newShape;
    let draggedPointKey = null;
    let preSeeded = null;
    if (kind === "point") {
      draggedPointKey = pointKey;
      newShape = moveShapePoint(origShape, pointKey, localPt);
      if (newShape) {
        newShape = applyHVEnforcement(
          newShape,
          pointKey,
          selItem.constraints || [],
          shapeIdx,
        );
        showDragIndicator(localPt, sketchMesh);
      }
    } else {
      const dx = localPt.x - anchorLocal.x;
      const dy = localPt.y - anchorLocal.y;
      newShape = translateShape(origShape, dx, dy);
      if (newShape) {
        const constraints = selItem.constraints || [];
        const shapes = selItem.shapes;

        // Shapes that must translate rigidly: the dragged shape, plus any
        // coincident-connected shape that has a distance constraint (can't
        // resize, so it must move as a unit). Propagates transitively.
        const hasDistConst = (idx) =>
          constraints.some(
            (c) =>
              c.type === "distance" &&
              (c.shapeAIdx === idx || c.shapeBIdx === idx),
          );
        const rigidSet = new Set([shapeIdx]);
        const rigidQueue = [shapeIdx];
        while (rigidQueue.length > 0) {
          const cur = rigidQueue.shift();
          for (const c of constraints) {
            if (c.type !== "coincident") continue;
            let other = null;
            if (c.shapeAIdx === cur && !rigidSet.has(c.shapeBIdx))
              other = c.shapeBIdx;
            else if (c.shapeBIdx === cur && !rigidSet.has(c.shapeAIdx))
              other = c.shapeAIdx;
            if (other !== null && hasDistConst(other)) {
              rigidSet.add(other);
              rigidQueue.push(other);
            }
          }
        }

        // Pre-translate all rigid shapes; propagateConstraints will use these
        // as fixed starting state and handle all further constraint propagation.
        preSeeded = new Map();
        for (const idx of rigidSet) {
          const moved =
            idx === shapeIdx ? newShape : translateShape(shapes[idx], dx, dy);
          if (moved) preSeeded.set(idx, moved);
        }
      }
    }
    if (!newShape) return;

    // Pin the dragged point (or the whole rigid set for a body drag) and solve
    // the full system around it.
    const placed = new Map();
    const pointKeys = new Map();
    if (preSeeded) {
      for (const [idx, s] of preSeeded) {
        placed.set(idx, s);
        pointKeys.set(idx, null);
      }
    } else {
      placed.set(shapeIdx, newShape);
      pointKeys.set(shapeIdx, draggedPointKey);
    }
    const propagated = solveDrag(
      selItemId,
      placed,
      pointKeys,
      sketchDrag.solverWarm,
    );
    sketchDrag.solverWarm = mapToArray(propagated);
    sketchDrag.pendingShape = newShape;
    sketchDrag.propagatedShapes = propagated;

    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      propagated.forEach((constrainedShape, idx) => {
        const lineObj = sketchGroup.children.find(
          (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
        );
        if (lineObj) updateSketchLineGeo(lineObj, constrainedShape, sketchMesh);
      });
      const tempShapes = (selItem.shapes || []).slice();
      propagated.forEach((s, i) => {
        tempShapes[i] = s;
      });
      rebuildConstraintIconsForDrag(
        sketchGroup,
        selItem.constraints || [],
        tempShapes,
        sketchMesh,
        renderer,
      );
      rebuildPointDotsForDrag(sketchGroup, tempShapes, sketchMesh);
      updateSelectionForDrag(tempShapes, sketchMesh, true);
    }
    clearHoverFills();
  };

  const commitSketchDrag = () => {
    const store = useStore.getState();
    if (sketchDrag?.kind === "multi" || sketchDrag?.kind === "rotate") {
      const toSave = sketchDrag.multiPropagated ?? sketchDrag.pendingShapes;
      if (toSave?.size > 0) {
        store.updateSketchShapes(sketchDrag.selItemId, toSave);
      }
      // Keep the (live-positioned) selection highlights; just re-seat the
      // rotation handle on the settled geometry so the selection persists.
      refreshRotationHandle();
      clearCoincidentFirstOverlay();
      return;
    }
    if (!sketchDrag?.pendingShape) return;
    const { selItemId, shapeIdx, pendingShape, propagatedShapes } = sketchDrag;
    if (propagatedShapes && propagatedShapes.size > 0) {
      store.updateSketchShapes(selItemId, propagatedShapes);
    } else {
      store.updateSketchShape(selItemId, shapeIdx, pendingShape);
    }
    refreshRotationHandle();
    clearCoincidentFirstOverlay();
  };

  const SHAPE_TYPE_LABELS = {
    line: "Line",
    circle: "Circle",
    arc: "Arc",
    ellipse: "Ellipse",
    bezier: "Bezier",
    rect: "Rect",
  };
  const CONSTRAINT_TYPE_LABELS = {
    coincident: "Coincident",
    distance: "Distance",
    onLine: "On Line",
    horizontal: "Horizontal",
    vertical: "Vertical",
    angle: "Angle",
  };

  const buildLongPressItems = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return [];
    const shapes = selItem.shapes || [];
    const result = [];
    const rect = renderer.domElement.getBoundingClientRect();

    // Points within 20px
    const snapPts = getSnapPoints(shapes);
    for (const pt of snapPts) {
      const world = new THREE.Vector3(pt.x, pt.y, 0.003)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
      const ndc = world.clone().project(cameraRef.current);
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      if (Math.hypot(screenX - sx, screenY - sy) < 20) {
        const shapeLabel =
          SHAPE_TYPE_LABELS[shapes[pt.shapeIdx]?.type] ?? "Shape";
        result.push({
          kind: "point",
          label: `${shapeLabel} ${pt.shapeIdx} — ${pt.pointKey}`,
          shapeIdx: pt.shapeIdx,
          pointKey: pt.pointKey,
          localX: pt.x,
          localY: pt.y,
        });
      }
    }

    // Lines via raycaster
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null && !c.userData.isOffset,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      for (const hit of hits) {
        const shapeIdx = hit.object.userData.shapeIdx;
        if (shapeIdx == null) continue;
        if (result.some((i) => i.kind === "line" && i.shapeIdx === shapeIdx))
          continue;
        const shape = shapes[shapeIdx];
        if (!shape) continue;
        result.push({
          kind: "line",
          label: `${SHAPE_TYPE_LABELS[shape.type] ?? "Shape"} ${shapeIdx}`,
          shapeIdx,
        });
      }
    }

    // Constraint icons within 20px
    const seenConstraints = new Set();
    if (sketchGroup) {
      for (const cObj of sketchGroup.children) {
        if (!cObj.userData.isConstraint) continue;
        const ci = cObj.userData.constraintIdx;
        if (seenConstraints.has(ci)) continue;
        const lp = cObj.userData.constraintIconLocalPos;
        if (!lp) continue;
        const worldPt = new THREE.Vector3(lp.x, lp.y, 0.005)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const ndc = worldPt.clone().project(cameraRef.current);
        const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
        if (Math.hypot(screenX - sx, screenY - sy) < 20) {
          seenConstraints.add(ci);
          result.push({
            kind: "constraint",
            label:
              CONSTRAINT_TYPE_LABELS[cObj.userData.constraintType] ??
              cObj.userData.constraintType,
            constraintIdx: ci,
            constraintType: cObj.userData.constraintType,
            shapeIndices: cObj.userData.constraintShapeIndices,
            constraintColor: cObj.userData.constraintColor,
          });
        }
      }
    }

    return result;
  };

  const startSketchDrag = (screenX, screenY, shiftKey) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return false;
    const shapes = selItem.shapes || [];
    clearAllSketchHover();

    // Rotation handle: grab the knob to rotate the whole selection about its
    // centre.  Hit-test it first — it sits off the geometry, so it can't be
    // confused with a point/line drag.
    const rh = getRotationHandle();
    if (rh) {
      const gw = new THREE.Vector3(rh.grip.x, rh.grip.y, 0.008)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position)
        .project(cameraRef.current);
      const rect = renderer.domElement.getBoundingClientRect();
      const sx = ((gw.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-gw.y + 1) / 2) * rect.height + rect.top;
      if (Math.hypot(screenX - sx, screenY - sy) < 16) {
        const sel = useStore.getState().selectedSketchElement;
        const indices =
          multiSelectedIndices.length > 0
            ? [...multiSelectedIndices]
            : sel?.type === "line"
              ? [sel.shapeIdx]
              : [];
        const start = screenToSketchLocal(screenX, screenY, sketchMesh);
        if (indices.length > 0 && start) {
          sketchDrag = {
            kind: "rotate",
            sketchMesh,
            selItemId: selItem.id,
            center: { ...rh.center },
            indices,
            origShapes: indices.map((i) => shapes[i]),
            startAngle: Math.atan2(
              start.y - rh.center.y,
              start.x - rh.center.x,
            ),
          };
          renderer.domElement.style.cursor = "grabbing";
          return true;
        }
      }
    }

    // Point drag — check snap points first (higher priority, smaller target).
    // An offset copy's points are inert, so skip dragging by them.
    if (!shiftKey) {
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (snap && !isOffsetShapeIdx(selItem, snap.shapeIdx)) {
        // If the snapped shape is part of a multi-selection, drag them all together
        // (the snap point acts as the anchor instead of a single-point drag).
        if (
          multiSelectedIndices.length > 1 &&
          multiSelectedIndices.includes(snap.shapeIdx)
        ) {
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            multiIndices: [...multiSelectedIndices],
            multiOrigShapes: multiSelectedIndices.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedIndices = [];
          sketchDrag = {
            kind: "point",
            shapeIdx: snap.shapeIdx,
            pointKey: snap.pointKey,
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            origShape: shapes[snap.shapeIdx],
          };
        }
        renderer.domElement.style.cursor = "grabbing";
        return true;
      }
    }

    // Shape drag — hit-test Line2 objects
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null && !c.userData.isOffset,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const localAnchor = screenToSketchLocal(
          screenX,
          screenY,
          sketchMesh,
        ) || { x: 0, y: 0 };
        // If the hit shape is part of a multi-selection, drag them all together
        if (
          multiSelectedIndices.length > 1 &&
          multiSelectedIndices.includes(shapeIdx)
        ) {
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            multiIndices: [...multiSelectedIndices],
            multiOrigShapes: multiSelectedIndices.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedIndices = [];
          sketchDrag = {
            kind: "shape",
            shapeIdx,
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            origShape: shapes[shapeIdx],
          };
        }
        renderer.domElement.style.cursor = "grabbing";
        return true;
      }
    }
    clearMultiSelectOverlays();
    multiSelectedIndices = [];
    return false;
  };

  // ── Active sketch tool: preview + click commit ────────────────────────────
  const sketchDraw = createSketchDrawHelpers(
    {
      scene,
      renderer,
      objectsRef,
      itemsRef,
      selectedIdRef,
      sketchDrawRef,
      activeSketchToolRef,
      dimHintRef,
    },
    {
      screenToSketchLocal,
      findSnap,
      showSnapIndicator,
      clearSnapIndicator,
      clearSketchPreview,
      clearHoverFills,
      makePreviewLine2,
      setSketchDrawPhase,
    },
  );
  const { updateSketchPreview, handleSketchClick } = sketchDraw;

  // ── Sketch-mode pointer dispatch (return true when handled) ───────────────
  const onSketchMouseDown = (e) => {
    if (!sketchModeRef.current || e.button !== 0) return false;
    if (activeSketchToolRef.current) {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
    controls.mouseDownX = e.clientX;
    controls.mouseDownY = e.clientY;
    if (!useStore.getState().sketchModifyMode) {
      const downX = e.clientX,
        downY = e.clientY;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const items = buildLongPressItems(downX, downY);
        if (items.length > 0) {
          sketchDrag = null;
          renderer.domElement.style.cursor = "";
          longPressMenuOpen = true;
          useStore
            .getState()
            .setSketchLongPressMenu({ x: downX, y: downY, items });
        }
      }, 500);
      const didDrag = startSketchDrag(e.clientX, e.clientY, e.shiftKey);
      if (!didDrag) {
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
        marqueeStartScreen = { x: e.clientX, y: e.clientY };
      }
    }
    return true;
  };

  const onSketchMouseMove = (e) => {
    if (!sketchModeRef.current) return false;
    if (activeSketchToolRef.current) {
      clearAllSketchHover();
      updateSketchPreview(e.clientX, e.clientY, e.shiftKey);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
    if (longPressTimer) {
      const ddx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const ddy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(ddx, ddy) >= 5) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
    if (sketchDrag) {
      applySketchDragMove(e.clientX, e.clientY, e.shiftKey);
    } else {
      const modifyMode = useStore.getState().sketchModifyMode;
      if (modifyMode) {
        clearAllSketchHover();
        showModifyPreview(e.clientX, e.clientY, modifyMode);
      } else if (marqueeStartScreen) {
        clearAllSketchHover();
        clearModifyPreview();
        const dx = e.clientX - marqueeStartScreen.x;
        const dy = e.clientY - marqueeStartScreen.y;
        if (Math.hypot(dx, dy) > 5) {
          marqueeActive = true;
          updateMarquee(e.clientX, e.clientY);
        }
      } else {
        clearModifyPreview();
        updateHoverFills(e.clientX, e.clientY);
        updateSketchHover(e.clientX, e.clientY);
      }
    }
    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
    return true;
  };

  const onSketchMouseUp = (e) => {
    if (!sketchModeRef.current || e.button !== 0) return false;
    if (activeSketchToolRef.current) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleSketchClick(e.clientX, e.clientY, e.shiftKey);
      return true;
    }
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (longPressMenuOpen) {
      longPressMenuOpen = false;
      useStore.getState().setSketchLongPressMenu(null);
      sketchDrag = null;
      renderer.domElement.style.cursor = "";
      marqueeStartScreen = null;
      marqueeActive = false;
      return true;
    }
    if (marqueeActive) {
      marqueeActive = false;
      marqueeStartScreen = null;
      clearMarqueeRect();
      renderer.domElement.style.cursor = "";
      return true;
    }
    marqueeStartScreen = null;
    const constraintMode = useStore.getState().sketchConstraintMode;
    const doClick = (sx, sy, shift = false) => {
      const modifyMode = useStore.getState().sketchModifyMode;
      if (modifyMode) {
        applyModify(sx, sy, modifyMode);
        return;
      }
      if (constraintMode === "coincident") {
        handleCoincidentClick(sx, sy);
        return;
      }
      if (constraintMode === "distance") {
        handleDistanceConstraintClick(sx, sy);
        return;
      }

      const now = Date.now();
      const isDblClick =
        now - lastClickTime < 300 &&
        Math.hypot(sx - lastClickX, sy - lastClickY) < 8;
      lastClickTime = now;
      lastClickX = sx;
      lastClickY = sy;

      if (isDblClick) {
        // Check if double-clicking on a distance constraint icon to edit its value
        const dblG = sketchShapesGroupRef?.current;
        const dblSel = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const dblMesh = dblSel ? objectsRef.current[dblSel.id] : null;
        if (dblG && dblMesh) {
          const rect2 = renderer.domElement.getBoundingClientRect();
          for (const cObj of dblG.children) {
            if (
              !cObj.userData.isConstraint ||
              (cObj.userData.constraintType !== "distance" &&
                cObj.userData.constraintType !== "offset")
            )
              continue;
            const lp = cObj.userData.constraintIconLocalPos;
            if (!lp) continue;
            const wp = new THREE.Vector3(lp.x, lp.y, 0.005)
              .applyQuaternion(dblMesh.quaternion)
              .add(dblMesh.position);
            const ndc2 = wp.clone().project(cameraRef.current);
            const cpx = ((ndc2.x + 1) / 2) * rect2.width + rect2.left;
            const cpy = ((-ndc2.y + 1) / 2) * rect2.height + rect2.top;
            if (Math.hypot(sx - cpx, sy - cpy) < 18) {
              const c = (dblSel.constraints || [])[cObj.userData.constraintIdx];
              if (c && c.type === "distance") {
                useStore.getState().setSketchDistanceInput({
                  shapeAIdx: c.shapeAIdx,
                  pointA: c.pointA,
                  shapeBIdx: c.shapeBIdx,
                  pointB: c.pointB,
                  // Preserve the raw distance (string formula or legacy
                  // number) so the input shows what the user typed.
                  defaultDistance: c.distance,
                  constraintIdx: cObj.userData.constraintIdx,
                });
                useStore.getState().setSketchConstraintMode("distance");
              } else if (c && c.type === "offset") {
                useStore.getState().setSketchDistanceInput({
                  offsetConstraintIdx: cObj.userData.constraintIdx,
                  offsetGroup: c.offsetGroup,
                  defaultDistance: c.distance,
                });
                useStore.getState().setSketchConstraintMode("distance");
              }
              return;
            }
          }
        }

        // Otherwise select all lines reachable via coincident constraints
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
        const selItem = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
        const sketchGroup = sketchShapesGroupRef?.current;
        if (selItem && sketchMesh && sketchGroup) {
          const lineObjs = sketchGroup.children.filter(
            (c) => c.userData.shapeIdx != null && !c.userData.isOffset,
          );
          const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
          if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
            const connected = collectConnectedShapes(
              hits[0].object.userData.shapeIdx,
              selItem.shapes || [],
              selItem.constraints || [],
            );
            multiSelectedIndices = connected;
            showMultiSelectOverlays(connected);
          }
        }
        return;
      }

      if (shift) {
        // Shift+click: toggle the hit line in/out of the multi-selection
        const sketchGroup = sketchShapesGroupRef?.current;
        if (!sketchGroup) return;
        const lineObjs = sketchGroup.children.filter(
          (c) => c.userData.shapeIdx != null && !c.userData.isOffset,
        );
        const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
        if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
          const hitIdx = hits[0].object.userData.shapeIdx;
          multiSelectedIndices = multiSelectedIndices.includes(hitIdx)
            ? multiSelectedIndices.filter((i) => i !== hitIdx)
            : [...multiSelectedIndices, hitIdx];
          showMultiSelectOverlays(multiSelectedIndices);
        }
        return;
      }

      // Check for constraint icon click before doing normal element select
      {
        const cg = sketchShapesGroupRef?.current;
        const cSelItem = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const cMesh = cSelItem ? objectsRef.current[cSelItem.id] : null;
        if (cg && cMesh) {
          const cRect = renderer.domElement.getBoundingClientRect();
          for (const cObj of cg.children) {
            if (!cObj.userData.isConstraint) continue;
            const lp = cObj.userData.constraintIconLocalPos;
            if (!lp) continue;
            const wp = new THREE.Vector3(lp.x, lp.y, 0.005)
              .applyQuaternion(cMesh.quaternion)
              .add(cMesh.position);
            const ndc = wp.clone().project(cameraRef.current);
            const cpx = ((ndc.x + 1) / 2) * cRect.width + cRect.left;
            const cpy = ((-ndc.y + 1) / 2) * cRect.height + cRect.top;
            if (Math.hypot(sx - cpx, sy - cpy) < 14) {
              clearMultiSelectOverlays();
              multiSelectedIndices = [];
              selectConstraint(cObj.userData.constraintIdx);
              return;
            }
          }
        }
      }
      clearConstraintSelection();

      // Normal click: clear multi-selection and do single-element select
      clearMultiSelectOverlays();
      multiSelectedIndices = [];
      trySelectSketchElement(sx, sy);
    };
    if (sketchDrag) {
      // Single drags stamp pendingShape; multi / rotate drags stamp
      // pendingShapes.  Either means a real drag happened (vs a bare click),
      // so it must commit — otherwise doClick() runs and clears the selection.
      const wasDrag = !!sketchDrag.pendingShape || !!sketchDrag.pendingShapes;
      if (wasDrag) commitSketchDrag();
      sketchDrag = null;
      clearDragIndicator();
      renderer.domElement.style.cursor = "";
      if (!wasDrag) doClick(e.clientX, e.clientY, e.shiftKey);
      return true;
    }
    const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
    const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
    if (Math.hypot(dx, dy) < 5) doClick(e.clientX, e.clientY, e.shiftKey);
    return true;
  };

  const cancelSketchDraw = () => {
    clearSketchPreview();
    clearSnapIndicator();
    clearHoverFills();
    sketchDrawRef.current = null;
    setSketchDrawPhase("first");
    if (dimHintRef.current) dimHintRef.current.style.display = "none";
    if (sketchDrag) {
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchDrag.kind === "multi") {
        // Revert all shapes in the multi-drag back to their originals
        if (sketchGroup) {
          sketchDrag.multiIndices.forEach((idx, i) => {
            const lineObj = sketchGroup.children.find(
              (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
            );
            if (lineObj)
              updateSketchLineGeo(
                lineObj,
                sketchDrag.multiOrigShapes[i],
                sketchDrag.sketchMesh,
              );
          });
        }
      } else if (sketchGroup && sketchDrag.origShape) {
        const lineObj = sketchGroup.children.find(
          (c) =>
            c.userData.shapeIdx === sketchDrag.shapeIdx &&
            c.geometry?.setPositions,
        );
        if (lineObj)
          updateSketchLineGeo(
            lineObj,
            sketchDrag.origShape,
            sketchDrag.sketchMesh,
          );
      }
      sketchDrag = null;
      clearDragIndicator();
      renderer.domElement.style.cursor = "";
    }
  };
  const onKeyDown = (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable)
      return;

    // Debug export: copy the whole active sketch (shapes + constraints) to the
    // clipboard as JSON, for sharing a reproducer.  Cmd/Ctrl+Shift+C.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.shiftKey &&
      e.key.toLowerCase() === "c"
    ) {
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      e.preventDefault();
      const dump = JSON.stringify(
        {
          shapes: selItem.shapes || [],
          constraints: selItem.constraints || [],
        },
        null,
        2,
      );
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(dump);
      console.warn("[SKETCH DUMP]\n" + dump);
      return;
    }

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key === "c"
    ) {
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      const shapes = selItem.shapes || [];
      const constraints = selItem.constraints || [];
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (indices.length === 0) return;
      e.preventDefault();
      const indexSet = new Set(indices);
      const idxMap = new Map(indices.map((origIdx, i) => [origIdx, i]));
      sketchClipboard = {
        shapes: indices.map((i) => shapes[i]).filter(Boolean),
        constraints: constraints
          .filter(
            (c) =>
              c.type === "coincident" &&
              indexSet.has(c.shapeAIdx) &&
              indexSet.has(c.shapeBIdx),
          )
          .map((c) => ({
            ...c,
            shapeAIdx: idxMap.get(c.shapeAIdx),
            shapeBIdx: idxMap.get(c.shapeBIdx),
          })),
      };
      return;
    }

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.key === "v"
    ) {
      if (!sketchClipboard) return;
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      e.preventDefault();
      const baseIdx = (selItem.shapes || []).length;
      const PASTE_OFFSET = 0.5;
      const newShapes = sketchClipboard.shapes
        .map((s) => translateShape(s, PASTE_OFFSET, PASTE_OFFSET))
        .filter(Boolean);
      const newConstraints = sketchClipboard.constraints.map((c) => ({
        ...c,
        shapeAIdx: c.shapeAIdx + baseIdx,
        shapeBIdx: c.shapeBIdx + baseIdx,
      }));
      useStore
        .getState()
        .addSketchShapes(selectedIdRef.current, newShapes, newConstraints);
      return;
    }

    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      sketchModeRef.current
    ) {
      const selConstraintIdx = getSelectedConstraintIdx();
      if (selConstraintIdx !== null) {
        e.preventDefault();
        useStore
          .getState()
          .deleteSketchConstraint(selectedIdRef.current, selConstraintIdx);
        clearConstraintSelection();
        return;
      }
      const sel = useStore.getState().selectedSketchElement;
      const toDelete =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : null;
      if (toDelete?.length > 0) {
        e.preventDefault();
        useStore.getState().deleteSketchShapes(selectedIdRef.current, toDelete);
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
        clearSketchSelection();
      }
      return;
    }

    if (e.key === "Escape") {
      if (longPressMenuOpen) {
        longPressMenuOpen = false;
        useStore.getState().setSketchLongPressMenu(null);
        return;
      }
      if (getSelectedConstraintIdx() !== null) {
        clearConstraintSelection();
        return;
      }
      if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
        // Esc from the start-pick sub-mode backs out to depth (keeping the
        // captured profiles + depth) rather than cancelling the whole extrude.
        if (extrudeSelectModeRef.current === "start") {
          clearStartHighlight();
          useStore.getState().setExtrudeSelectMode("depth");
          return;
        }
        cancelExtrude();
        return;
      }
      if (useStore.getState().chamferSelectMode) {
        cameraControlsRef.current?.clearChamferPreview?.();
        useStore.getState().setChamferSelectMode(null);
        useStore.getState().clearSelectedSubGeometry();
        useStore.getState().setChamferRetargetTarget(null);
        return;
      }
      if (sketchPlacementModeRef.current) {
        useStore.getState().setSketchPlacementMode(false);
        return;
      }
      if (sketchModeRef.current) {
        const store = useStore.getState();
        if (store.sketchModifyMode) {
          store.setSketchModifyMode(null);
          clearModifyPreview();
          return;
        }
        if (store.sketchConstraintMode || store.sketchDistanceInput) {
          store.setSketchConstraintMode(null);
          store.setSketchConstraintFirstPoint(null);
          store.setSketchDistanceInput(null);
          clearCoincidentFirstOverlay();
          return;
        }
        if (sketchDrawRef.current) {
          cancelSketchDraw();
        } else {
          useStore.getState().setActiveSketchTool(null);
          clearSketchSelection();
          clearMarqueeRect();
          marqueeStartScreen = null;
          marqueeActive = false;
        }
        return;
      }
    }

    if (sketchModeRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const store = useStore.getState();

      // D toggles the distance-dimension constraint tool.
      if (key === "d") {
        e.preventDefault();
        const isActive = store.sketchConstraintMode === "distance";
        store.setSketchConstraintMode(isActive ? null : "distance");
        store.setSketchConstraintFirstPoint(null);
        store.setSketchDistanceInput(null);
        clearCoincidentFirstOverlay();
        return;
      }
      // I toggles dashed on the selected line(s); O offsets them.  Both are
      // no-ops without a line selection, mirroring the disabled toolbar
      // buttons.
      if (key === "i") {
        e.preventDefault();
        const indices = selectedSketchLineIndices();
        if (indices.length > 0)
          store.toggleSketchShapesDashed(selectedIdRef.current, indices);
        return;
      }
      if (key === "o") {
        e.preventDefault();
        offsetSelectedSketchGeometry(
          selectedIdRef.current,
          selectedSketchLineIndices(),
          e.shiftKey,
        );
        return;
      }

      const toolMap = {
        l: "line",
        r: "rect",
        c: "circle",
        e: "ellipse",
        a: "arc",
        b: "bezier",
      };
      const tool = toolMap[key];
      if (tool) {
        e.preventDefault();
        if (sketchDrawRef.current) cancelSketchDraw();
        const current = store.activeSketchTool;
        store.setActiveSketchTool(current === tool ? null : tool);
      }
    }
  };

  // Clears the lingering sketch overlays when the pointer moves in 3D view.
  const clearSketchVisualsFor3D = () => {
    clearAllSketchHover();
    clearSketchSelectionOverlay();
    clearCoincidentFirstOverlay();
  };

  return {
    onSketchMouseDown,
    onSketchMouseMove,
    onSketchMouseUp,
    onKeyDown,
    clearSketchVisualsFor3D,
    refreshSketchSelectionOverlay,
    unsubItems,
  };
}
