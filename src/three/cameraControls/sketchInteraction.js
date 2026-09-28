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
import { effectiveSketchSelTypes } from "../../store/selectionMode.js";
import { getShapeLength, polyArea } from "../sceneObjects.js";
import { SKETCH_HOVER_POINT_LINE_COLOR } from "../theme.js";
import { DEFAULT_FONT_ID as TEXT_DEFAULT_FONT_ID } from "../sketchText.js";
import { createSketchSelectionOverlays } from "./sketchSelectionOverlays.js";
import { createSketchModifyHelpers } from "./sketchModify.js";
import { createSketchMirrorHelpers } from "./sketchMirrorTool.js";
import { createSketchCircularPatternHelpers } from "./sketchCircularPatternTool.js";
import { createSketchRectangularPatternHelpers } from "./sketchRectangularPatternTool.js";
import { createSketchCentreHelpers } from "./sketchCentreTool.js";
import { createSketchCogHelpers } from "./sketchCogTool.js";
import { MIRRORABLE_TYPES } from "../sketchMirror.js";
import { CIRCULAR_PATTERNABLE_TYPES } from "../sketchCircularPattern.js";
import { RECTANGULAR_PATTERNABLE_TYPES } from "../sketchRectangularPattern.js";
import { createSketchConstraintHandlers } from "./sketchConstraintHandlers.js";
import { createSketchDrawHelpers } from "./sketchDraw.js";
import {
  createSketchDragLifecycle,
  isOffsetShapeIdx,
  isMirrorShapeIdx,
  isCircularPatternShapeIdx,
  isRectangularPatternShapeIdx,
  isCornerBridgeIdx,
  groupMembersOf,
} from "./sketchDragLifecycle.js";
import { createSketchKeyboardHandler } from "./sketchKeyboard.js";
import { createSketchSvgPlacement } from "./sketchSvgPlacement.js";
import { createSketchTrimTool } from "./sketchTrimTool.js";
import { createSketchMarquee } from "./sketchMarquee.js";
import { createSketchClickHandler } from "./sketchClickHandler.js";

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

  // ── SVG import placement ──────────────────────────────────────────────────
  const { svgDragRef, updateSvgPreview } = createSketchSvgPlacement({
    scene,
    renderer,
    objectsRef,
    controls,
  });

  // Drag state for placing a reference underlay image.  Unlike the SVG import
  // there's no preview group to rebuild — useSceneSync redraws the plane
  // straight from the live store values.
  const underlayDragRef = { current: null };

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
    // While applying a constraint / dimension, the enclosed-region hover
    // highlight is noise — the user is picking edges/points, not regions.
    const st = useStore.getState();
    if (st.sketchConstraintMode || st.sketchDistanceInput) {
      clearHoverFills();
      return;
    }
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
  const multiSelectedRef = { current: [] };
  const marqueeStartRef = { current: null };
  const marqueeActiveRef = { current: false };
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let longPressTimer = null;
  const longPressMenuRef = { current: false };

  // ── Selection / coincident-first / multi-select / drag overlay meshes ─────
  const {
    setCoincidentFirstOverlay,
    refreshSketchSelectionOverlay,
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

  // After an external shapes change (e.g. undoing a move) the selection overlays
  // linger at the old positions until the user reselects — snap them back to the
  // committed geometry.  Driven by useSceneSync on every items change.
  controls.refreshSketchSelectionOverlays = () => {
    if (!hasMultiSelectOverlays() && !hasSketchSelectionOverlay()) return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    updateSelectionForDrag(selItem.shapes || [], sketchMesh, true);
  };

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

  const {
    clearMarqueeRect,
    drawProjectMarquee,
    updateMarquee,
    marqueeBaseRef,
  } = createSketchMarquee(
    {
      scene,
      itemsRef,
      selectedIdRef,
      objectsRef,
      marqueeStartRef,
      multiSelectedRef,
    },
    { screenToSketchLocal, showMultiSelectOverlays },
  );

  const clearSketchSelection = () => {
    clearSketchSelectionOverlay();
    useStore.getState().setSelectedSketchElement(null);
    clearMultiSelectOverlays();
    multiSelectedRef.current = [];
  };

  // ── Mirror tool ────────────────────────────────────────────────────────────
  const sketchMirror = createSketchMirrorHelpers({
    scene,
    objectsRef,
    itemsRef,
    selectedIdRef,
    sketchShapesGroupRef,
    renderer,
  });
  const { clearMirrorPreview, updateMirrorPreview, handleMirrorClick } =
    sketchMirror;

  // ── Circular Pattern tool ──────────────────────────────────────────────────
  const sketchCircularPattern = createSketchCircularPatternHelpers({
    scene,
    objectsRef,
    itemsRef,
    selectedIdRef,
    sketchShapesGroupRef,
    cameraRef,
    renderer,
  });
  const {
    clearCircularPatternPreview,
    updateCircularPatternPreview,
    handleCircularPatternClick,
  } = sketchCircularPattern;

  // ── Rectangular Pattern tool ──────────────────────────────────────────────
  const sketchRectangularPattern = createSketchRectangularPatternHelpers({
    scene,
    objectsRef,
    itemsRef,
    selectedIdRef,
    sketchShapesGroupRef,
    renderer,
  });
  const {
    clearRectangularPatternPreview,
    updateRectangularPatternPreview,
    handleRectangularPatternClick,
  } = sketchRectangularPattern;

  // ── Centre tool ────────────────────────────────────────────────────────────
  const {
    clearCentrePreview,
    updateCentrePreview,
    centreHoverAt,
    handleCentreClick,
    resetCentreHover,
  } = createSketchCentreHelpers({
    scene,
    objectsRef,
    itemsRef,
    selectedIdRef,
    sketchShapesGroupRef,
    renderer,
  });
  const unsubCentre = useStore.subscribe((state, prev) => {
    if (
      state.activeSketchTool === prev.activeSketchTool &&
      state.sketchCentreState === prev.sketchCentreState &&
      state.items === prev.items
    )
      return;
    if (state.activeSketchTool === "centre") updateCentrePreview();
    else {
      resetCentreHover();
      clearCentrePreview();
    }
  });

  // ── Cog tool ───────────────────────────────────────────────────────────────
  const {
    clearCogPreview,
    updateCogPreview,
    cogHoverAt,
    handleCogClick,
    resetCogHover,
  } = createSketchCogHelpers({
    scene,
    objectsRef,
    itemsRef,
    selectedIdRef,
    renderer,
  });
  const unsubCog = useStore.subscribe((state, prev) => {
    if (
      state.activeSketchTool === prev.activeSketchTool &&
      state.sketchCogState === prev.sketchCogState &&
      state.items === prev.items
    )
      return;
    if (state.activeSketchTool === "cog") updateCogPreview();
    else {
      resetCogHover();
      clearCogPreview();
    }
  });

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
        multiSelectedRef.current = [];
      }
      clearConstraintHoverHighlight();
      clearConstraintSelection();
    },
  );

  // Rebuild / clear the mirror preview whenever the mirror tool's picked line
  // or shape selection changes, the tool is cancelled, or the underlying
  // geometry moves (drag of the original or mirror line).
  const unsubMirror = useStore.subscribe((state, prev) => {
    if (
      state.activeSketchTool === prev.activeSketchTool &&
      state.sketchMirrorState === prev.sketchMirrorState &&
      state.items === prev.items
    )
      return;
    if (state.activeSketchTool === "mirror") updateMirrorPreview();
    else clearMirrorPreview();
  });

  // Rebuild / clear the circular-pattern preview whenever the tool's picked
  // centre, shape selection, or count changes, the tool is cancelled, or the
  // underlying geometry moves (drag of the original or the centre point).
  const unsubCircularPattern = useStore.subscribe((state, prev) => {
    if (
      state.activeSketchTool === prev.activeSketchTool &&
      state.sketchCircularPatternState === prev.sketchCircularPatternState &&
      state.items === prev.items
    )
      return;
    if (state.activeSketchTool === "circularPattern")
      updateCircularPatternPreview();
    else clearCircularPatternPreview();
  });

  // Rebuild / clear the rectangular-pattern preview whenever the tool's shape
  // selection or counts/offsets change, the tool is cancelled, or the
  // underlying geometry moves (drag of the original).
  const unsubRectangularPattern = useStore.subscribe((state, prev) => {
    if (
      state.activeSketchTool === prev.activeSketchTool &&
      state.sketchRectangularPatternState ===
        prev.sketchRectangularPatternState &&
      state.items === prev.items
    )
      return;
    if (state.activeSketchTool === "rectangularPattern")
      updateRectangularPatternPreview();
    else clearRectangularPatternPreview();
  });

  const trySelectSketchElement = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    // The top-right selection-type widget gates which kinds a click resolves to.
    const { eff } = effectiveSketchSelTypes(useStore.getState());
    // Point hit first (ignore offset-copy points — they're inert).
    const snap = eff.point
      ? findSnap(screenX, screenY, shapes, sketchMesh)
      : null;
    if (
      snap &&
      !isOffsetShapeIdx(selItem, snap.shapeIdx) &&
      !isMirrorShapeIdx(selItem, snap.shapeIdx) &&
      !isCircularPatternShapeIdx(selItem, snap.shapeIdx) &&
      !isRectangularPatternShapeIdx(selItem, snap.shapeIdx) &&
      !isCornerBridgeIdx(selItem, snap.shapeIdx)
    ) {
      // Measure tool: accumulate the snapped point as a pick (highlighted by a
      // marker, and measured between picks) rather than a normal point select.
      if (useStore.getState().measureTool) {
        const w = new THREE.Vector3(snap.x, snap.y, 0)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const at = [w.x, w.y, w.z];
        useStore
          .getState()
          .addMeasurePick({ kind: "point", pick: "point", p: at, at });
        useStore.getState().setSelectedSketchElement(null);
        clearSketchSelectionOverlay();
        clearMultiSelectOverlays();
        multiSelectedRef.current = [];
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        return;
      }
      sketchSelectPoint(snap, sketchMesh);
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      return;
    }
    // Measure tool: a non-point click starts a fresh selection (a line for
    // length, two lines for distance), so drop any accumulated point picks.
    if (useStore.getState().measureTool)
      useStore.getState().clearMeasurePicks();
    // Line hit
    const sketchGroup = eff.line ? sketchShapesGroupRef?.current : null;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) =>
          c.userData.shapeIdx != null &&
          !c.userData.isOffset &&
          !c.userData.isMirror &&
          !c.userData.isCircularPattern &&
          !c.userData.isRectangularPattern &&
          !c.userData.isCornerBridge,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const shape = shapes[shapeIdx];
        if (shape) {
          // A grouped shape selects the whole group as a multi-selection.
          const members = groupMembersOf(shapes, shapeIdx);
          if (members.length > 1) {
            multiSelectedRef.current = members;
            showMultiSelectOverlays(members);
            useStore.getState().setSelectedSketchElement(null);
            if (dimHintRef.current) dimHintRef.current.style.display = "none";
            return;
          }
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
    // Region-fill ("shape") click: select all boundary shapes of the area.
    const localForFill = eff.shape
      ? screenToSketchLocal(screenX, screenY, sketchMesh)
      : null;
    const sketchGroup2 = eff.shape ? sketchShapesGroupRef?.current : null;
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
            multiSelectedRef.current = indices;
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
  // Trim tool: while the button is held the tool keeps trimming any line under
  // the cursor.  `trimming` gates whether pointer-move trims or just hovers;
  // the per-drag undo snapshot lives in the trim tool module (trimSnapshotRef).
  let trimming = false;
  const { tryTrimAt, trimHoverAt, trimSnapshotRef } = createSketchTrimTool(
    { renderer, itemsRef, selectedIdRef, objectsRef, sketchShapesGroupRef },
    {
      hitTestSketchLines,
      makeRay,
      screenToSketchLocal,
      clearHoverLineHighlight,
      applyHoverLineHighlight,
    },
  );

  const {
    sketchDragRef,
    updateSketchLineGeo,
    propagateConstraints,
    solveDrag,
    buildLongPressItems,
    startSketchDrag,
    applySketchDragMove,
    commitSketchDrag,
  } = createSketchDragLifecycle(
    {
      cameraRef,
      renderer,
      itemsRef,
      selectedIdRef,
      objectsRef,
      sketchShapesGroupRef,
    },
    {
      screenToSketchLocal,
      findSnap,
      hitTestSketchLines,
      clearAllSketchHover,
      clearHoverFills,
      getRotationHandle,
      refreshRotationHandle,
      clearCoincidentFirstOverlay,
      clearMultiSelectOverlays,
      showMultiSelectOverlays,
      showDragIndicator,
      updateSelectionForDrag,
      reapplyConstraintSelectionVisual,
      multiSelectedRef,
    },
  );

  // Expose propagateConstraints so Viewport can enforce constraints immediately
  // after adding or editing them (outside a drag operation).
  if (propagateConstraintsRef)
    propagateConstraintsRef.current = propagateConstraints;

  // ── Chamfer / Bevel helpers ───────────────────────────────────────────────
  const sketchModify = createSketchModifyHelpers(
    { scene, renderer, objectsRef, itemsRef, selectedIdRef },
    { findSnap },
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
      addConstraintPickLine,
    },
  );
  const {
    handleDistanceConstraintClick,
    handleCoincidentClick,
    handleMidpointClick,
  } = sketchConstraints;

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
    // SVG placement: start dragging the pending import to move it.
    const svg = useStore.getState().svgImport;
    if (svg) {
      const sketchMesh = objectsRef.current[svg.sketchId];
      const local = sketchMesh
        ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
        : null;
      svgDragRef.current = local
        ? {
            startLocal: local,
            startOffsetX: svg.offsetX,
            startOffsetY: svg.offsetY,
          }
        : null;
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      return true;
    }
    // Underlay placement: drag the pending image to position it under the
    // geometry being traced.  Same gesture as the SVG placement above.
    const under = useStore.getState().underlayImport;
    if (under) {
      const sketchMesh = objectsRef.current[under.sketchId];
      const local = sketchMesh
        ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
        : null;
      underlayDragRef.current = local
        ? {
            startLocal: local,
            startOffsetX: under.offsetX ?? 0,
            startOffsetY: under.offsetY ?? 0,
          }
        : null;
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      return true;
    }
    // The mirror tool is a pick-mode, not a drawing tool: clicks are handled
    // on mouse-up by handleMirrorClick, not the draw helpers.
    if (
      activeSketchToolRef.current === "mirror" ||
      activeSketchToolRef.current === "circularPattern" ||
      activeSketchToolRef.current === "rectangularPattern" ||
      activeSketchToolRef.current === "centre" ||
      activeSketchToolRef.current === "cog"
    ) {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      return true;
    }
    // Project: arm a marquee so a drag box-selects edges, a click projects all
    // connected edges of the body under the cursor.
    if (activeSketchToolRef.current === "project") {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      marqueeStartRef.current = { x: e.clientX, y: e.clientY };
      return true;
    }
    // Trim: start trimming immediately and keep trimming on drag (no marquee).
    if (activeSketchToolRef.current === "trim") {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      trimming = true;
      trimSnapshotRef.current = false;
      tryTrimAt(e.clientX, e.clientY);
      return true;
    }
    if (activeSketchToolRef.current) {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
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
          sketchDragRef.current = null;
          renderer.domElement.style.cursor = "";
          longPressMenuRef.current = true;
          // Cancel the pending marquee armed on mouse-down — a long press opens
          // the element list, it must not also start a selection box if the
          // cursor drifts while held.
          marqueeStartRef.current = null;
          marqueeActiveRef.current = false;
          clearMarqueeRect();
          useStore
            .getState()
            .setSketchLongPressMenu({ x: downX, y: downY, items });
        }
      }, 500);
      const didDrag = startSketchDrag(e.clientX, e.clientY, e.shiftKey);
      if (!didDrag) {
        // Shift keeps the current selection so a marquee/click adds to it.
        if (!e.shiftKey) {
          clearMultiSelectOverlays();
          multiSelectedRef.current = [];
        }
        marqueeBaseRef.current = e.shiftKey
          ? [...multiSelectedRef.current]
          : [];
        marqueeStartRef.current = { x: e.clientX, y: e.clientY };
      }
    }
    return true;
  };

  // Hover feedback while a mirror/circular/rectangular pattern tool is active:
  // highlight the geometry under the cursor that this tool/phase could actually
  // select (the mirror axis line, a pattern centre point, or a patternable
  // shape), so it's clear what a click would pick.
  const updateSketchToolHover = (screenX, screenY, tool) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    const group = sketchShapesGroupRef?.current;
    if (!selItem || !sketchMesh || !group) {
      clearHoverLineHighlight();
      clearHoverPointIndicator();
      renderer.domElement.style.cursor = "";
      return;
    }
    const shapes = selItem.shapes || [];
    const store = useStore.getState();
    const mirrorLineIdx =
      tool === "mirror" ? store.sketchMirrorState?.lineIdx : null;

    // Circular pattern's first phase picks a centre snap point — show the ring.
    if (
      tool === "circularPattern" &&
      store.sketchCircularPatternState?.centerShapeIdx == null
    ) {
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      clearHoverLineHighlight();
      if (snap) {
        showHoverPointIndicator(snap, sketchMesh);
        renderer.domElement.style.cursor = "grab";
      } else {
        clearHoverPointIndicator();
        renderer.domElement.style.cursor = "";
      }
      return;
    }
    clearHoverPointIndicator();

    // Line/shape pick: hit-test the original (non-copy) shape lines.
    const lineObjs = group.children.filter(
      (c) =>
        c.userData.shapeIdx != null &&
        !c.userData.isOffset &&
        !c.userData.isMirror &&
        !c.userData.isCircularPattern &&
        !c.userData.isRectangularPattern &&
        !c.userData.isCornerBridge,
    );
    const hits = hitTestSketchLines(makeRay(screenX, screenY), lineObjs);
    const hitIdx = hits[0]?.object?.userData?.shapeIdx;
    if (hitIdx != null) {
      const type = shapes[hitIdx]?.type;
      const selectable =
        tool === "mirror"
          ? mirrorLineIdx == null
            ? type === "line" // phase 1: any line can be the mirror axis
            : hitIdx !== mirrorLineIdx && MIRRORABLE_TYPES.includes(type)
          : tool === "circularPattern"
            ? CIRCULAR_PATTERNABLE_TYPES.includes(type)
            : RECTANGULAR_PATTERNABLE_TYPES.includes(type);
      if (selectable) {
        applyHoverLineHighlight(hits[0].object);
        renderer.domElement.style.cursor = "pointer";
        return;
      }
    }
    clearHoverLineHighlight();
    renderer.domElement.style.cursor = "";
  };

  const onSketchMouseMove = (e) => {
    if (!sketchModeRef.current) return false;
    // SVG placement: drag moves the pending import's offset.
    const svgMove = useStore.getState().svgImport;
    if (svgMove) {
      if (svgDragRef.current) {
        const sketchMesh = objectsRef.current[svgMove.sketchId];
        const cur = sketchMesh
          ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
          : null;
        if (cur) {
          useStore.getState().updateSvgImport({
            offsetX:
              svgDragRef.current.startOffsetX +
              (cur.x - svgDragRef.current.startLocal.x),
            offsetY:
              svgDragRef.current.startOffsetY +
              (cur.y - svgDragRef.current.startLocal.y),
          });
          updateSvgPreview();
        }
      }
      renderer.domElement.style.cursor = svgDragRef.current
        ? "grabbing"
        : "grab";
      return true;
    }
    // Underlay placement: drag moves the pending image's offset.  The scene
    // sync effect redraws the plane from the live store values, so there's no
    // preview call to make here.
    const underMove = useStore.getState().underlayImport;
    if (underMove) {
      if (underlayDragRef.current) {
        const sketchMesh = objectsRef.current[underMove.sketchId];
        const cur = sketchMesh
          ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
          : null;
        if (cur) {
          useStore.getState().updateUnderlayImport({
            offsetX:
              underlayDragRef.current.startOffsetX +
              (cur.x - underlayDragRef.current.startLocal.x),
            offsetY:
              underlayDragRef.current.startOffsetY +
              (cur.y - underlayDragRef.current.startLocal.y),
          });
        }
      }
      renderer.domElement.style.cursor = underlayDragRef.current
        ? "grabbing"
        : "grab";
      return true;
    }
    // While the long-press element list is open, ignore canvas motion — no
    // marquee, no hover repaint underneath it.
    if (longPressMenuRef.current) return true;
    if (activeSketchToolRef.current === "project") {
      if (marqueeStartRef.current) {
        const dx = e.clientX - marqueeStartRef.current.x;
        const dy = e.clientY - marqueeStartRef.current.y;
        if (Math.hypot(dx, dy) > 5) {
          marqueeActiveRef.current = true;
          controls.clearProjectHover?.();
          drawProjectMarquee(e.clientX, e.clientY);
          return true;
        }
      }
      // Not dragging a box → highlight the edges under the cursor.
      controls.projectHoverAt?.(e.clientX, e.clientY);
      return true;
    }
    if (
      activeSketchToolRef.current === "mirror" ||
      activeSketchToolRef.current === "circularPattern" ||
      activeSketchToolRef.current === "rectangularPattern"
    ) {
      updateSketchToolHover(e.clientX, e.clientY, activeSketchToolRef.current);
      return true;
    }
    if (activeSketchToolRef.current === "cog") {
      clearAllSketchHover();
      cogHoverAt(e.clientX, e.clientY, findSnap, screenToSketchLocal);
      return true;
    }
    if (activeSketchToolRef.current === "centre") {
      clearAllSketchHover();
      centreHoverAt(
        e.clientX,
        e.clientY,
        hitTestSketchLines,
        makeRay,
        findSnap,
      );
      return true;
    }
    if (activeSketchToolRef.current === "trim") {
      clearAllSketchHover();
      if (trimming) tryTrimAt(e.clientX, e.clientY);
      else trimHoverAt(e.clientX, e.clientY);
      return true;
    }
    if (activeSketchToolRef.current) {
      clearAllSketchHover();
      updateSketchPreview(e.clientX, e.clientY, e.shiftKey);
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
    if (sketchDragRef.current) {
      applySketchDragMove(e.clientX, e.clientY, e.shiftKey);
    } else {
      const modifyMode = useStore.getState().sketchModifyMode;
      if (modifyMode) {
        clearAllSketchHover();
        showModifyPreview(e.clientX, e.clientY, modifyMode);
      } else if (marqueeStartRef.current) {
        clearAllSketchHover();
        clearModifyPreview();
        const dx = e.clientX - marqueeStartRef.current.x;
        const dy = e.clientY - marqueeStartRef.current.y;
        if (Math.hypot(dx, dy) > 5) {
          marqueeActiveRef.current = true;
          updateMarquee(e.clientX, e.clientY);
        }
      } else {
        clearModifyPreview();
        updateHoverFills(e.clientX, e.clientY);
        updateSketchHover(e.clientX, e.clientY);
      }
    }
    return true;
  };

  // Closest point on segment AB to P (all in sketch-local coords).
  const closestOnSegment = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + t * dx, y: ay + t * dy };
  };

  // "Point" tool: a single click drops a standalone point.  Clicking on a line
  // snaps the point onto it and adds an onLine constraint so the point rides
  // the line through later edits.
  const handlePointClick = (clientX, clientY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    let local = screenToSketchLocal(clientX, clientY, sketchMesh);
    if (!local) return;
    const shapes = selItem.shapes || [];

    const sketchGroup = sketchShapesGroupRef?.current;
    const lineObjs = sketchGroup
      ? sketchGroup.children.filter(
          (c) =>
            c.userData.shapeIdx != null &&
            !c.userData.isOffset &&
            !c.userData.isMirror &&
            !c.userData.isCircularPattern &&
            !c.userData.isRectangularPattern &&
            !c.userData.isCornerBridge,
        )
      : [];
    const hits = hitTestSketchLines(makeRay(clientX, clientY), lineObjs);
    const constraints = [];
    if (hits.length > 0) {
      const lineIdx = hits[0].object.userData.shapeIdx;
      const ln = shapes[lineIdx];
      if (ln?.type === "line") {
        // Snap exactly onto the segment so the onLine residual starts at zero.
        local = closestOnSegment(local.x, local.y, ln.x1, ln.y1, ln.x2, ln.y2);
        constraints.push({
          type: "onLine",
          pointShapeIdx: shapes.length, // index of the point we're appending
          pointKey: "p",
          lineShapeIdx: lineIdx,
        });
      }
    }
    useStore
      .getState()
      .addSketchShape(
        selItem.id,
        { type: "point", x: local.x, y: local.y },
        constraints,
      );
  };

  const { doClick } = createSketchClickHandler(
    {
      renderer,
      cameraRef,
      itemsRef,
      selectedIdRef,
      objectsRef,
      sketchShapesGroupRef,
      multiSelectedRef,
    },
    {
      makeRay,
      hitTestSketchLines,
      findSnap,
      applyModify,
      handleCoincidentClick,
      handleDistanceConstraintClick,
      handleMidpointClick,
      clearMultiSelectOverlays,
      showMultiSelectOverlays,
      selectConstraint,
      clearConstraintSelection,
      trySelectSketchElement,
    },
  );

  const onSketchMouseUp = (e) => {
    if (!sketchModeRef.current || e.button !== 0) return false;
    if (useStore.getState().svgImport) {
      svgDragRef.current = null;
      renderer.domElement.style.cursor = "grab";
      return true;
    }
    if (useStore.getState().underlayImport) {
      underlayDragRef.current = null;
      renderer.domElement.style.cursor = "grab";
      return true;
    }
    if (activeSketchToolRef.current === "point") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) handlePointClick(e.clientX, e.clientY);
      return true;
    }
    if (activeSketchToolRef.current === "project") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) >= 5 && marqueeStartRef.current) {
        controls.projectEdgesInBox({
          x1: marqueeStartRef.current.x,
          y1: marqueeStartRef.current.y,
          x2: e.clientX,
          y2: e.clientY,
        });
      } else {
        controls.projectEdgeAt(e.clientX, e.clientY);
      }
      clearMarqueeRect();
      controls.clearProjectHover?.();
      marqueeActiveRef.current = false;
      marqueeStartRef.current = null;
      return true;
    }
    if (activeSketchToolRef.current === "mirror") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleMirrorClick(e.clientX, e.clientY, hitTestSketchLines, makeRay);
      return true;
    }
    if (activeSketchToolRef.current === "cog") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleCogClick(e.clientX, e.clientY, findSnap, screenToSketchLocal);
      return true;
    }
    if (activeSketchToolRef.current === "centre") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleCentreClick(
          e.clientX,
          e.clientY,
          hitTestSketchLines,
          makeRay,
          findSnap,
        );
      return true;
    }
    if (activeSketchToolRef.current === "circularPattern") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleCircularPatternClick(
          e.clientX,
          e.clientY,
          hitTestSketchLines,
          makeRay,
        );
      return true;
    }
    if (activeSketchToolRef.current === "rectangularPattern") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleRectangularPatternClick(
          e.clientX,
          e.clientY,
          hitTestSketchLines,
          makeRay,
        );
      return true;
    }
    // Text tool: a click sets the anchor and opens the Text dialog (with a live
    // preview) rather than drawing directly.
    if (activeSketchToolRef.current === "text") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        const selItem = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
        const local = sketchMesh
          ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
          : null;
        if (local) {
          const store = useStore.getState();
          store.setActiveSketchTool(null);
          store.setTextDraft({
            x: local.x,
            y: local.y,
            text: "Text",
            heightMm: 10,
            font: TEXT_DEFAULT_FONT_ID,
            editIdx: null,
          });
        }
      }
      return true;
    }
    if (activeSketchToolRef.current === "trim") {
      trimming = false;
      trimSnapshotRef.current = false;
      return true;
    }
    if (activeSketchToolRef.current) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleSketchClick(e.clientX, e.clientY, e.shiftKey);
      return true;
    }
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (longPressMenuRef.current) {
      longPressMenuRef.current = false;
      useStore.getState().setSketchLongPressMenu(null);
      sketchDragRef.current = null;
      renderer.domElement.style.cursor = "";
      marqueeStartRef.current = null;
      marqueeActiveRef.current = false;
      return true;
    }
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      marqueeStartRef.current = null;
      clearMarqueeRect();
      renderer.domElement.style.cursor = "";
      return true;
    }
    marqueeStartRef.current = null;
    if (sketchDragRef.current) {
      // Single drags stamp pendingShape; multi / rotate drags stamp
      // pendingShapes.  Either means a real drag happened (vs a bare click),
      // so it must commit — otherwise doClick() runs and clears the selection.
      const wasDrag =
        !!sketchDragRef.current.pendingShape ||
        !!sketchDragRef.current.pendingShapes;
      if (wasDrag) commitSketchDrag();
      sketchDragRef.current = null;
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
    if (sketchDragRef.current) {
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchDragRef.current.kind === "multi") {
        // Revert all shapes in the multi-drag back to their originals
        if (sketchGroup) {
          sketchDragRef.current.multiIndices.forEach((idx, i) => {
            const lineObj = sketchGroup.children.find(
              (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
            );
            if (lineObj)
              updateSketchLineGeo(
                lineObj,
                sketchDragRef.current.multiOrigShapes[i],
                sketchDragRef.current.sketchMesh,
              );
          });
        }
      } else if (sketchGroup && sketchDragRef.current.origShape) {
        const lineObj = sketchGroup.children.find(
          (c) =>
            c.userData.shapeIdx === sketchDragRef.current.shapeIdx &&
            c.geometry?.setPositions,
        );
        if (lineObj)
          updateSketchLineGeo(
            lineObj,
            sketchDragRef.current.origShape,
            sketchDragRef.current.sketchMesh,
          );
      }
      sketchDragRef.current = null;
      clearDragIndicator();
      renderer.domElement.style.cursor = "";
    }
  };
  const { onKeyDown } = createSketchKeyboardHandler(
    {
      sketchModeRef,
      itemsRef,
      objectsRef,
      selectedIdRef,
      extrudeSelectModeRef,
      sketchPlacementModeRef,
      cameraControlsRef,
      sketchDrawRef,
      multiSelectedRef,
      longPressMenuRef,
      marqueeStartRef,
      marqueeActiveRef,
    },
    {
      isMac,
      solveDrag,
      refreshSketchSelectionOverlay,
      showMultiSelectOverlays,
      clearMultiSelectOverlays,
      clearCoincidentFirstOverlay,
      clearSketchSelection,
      sketchSelectLine,
      cancelSketchDraw,
      clearMarqueeRect,
      clearModifyPreview,
      clearMirrorPreview,
      clearCircularPatternPreview,
      clearRectangularPatternPreview,
      getSelectedConstraintIdx,
      clearConstraintSelection,
      clearStartHighlight,
      cancelExtrude,
    },
  );

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
    unsubMirror,
    unsubCircularPattern,
    unsubRectangularPattern,
    unsubCentre,
    unsubCog,
  };
}
