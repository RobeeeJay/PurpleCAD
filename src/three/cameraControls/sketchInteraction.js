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
  MM_PER_UNIT,
} from "../sceneObjects.js";
import {
  applyHVEnforcement,
  enforceConstraints,
  allConstraintsSatisfied,
} from "../sketchConstraints.js";
import { variablesToMap } from "../../utils/formulas.js";
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
import { sketchLineColorFor, SKETCH_HOVER_POINT_LINE_COLOR } from "../theme.js";
import {
  selectedSketchLineIndices,
  offsetSelectedSketchGeometry,
} from "../sketchModifyActions.js";
import { svgCoincidentConstraints } from "../importGeometry.js";
import { DEFAULT_FONT_ID as TEXT_DEFAULT_FONT_ID } from "../sketchText.js";
import { createSketchSelectionOverlays } from "./sketchSelectionOverlays.js";
import { createSketchModifyHelpers } from "./sketchModify.js";
import { createSketchMirrorHelpers } from "./sketchMirrorTool.js";
import { createSketchCircularPatternHelpers } from "./sketchCircularPatternTool.js";
import { createSketchRectangularPatternHelpers } from "./sketchRectangularPatternTool.js";
import { buildPatternPreviewObjects } from "./sketchPatternPreview.js";
import { MIRRORABLE_TYPES } from "../sketchMirror.js";
import { CIRCULAR_PATTERNABLE_TYPES } from "../sketchCircularPattern.js";
import { RECTANGULAR_PATTERNABLE_TYPES } from "../sketchRectangularPattern.js";
import { createSketchConstraintHandlers } from "./sketchConstraintHandlers.js";
import { createSketchDrawHelpers } from "./sketchDraw.js";

// An offset copy is inert while its offset constraint exists — driven by its
// original, it must not be selectable/draggable on its own.
const isOffsetShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "offset" && c.shapeIdx === idx,
  );

// Same inertness for mirror copies while their mirror constraint exists.
const isMirrorShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "mirror" && c.shapeIdx === idx,
  );

// Same inertness for circular-pattern copies while their constraint exists.
const isCircularPatternShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "circularPattern" && c.shapeIdx === idx,
  );

// Indices of every shape sharing a group with shape `idx` (just [idx] when it
// isn't grouped) — so a grouped shape selects / drags as a unit.
const groupMembersOf = (shapes, idx) => {
  const g = shapes?.[idx]?.group;
  if (g == null) return [idx];
  const members = [];
  shapes.forEach((s, i) => {
    if (s?.group === g) members.push(i);
  });
  return members.length ? members : [idx];
};

// Same inertness for rectangular-pattern copies while their constraint exists.
const isRectangularPatternShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "rectangularPattern" && c.shapeIdx === idx,
  );

// Chamfer/bevel corner bridges are DERIVED geometry — not directly
// selectable, marquee-able, or draggable (their setback is edited via the
// value label / timeline).  Other tools may still SNAP to their endpoints.
const isCornerBridgeIdx = (selItem, idx) => {
  const s = selItem?.shapes?.[idx];
  return s?.kind === "chamfer" || s?.kind === "bevel";
};

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
  // After an SVG is parsed it isn't committed straight away — its shapes show as
  // a movable/scalable preview until the user confirms.  Drag to move, the
  // overlay sets the scale; commit appends the transformed shapes to the sketch.
  let svgPreviewObjs = [];
  let svgDrag = null; // { startLocal, startOffsetX, startOffsetY }

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
    svgDrag = null;
    store.clearSvgImport();
  };
  controls.cancelSvgPlacement = () => {
    clearSvgPreview();
    svgDrag = null;
    useStore.getState().clearSvgImport();
  };

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
  let multiSelectedIndices = [];
  let marqueeStartScreen = null;
  // Selection a shift+marquee adds to (the pre-drag selection); [] replaces.
  let marqueeBaseIndices = [];
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
    if (!sketchMesh || !marqueeStartScreen) return;
    const p1 = screenToSketchLocal(
      marqueeStartScreen.x,
      marqueeStartScreen.y,
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
    const union = new Set(marqueeBaseIndices);
    inRect.forEach((i) => union.add(i));
    multiSelectedIndices = [...union];
    showMultiSelectOverlays(multiSelectedIndices);
  };

  const clearSketchSelection = () => {
    clearSketchSelectionOverlay();
    useStore.getState().setSelectedSketchElement(null);
    clearMultiSelectOverlays();
    multiSelectedIndices = [];
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
        multiSelectedIndices = [];
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
            multiSelectedIndices = members;
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
  // Trim tool: while the button is held the tool keeps trimming any line under
  // the cursor; the whole drag is one undo step (snapshot taken on first trim).
  let trimming = false;
  let trimSnapshotTaken = false;

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
  // Repaired shapes computed at drag start when the sketch's saved state
  // violates its constraints — used as the first solve's seed (see
  // startSketchDrag).
  let repairSeed = null;

  const solveDrag = (selItemId, placed, pointKeys, warm) => {
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return placed;
    const warmed = warm && warm.length > 0;
    const input = (
      warmed ? warm : (repairSeed ?? selItem.shapes ?? [])
    ).slice();
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
    const { shapes, maxResidual } = solveConstraints(
      input,
      selItem.constraints || [],
      { fixed, maxIter: warmed ? 30 : 60 },
    );
    // If the dragged target can't satisfy the constraints — e.g. dragging a
    // square's edge so far that a chamfered corner would collapse or invert —
    // committing the solver's best (constraint-violating) guess visibly breaks
    // the sketch. Instead hold the last valid configuration, so the geometry
    // simply stops following until the cursor returns to a satisfiable range.
    // The threshold sits well above a converged solve (~0) and below a genuine
    // miss (which jumps to a large residual).
    if (maxResidual > 1e-2) {
      const prev = warmed ? warm : selItem.shapes || [];
      const out = new Map();
      prev.forEach((s, i) => out.set(i, s));
      return out;
    }
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
          useStore.getState().constraintsVisible,
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
          useStore.getState().constraintsVisible,
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
    // round the in-plane position to the configured world-space interval.  A
    // bezier's control points (p1/p2) shape the curve freely, so they bypass the
    // grid — gridding them quantises the tangents and fights fine adjustment.
    const isBezierControl =
      origShape?.type === "bezier" && (pointKey === "p1" || pointKey === "p2");
    const snapCfg = useStore.getState();
    if (
      !pointSnapped &&
      !isBezierControl &&
      snapCfg.snapEnabled &&
      snapCfg.snapDistanceMm > 0
    ) {
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
        useStore.getState().dimensionsVisible,
        useStore.getState().constraintsVisible,
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
    pointLineDistance: "Distance",
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
        (c) =>
          c.userData.shapeIdx != null &&
          !c.userData.isOffset &&
          !c.userData.isMirror &&
          !c.userData.isCircularPattern &&
          !c.userData.isRectangularPattern &&
          !c.userData.isCornerBridge,
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
    // Shift is additive-selection only — never start a drag, so a shift click /
    // marquee adds to the current selection rather than moving or replacing it.
    if (shiftKey) return false;
    // A saved sketch can VIOLATE its own constraints (drift from corner ops
    // or older builds).  Every drag solve would then start from that bad seed
    // and fail its residual guard — the whole sketch feels nailed down.
    // Compute a repaired configuration and use it as the drag solver's SEED
    // only: nothing is committed until the gesture ends (a bare click leaves
    // the document untouched, and there's no mid-gesture store write to
    // rebuild the scene under the drag).
    repairSeed = null;
    {
      const varsMap = variablesToMap(useStore.getState().variables);
      const cs = selItem.constraints || [];
      if (
        cs.length > 0 &&
        !allConstraintsSatisfied(selItem.shapes || [], cs, varsMap)
      ) {
        const res = solveConstraints(selItem.shapes || [], cs, {
          maxIter: 200,
          variables: varsMap,
        });
        if (res.ok) repairSeed = res.shapes;
      }
    }
    // Capture drag geometry from the REPAIRED configuration: pinning a shape
    // taken from the drifted state freezes its defects into the solve (e.g. a
    // border whose length violates its own dimension can never satisfy it
    // while body-pinned), failing every drag.
    const shapes = repairSeed ?? selItem.shapes ?? [];
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
        const indices = (
          multiSelectedIndices.length > 0
            ? [...multiSelectedIndices]
            : sel?.type === "line"
              ? [sel.shapeIdx]
              : []
        )
          // Projected geometry is immovable until released — never rotate it.
          .filter((i) => !shapes[i]?.projection);
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

    // Bezier tangent handles: when a bezier is selected, its p1/p2 control
    // points are grabbable (they aren't snap points, so check them explicitly).
    {
      const selEl = useStore.getState().selectedSketchElement;
      const bez = selEl?.type === "line" ? shapes[selEl.shapeIdx] : null;
      if (bez?.type === "bezier" && !bez.projection) {
        const rect = renderer.domElement.getBoundingClientRect();
        for (const key of ["p1", "p2"]) {
          const p = bez[key];
          const w = new THREE.Vector3(p.x, p.y, 0.003)
            .applyQuaternion(sketchMesh.quaternion)
            .add(sketchMesh.position)
            .project(cameraRef.current);
          const px = ((w.x + 1) / 2) * rect.width + rect.left;
          const py = ((-w.y + 1) / 2) * rect.height + rect.top;
          if (Math.hypot(screenX - px, screenY - py) < 16) {
            clearMultiSelectOverlays();
            multiSelectedIndices = [];
            sketchDrag = {
              kind: "point",
              shapeIdx: selEl.shapeIdx,
              pointKey: key,
              sketchMesh,
              selItemId: selItem.id,
              anchorLocal: { x: p.x, y: p.y },
              origShape: bez,
            };
            renderer.domElement.style.cursor = "grabbing";
            return true;
          }
        }
      }
    }

    // Point drag — check snap points first (higher priority, smaller target).
    // An offset copy's points are inert, so skip dragging by them.
    if (!shiftKey) {
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (
        snap &&
        !isOffsetShapeIdx(selItem, snap.shapeIdx) &&
        !isMirrorShapeIdx(selItem, snap.shapeIdx) &&
        !isCircularPatternShapeIdx(selItem, snap.shapeIdx) &&
        !isRectangularPatternShapeIdx(selItem, snap.shapeIdx) &&
        !isCornerBridgeIdx(selItem, snap.shapeIdx) &&
        // Projected geometry is immovable until its constraint is released.
        !shapes[snap.shapeIdx]?.projection
      ) {
        // If the snapped shape is part of a multi-selection, drag them all together
        // (the snap point acts as the anchor instead of a single-point drag).
        if (
          multiSelectedIndices.length > 1 &&
          multiSelectedIndices.includes(snap.shapeIdx)
        ) {
          // Projected geometry is immovable — exclude it from the dragged set.
          const movable = multiSelectedIndices.filter(
            (i) => !shapes[i]?.projection,
          );
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            multiIndices: movable,
            multiOrigShapes: movable.map((i) => shapes[i]),
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
        (c) =>
          c.userData.shapeIdx != null &&
          !c.userData.isOffset &&
          !c.userData.isMirror &&
          !c.userData.isCircularPattern &&
          !c.userData.isRectangularPattern &&
          !c.userData.isCornerBridge,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (
        hits.length > 0 &&
        hits[0].object.userData.shapeIdx != null &&
        // Projected geometry is immovable until its constraint is released.
        !shapes[hits[0].object.userData.shapeIdx]?.projection
      ) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const localAnchor = screenToSketchLocal(
          screenX,
          screenY,
          sketchMesh,
        ) || { x: 0, y: 0 };
        // Grabbing a grouped shape drags the whole group; otherwise honour an
        // existing multi-selection that includes the hit shape.
        const group = groupMembersOf(shapes, shapeIdx);
        const dragSet =
          group.length > 1
            ? group
            : multiSelectedIndices.length > 1 &&
                multiSelectedIndices.includes(shapeIdx)
              ? [...multiSelectedIndices]
              : null;
        if (dragSet) {
          multiSelectedIndices = dragSet;
          showMultiSelectOverlays(dragSet);
          // Projected geometry stays selected but isn't moved.
          const movable = dragSet.filter((i) => !shapes[i]?.projection);
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            multiIndices: movable,
            multiOrigShapes: movable.map((i) => shapes[i]),
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
    // SVG placement: start dragging the pending import to move it.
    const svg = useStore.getState().svgImport;
    if (svg) {
      const sketchMesh = objectsRef.current[svg.sketchId];
      const local = sketchMesh
        ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
        : null;
      svgDrag = local
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
    // The mirror tool is a pick-mode, not a drawing tool: clicks are handled
    // on mouse-up by handleMirrorClick, not the draw helpers.
    if (
      activeSketchToolRef.current === "mirror" ||
      activeSketchToolRef.current === "circularPattern" ||
      activeSketchToolRef.current === "rectangularPattern"
    ) {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
    // Project: arm a marquee so a drag box-selects edges, a click projects all
    // connected edges of the body under the cursor.
    if (activeSketchToolRef.current === "project") {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      marqueeStartScreen = { x: e.clientX, y: e.clientY };
      return true;
    }
    // Trim: start trimming immediately and keep trimming on drag (no marquee).
    if (activeSketchToolRef.current === "trim") {
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
      trimming = true;
      trimSnapshotTaken = false;
      tryTrimAt(e.clientX, e.clientY);
      return true;
    }
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
          // Cancel the pending marquee armed on mouse-down — a long press opens
          // the element list, it must not also start a selection box if the
          // cursor drifts while held.
          marqueeStartScreen = null;
          marqueeActive = false;
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
          multiSelectedIndices = [];
        }
        marqueeBaseIndices = e.shiftKey ? [...multiSelectedIndices] : [];
        marqueeStartScreen = { x: e.clientX, y: e.clientY };
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
      if (svgDrag) {
        const sketchMesh = objectsRef.current[svgMove.sketchId];
        const cur = sketchMesh
          ? screenToSketchLocal(e.clientX, e.clientY, sketchMesh)
          : null;
        if (cur) {
          useStore.getState().updateSvgImport({
            offsetX: svgDrag.startOffsetX + (cur.x - svgDrag.startLocal.x),
            offsetY: svgDrag.startOffsetY + (cur.y - svgDrag.startLocal.y),
          });
          updateSvgPreview();
        }
      }
      renderer.domElement.style.cursor = svgDrag ? "grabbing" : "grab";
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
    // While the long-press element list is open, ignore canvas motion — no
    // marquee, no hover repaint underneath it.
    if (longPressMenuOpen) return true;
    if (activeSketchToolRef.current === "project") {
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      if (marqueeStartScreen) {
        const dx = e.clientX - marqueeStartScreen.x;
        const dy = e.clientY - marqueeStartScreen.y;
        if (Math.hypot(dx, dy) > 5) {
          marqueeActive = true;
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
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
    if (activeSketchToolRef.current === "trim") {
      clearAllSketchHover();
      if (trimming) tryTrimAt(e.clientX, e.clientY);
      else trimHoverAt(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return true;
    }
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
        !trimSnapshotTaken,
      );
    trimSnapshotTaken = true;
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

  const onSketchMouseUp = (e) => {
    if (!sketchModeRef.current || e.button !== 0) return false;
    if (useStore.getState().svgImport) {
      svgDrag = null;
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
      if (Math.hypot(dx, dy) >= 5 && marqueeStartScreen) {
        controls.projectEdgesInBox({
          x1: marqueeStartScreen.x,
          y1: marqueeStartScreen.y,
          x2: e.clientX,
          y2: e.clientY,
        });
      } else {
        controls.projectEdgeAt(e.clientX, e.clientY);
      }
      clearMarqueeRect();
      controls.clearProjectHover?.();
      marqueeActive = false;
      marqueeStartScreen = null;
      return true;
    }
    if (activeSketchToolRef.current === "mirror") {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleMirrorClick(e.clientX, e.clientY, hitTestSketchLines, makeRay);
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
      trimSnapshotTaken = false;
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
      if (constraintMode === "midpoint") {
        handleMidpointClick(sx, sy);
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
                cObj.userData.constraintType !== "pointLineDistance" &&
                cObj.userData.constraintType !== "offset" &&
                cObj.userData.constraintType !== "rectangularPattern" &&
                cObj.userData.constraintType !== "mirror" &&
                cObj.userData.constraintType !== "circularPattern" &&
                cObj.userData.constraintType !== "text")
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
              if (c && c.type === "pointLineDistance") {
                useStore.getState().setSketchDistanceInput({
                  pointLine: {
                    pointShapeIdx: c.pointShapeIdx,
                    pointKey: c.pointKey,
                    lineShapeIdx: c.lineShapeIdx,
                  },
                  defaultDistance: c.distance,
                  constraintIdx: cObj.userData.constraintIdx,
                });
                useStore.getState().setSketchConstraintMode("distance");
              } else if (c && c.type === "distance") {
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
              } else if (c && c.type === "rectangularPattern") {
                // Re-open the Rectangular Pattern tool seeded from this pattern
                // so its counts/offsets can be edited and re-confirmed.
                useStore
                  .getState()
                  .beginRectangularPatternEdit(
                    selectedIdRef.current,
                    cObj.userData.constraintIdx,
                  );
              } else if (c && c.type === "mirror") {
                useStore
                  .getState()
                  .beginMirrorEdit(
                    selectedIdRef.current,
                    cObj.userData.constraintIdx,
                  );
              } else if (c && c.type === "circularPattern") {
                useStore
                  .getState()
                  .beginCircularPatternEdit(
                    selectedIdRef.current,
                    cObj.userData.constraintIdx,
                  );
              } else if (c && c.type === "text") {
                // Re-open the Text dialog seeded from this text shape so its
                // contents / height / font can be edited and re-committed.
                const ts = (dblSel.shapes || [])[c.shapeIdx];
                if (ts && ts.type === "text")
                  useStore.getState().setTextDraft({
                    x: ts.x,
                    y: ts.y,
                    text: ts.text,
                    heightMm: ts.height * MM_PER_UNIT,
                    font: ts.font,
                    editIdx: c.shapeIdx,
                  });
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
            (c) =>
              c.userData.shapeIdx != null &&
              !c.userData.isOffset &&
              !c.userData.isMirror &&
              !c.userData.isCircularPattern &&
              !c.userData.isRectangularPattern &&
              !c.userData.isCornerBridge,
          );
          const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
          if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
            const hitIdx = hits[0].object.userData.shapeIdx;
            const hs = (selItem.shapes || [])[hitIdx];
            // Double-clicking a chamfer/bevel bridge edits its setback / radius.
            if (hs && (hs.kind === "chamfer" || hs.kind === "bevel")) {
              useStore.getState().setSketchDistanceInput({
                cornerResize: {
                  sketchId: selItem.id,
                  shapeIdx: hitIdx,
                  mode: hs.kind,
                },
                defaultDistance:
                  hs.distanceFormula ??
                  (hs.kind === "bevel" ? hs.r : (hs.chamferData?.dist ?? 0)),
              });
              return;
            }
            const connected = collectConnectedShapes(
              hitIdx,
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
        // Shift+click: toggle the hit element in/out of the multi-selection.
        // Selecting lines for a distance/length drops any measure point picks.
        if (useStore.getState().measureTool)
          useStore.getState().clearMeasurePicks();
        const sketchGroup = sketchShapesGroupRef?.current;
        if (!sketchGroup) return;
        const lineObjs = sketchGroup.children.filter(
          (c) =>
            c.userData.shapeIdx != null &&
            !c.userData.isOffset &&
            !c.userData.isMirror &&
            !c.userData.isCircularPattern &&
            !c.userData.isRectangularPattern &&
            !c.userData.isCornerBridge,
        );
        const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
        let hitIdx =
          hits.length > 0 && hits[0].object.userData.shapeIdx != null
            ? hits[0].object.userData.shapeIdx
            : null;
        // Standalone POINT shapes aren't line objects, so the line hit-test
        // never sees them — snap for one so a point can join the pair
        // (midpoint's point + line/arc/curve selection).
        if (hitIdx == null) {
          const selItem = itemsRef.current.find(
            (i) => i.id === selectedIdRef.current,
          );
          const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
          if (selItem && sketchMesh) {
            const shapes = selItem.shapes || [];
            const snap = findSnap(sx, sy, shapes, sketchMesh);
            if (snap && shapes[snap.shapeIdx]?.type === "point")
              hitIdx = snap.shapeIdx;
          }
        }
        if (hitIdx != null) {
          // Seed from the current single-element selection so the natural
          // flow — click one element, shift-click a second — yields a 2-shape
          // multiselect.  Any element kind seeds: parallel/tangent want two
          // lines, but midpoint pairs a POINT with a line/arc/curve.
          if (multiSelectedIndices.length === 0) {
            const sel = useStore.getState().selectedSketchElement;
            if (sel?.shapeIdx != null && sel.shapeIdx !== hitIdx)
              multiSelectedIndices = [sel.shapeIdx];
          }
          multiSelectedIndices = multiSelectedIndices.includes(hitIdx)
            ? multiSelectedIndices.filter((i) => i !== hitIdx)
            : [...multiSelectedIndices, hitIdx];
          showMultiSelectOverlays(multiSelectedIndices);
          if (multiSelectedIndices.length > 0)
            useStore.getState().setSelectedSketchElement(null);
        }
        return;
      }

      // A chamfer/bevel value label click re-opens the resize input (same
      // flow as double-clicking the bridge itself).
      {
        const cg = sketchShapesGroupRef?.current;
        const cSel = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const cMesh = cSel ? objectsRef.current[cSel.id] : null;
        if (cg && cMesh) {
          const rect = renderer.domElement.getBoundingClientRect();
          for (const obj of cg.children) {
            if (!obj.userData.isCornerDim) continue;
            const lp = obj.userData.cornerDimLocalPos;
            const wp = new THREE.Vector3(lp.x, lp.y, 0.007)
              .applyQuaternion(cMesh.quaternion)
              .add(cMesh.position);
            const ndc = wp.clone().project(cameraRef.current);
            const px = ((ndc.x + 1) / 2) * rect.width + rect.left;
            const py = ((-ndc.y + 1) / 2) * rect.height + rect.top;
            if (Math.hypot(sx - px, sy - py) < 20) {
              const hs = (cSel.shapes || [])[obj.userData.shapeIdx];
              if (hs && (hs.kind === "chamfer" || hs.kind === "bevel")) {
                useStore.getState().setSketchDistanceInput({
                  cornerResize: {
                    sketchId: cSel.id,
                    shapeIdx: obj.userData.shapeIdx,
                    mode: hs.kind,
                  },
                  defaultDistance:
                    hs.distanceFormula ??
                    (hs.kind === "bevel" ? hs.r : (hs.chamferData?.dist ?? 0)),
                });
                return;
              }
            }
          }
        }
      }

      // Check for constraint icon click before doing normal element select
      // (only when the Constraint selection type is enabled).
      if (effectiveSketchSelTypes(useStore.getState()).eff.constraint) {
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

    // Arrow keys nudge the selected sketch geometry by 1mm (one grid step in
    // scene units).  Translates the whole selection rigidly, then solves the
    // rest of the system around it — same path a body drag uses.
    const nudge = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[e.key];
    if (
      nudge &&
      sketchModeRef.current &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.shapeIdx != null
            ? [sel.shapeIdx]
            : null;
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (indices && selItem) {
        e.preventDefault();
        const step = 1 / MM_PER_UNIT;
        const dx = nudge[0] * step;
        const dy = nudge[1] * step;
        const placed = new Map();
        const keys = new Map();
        for (const idx of indices) {
          const moved = translateShape(selItem.shapes[idx], dx, dy);
          if (moved) {
            placed.set(idx, moved);
            keys.set(idx, null);
          }
        }
        if (placed.size > 0) {
          const solved = solveDrag(selItem.id, placed, keys, null);
          useStore.getState().updateSketchShapes(selItem.id, solved);
          refreshSketchSelectionOverlay();
        }
      }
      return;
    }

    // Shift+Z / Shift+X toggle constraint / dimension visibility — the two
    // toggles the Shift-held selection widget shows — in both 3D and sketch.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        useStore.getState().toggleConstraintsVisible();
        return;
      }
      if (k === "x") {
        e.preventDefault();
        useStore.getState().toggleDimensionsVisible();
        return;
      }
    }

    // Z X C V B toggle the selection-type filters, in a shared widget order, for
    // whichever selection widget is showing (object → region → edge/line → point,
    // then constraint): 3D = object/face/edge/point (no fifth type, so B is a
    // no-op there); sketch = object/shape/line/point/constraint.  Bare keys only —
    // Ctrl/Cmd/Alt combos stay free for copy/undo/etc.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const idx = { z: 0, x: 1, c: 2, v: 3, b: 4 }[e.key.toLowerCase()];
      if (idx !== undefined) {
        const store = useStore.getState();
        if (sketchModeRef.current) {
          e.preventDefault();
          store.toggleSketchSelType(
            ["object", "shape", "line", "point", "constraint"][idx],
          );
        } else {
          const toggle = [
            store.toggleSelObject,
            store.toggleSelFace,
            store.toggleSelEdge,
            store.toggleSelPoint,
          ][idx];
          if (toggle) {
            e.preventDefault();
            toggle();
          }
        }
        return;
      }
    }

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
        .filter(Boolean)
        // Pasted copies start ungrouped (don't inherit the source's group).
        .map((s) => {
          if (s.group == null) return s;
          const { group, ...rest } = s;
          return rest;
        });
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

    // Cmd/Ctrl+G — group the selected sketch shapes (2+) so they act as a unit.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "g"
    ) {
      if (multiSelectedIndices.length < 2) return;
      e.preventDefault();
      const indices = [...multiSelectedIndices];
      useStore.getState().groupSketchShapes(selectedIdRef.current, indices);
      showMultiSelectOverlays(indices);
      return;
    }

    // Cmd/Ctrl+U — ungroup the selected sketch shapes.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "u"
    ) {
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (indices.length === 0) return;
      e.preventDefault();
      useStore.getState().ungroupSketchShapes(selectedIdRef.current, indices);
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
      const selShapes =
        itemsRef.current.find((i) => i.id === selectedIdRef.current)?.shapes ||
        [];
      const toDelete =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : // A selected standalone point deletes that point (a line's
              // endpoint node, also type "point", is left alone).
              sel?.type === "point" && selShapes[sel.shapeIdx]?.type === "point"
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
        const editTarget = useStore.getState().chamferEditTarget;
        if (editTarget) {
          // Editing viewed the pre-chamfer step — put the user back on the entry.
          useStore.getState().restoreToHistory(editTarget.entryId);
          useStore.getState().setChamferEditTarget(null);
        }
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
        if (store.activeSketchTool === "mirror") {
          store.cancelMirrorTool();
          clearMirrorPreview();
          return;
        }
        if (store.activeSketchTool === "circularPattern") {
          store.cancelCircularPatternTool();
          clearCircularPatternPreview();
          return;
        }
        if (store.activeSketchTool === "rectangularPattern") {
          store.cancelRectangularPatternTool();
          clearRectangularPatternPreview();
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

    // 3D-view render mode shortcuts: 1-4 switch the shaded/wireframe/etc.
    // mode, 5-8 toggle the remaining Render-section buttons (shadows,
    // cross-section, path tracer, curve resolution) — same left-to-right
    // order they appear in RenderSection.jsx.
    if (
      !sketchModeRef.current &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      const store = useStore.getState();
      const renderModeKeys = {
        1: "wireframe",
        2: "transparent",
        3: "shaded",
      };
      if (renderModeKeys[e.key]) {
        e.preventDefault();
        store.setRenderMode(renderModeKeys[e.key]);
        return;
      }
      // 4 selects the path-traced render mode (1-3 select the raster modes).
      if (e.key === "4") {
        e.preventDefault();
        store.setPathTraceView(true);
        return;
      }
      if (e.key === "5") {
        e.preventDefault();
        store.setShadowsEnabled(!store.shadowsEnabled);
        return;
      }
      if (e.key === "6") {
        e.preventDefault();
        store.toggleCrossSectionView();
        return;
      }
      if (e.key === "8") {
        e.preventDefault();
        store.toggleCurveResolution();
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

      // C and B are reserved for selection-type toggles (handled above), so the
      // circle / bezier tools have no key bind — use the toolbar.
      const toolMap = {
        l: "line",
        r: "rect",
        e: "ellipse",
        a: "arc",
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
    unsubMirror,
    unsubCircularPattern,
    unsubRectangularPattern,
  };
}
