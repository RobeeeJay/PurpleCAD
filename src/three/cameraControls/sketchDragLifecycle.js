// Sketch element dragging: point/shape/multi/rotate drag start, live-move
// solving (via the constraint solver, warm-started per frame), and commit.
// Split out of sketchInteraction.js — the largest single cohesive block in
// that file. Shares `multiSelectedRef` (owned by the caller — it's a
// selection concern, not purely a drag one) and owns `sketchDragRef` (the
// live drag state), which the caller reads directly for its own mouse-up /
// cancel / long-press logic.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  getSketchShapePoints,
  getSnapPoints,
  getShapePoint,
  moveShapePoint,
  rebuildConstraintIconsForDrag,
  rebuildPointDotsForDrag,
  snapUnitToIntervalMm,
} from "../sceneObjects.js";
import {
  applyHVEnforcement,
  enforceConstraints,
  allConstraintsSatisfied,
} from "../sketchConstraints.js";
import { variablesToMap } from "../../utils/formulas.js";
import { translateShape, rotateShape } from "../sketchGeometry.js";
import {
  solveConstraints,
  fieldsForPoint,
  varFields,
} from "../sketchSolver.js";
import { constraintIconScreenPos } from "../sceneObjects/constraintIconSprites.js";

// An offset copy is inert while its offset constraint exists — driven by its
// original, it must not be selectable/draggable on its own.
export const isOffsetShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "offset" && c.shapeIdx === idx,
  );

// Same inertness for mirror copies while their mirror constraint exists.
export const isMirrorShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "mirror" && c.shapeIdx === idx,
  );

// Same inertness for circular-pattern copies while their constraint exists.
export const isCircularPatternShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "circularPattern" && c.shapeIdx === idx,
  );

// Same inertness for rectangular-pattern copies while their constraint exists.
export const isRectangularPatternShapeIdx = (selItem, idx) =>
  (selItem?.constraints || []).some(
    (c) => c.type === "rectangularPattern" && c.shapeIdx === idx,
  );

// Chamfer/bevel corner bridges are DERIVED geometry — not directly
// selectable, marquee-able, or draggable (their setback is edited via the
// value label / timeline).  Other tools may still SNAP to their endpoints.
export const isCornerBridgeIdx = (selItem, idx) => {
  const s = selItem?.shapes?.[idx];
  return s?.kind === "chamfer" || s?.kind === "bevel";
};

// Indices of every shape sharing a group with shape `idx` (just [idx] when it
// isn't grouped) — so a grouped shape selects / drags as a unit.
export const groupMembersOf = (shapes, idx) => {
  const g = shapes?.[idx]?.group;
  if (g == null) return [idx];
  const members = [];
  shapes.forEach((s, i) => {
    if (s?.group === g) members.push(i);
  });
  return members.length ? members : [idx];
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

export function createSketchDragLifecycle(
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
) {
  // { kind:"point"|"shape"|"multi"|"rotate", shapeIdx, pointKey?, sketchMesh,
  //   selItemId, anchorLocal, origShape, ... } — see the kind branches below.
  const sketchDragRef = { current: null };

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

  const applySketchDragMove = (screenX, screenY, shiftKey) => {
    if (!sketchDragRef.current) return;
    const { kind, sketchMesh, selItemId, anchorLocal } = sketchDragRef.current;
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return;

    let localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) return;

    // ── Rotation drag: rotate the selection about its centre ────────────────
    if (kind === "rotate") {
      const { indices, origShapes, center } = sketchDragRef.current;
      let angle =
        Math.atan2(localPt.y - center.y, localPt.x - center.x) -
        sketchDragRef.current.startAngle;
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
      sketchDragRef.current.pendingShapes = pendingShapes;
      // Pin the rotated shapes and solve the rest of the system around them, so
      // any geometry connected to the selection (but not selected) follows.
      const rotKeys = new Map();
      for (const idx of pendingShapes.keys()) rotKeys.set(idx, null);
      const allMoved = solveDrag(
        selItemId,
        new Map(pendingShapes),
        rotKeys,
        sketchDragRef.current.solverWarm,
      );
      sketchDragRef.current.solverWarm = mapToArray(allMoved);
      sketchDragRef.current.multiPropagated = allMoved;
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
      const { multiIndices, multiOrigShapes } = sketchDragRef.current;
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
      sketchDragRef.current.pendingShapes = pendingShapes;
      // Pin the whole moved group and solve the rest of the system around it.
      const multiKeys = new Map();
      for (const idx of pendingShapes.keys()) multiKeys.set(idx, null);
      const allMoved = solveDrag(
        selItemId,
        new Map(pendingShapes),
        multiKeys,
        sketchDragRef.current.solverWarm,
      );
      sketchDragRef.current.solverWarm = mapToArray(allMoved);
      sketchDragRef.current.multiPropagated = allMoved;
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

    const { shapeIdx, pointKey, origShape } = sketchDragRef.current;
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
      sketchDragRef.current.solverWarm,
    );
    sketchDragRef.current.solverWarm = mapToArray(propagated);
    sketchDragRef.current.pendingShape = newShape;
    sketchDragRef.current.propagatedShapes = propagated;

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
    if (
      sketchDragRef.current?.kind === "multi" ||
      sketchDragRef.current?.kind === "rotate"
    ) {
      const toSave =
        sketchDragRef.current.multiPropagated ??
        sketchDragRef.current.pendingShapes;
      if (toSave?.size > 0) {
        store.updateSketchShapes(sketchDragRef.current.selItemId, toSave);
      }
      // Keep the (live-positioned) selection highlights; just re-seat the
      // rotation handle on the settled geometry so the selection persists.
      refreshRotationHandle();
      clearCoincidentFirstOverlay();
      return;
    }
    if (!sketchDragRef.current?.pendingShape) return;
    const { selItemId, shapeIdx, pendingShape, propagatedShapes } =
      sketchDragRef.current;
    if (propagatedShapes && propagatedShapes.size > 0) {
      store.updateSketchShapes(selItemId, propagatedShapes);
    } else {
      store.updateSketchShape(selItemId, shapeIdx, pendingShape);
    }
    refreshRotationHandle();
    clearCoincidentFirstOverlay();
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
        const at = constraintIconScreenPos(
          cObj,
          sketchMesh,
          cameraRef.current,
          rect,
        );
        if (!at) continue;
        if (Math.hypot(screenX - at.x, screenY - at.y) < 20) {
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
          multiSelectedRef.current.length > 0
            ? [...multiSelectedRef.current]
            : sel?.type === "line"
              ? [sel.shapeIdx]
              : []
        )
          // Projected geometry is immovable until released — never rotate it.
          .filter((i) => !shapes[i]?.projection);
        const start = screenToSketchLocal(screenX, screenY, sketchMesh);
        if (indices.length > 0 && start) {
          sketchDragRef.current = {
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
            multiSelectedRef.current = [];
            sketchDragRef.current = {
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
          multiSelectedRef.current.length > 1 &&
          multiSelectedRef.current.includes(snap.shapeIdx)
        ) {
          // Projected geometry is immovable — exclude it from the dragged set.
          const movable = multiSelectedRef.current.filter(
            (i) => !shapes[i]?.projection,
          );
          sketchDragRef.current = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            multiIndices: movable,
            multiOrigShapes: movable.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedRef.current = [];
          sketchDragRef.current = {
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
            : multiSelectedRef.current.length > 1 &&
                multiSelectedRef.current.includes(shapeIdx)
              ? [...multiSelectedRef.current]
              : null;
        if (dragSet) {
          multiSelectedRef.current = dragSet;
          showMultiSelectOverlays(dragSet);
          // Projected geometry stays selected but isn't moved.
          const movable = dragSet.filter((i) => !shapes[i]?.projection);
          sketchDragRef.current = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            multiIndices: movable,
            multiOrigShapes: movable.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedRef.current = [];
          sketchDragRef.current = {
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
    multiSelectedRef.current = [];
    return false;
  };

  return {
    sketchDragRef,
    updateSketchLineGeo,
    propagateConstraints,
    solveDrag,
    buildLongPressItems,
    startSketchDrag,
    applySketchDragMove,
    commitSketchDrag,
  };
}
