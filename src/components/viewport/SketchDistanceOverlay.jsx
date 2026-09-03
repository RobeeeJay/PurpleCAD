// The sketch distance/dimension input overlay: the shared formula field that
// backs a dimension, an offset distance and a drag-committed length.  Pulled
// out of SketchOverlays.jsx, which was carrying it plus three other tool
// surfaces in one 1200-line component.

import React from "react";
import FormulaInput from "../FormulaInput";
import { useStore } from "../../store";
import { evaluateFormula, variablesToMap } from "../../utils/formulas.js";
import {
  MM_PER_UNIT,
  getShapePoint,
  moveShapePoint,
} from "../../three/sceneObjects.js";
import {
  solveConstraints,
  fieldsForPoint,
  varFields,
} from "../../three/sketchSolver.js";

export default function SketchDistanceOverlay({
  sketchMode,
  sketchDistanceInput,
  selectedId,
  variables,
  itemsRef,
  cameraControlsRef,
}) {
  // Offset confirm/cancel — shared by the overlay buttons and Enter/Escape.
  // The latest typed value is tracked here so the Confirm button (which has no
  // event) can read it; onChange already live-previews it via the store.
  const offsetDraftRef = React.useRef(null);

  const confirmOffset = () => {
    const di = useStore.getState().sketchDistanceInput;
    if (!di || di.offsetConstraintIdx == null) return;
    const raw = (offsetDraftRef.current ?? String(di.defaultDistance)).trim();
    const mm = evaluateFormula(
      raw,
      variablesToMap(useStore.getState().variables),
    );
    if (Number.isFinite(mm) && mm !== 0) {
      useStore
        .getState()
        .updateSketchOffsetDistance(
          selectedId,
          di.offsetGroup,
          di.offsetConstraintIdx,
          raw,
        );
      cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
    }
    offsetDraftRef.current = null;
    useStore.getState().setSketchDistanceInput(null);
    useStore.getState().setSketchConstraintMode(null);
  };

  // Cancel.  For a freshly created offset, discard the whole thing via the
  // per-sketch undo (matching the extrude/chamfer "Cancel removes it" flow).
  // For an edit of an existing offset, the typed value was only live-previewed
  // (no history), so restore the prior distance instead of undoing.
  const cancelOffset = () => {
    const di = useStore.getState().sketchDistanceInput;
    offsetDraftRef.current = null;
    if (di?.created) {
      useStore.getState().undoSketch(selectedId);
    } else if (di) {
      useStore
        .getState()
        .previewSketchOffsetDistance(
          selectedId,
          di.offsetGroup,
          di.offsetConstraintIdx,
          di.defaultDistance,
        );
    }
    cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
    useStore.getState().setSketchDistanceInput(null);
    useStore.getState().setSketchConstraintMode(null);
  };

  if (!sketchMode || !sketchDistanceInput) return null;

  // What CHANGING this value does -- the field is reused for four different
  // constraints, and each one moves the sketch differently.
  const hint = sketchDistanceInput.cornerResize
    ? sketchDistanceInput.cornerResize.mode === "bevel"
      ? "Radius of the arc replacing the corner. Bigger rounds it more; negative curves the arc the other way."
      : "How far back from the corner each edge is cut. Bigger takes more off both lines."
    : sketchDistanceInput.offsetConstraintIdx != null
      ? "Distance the offset copy sits from the original. Negative offsets inward, which shrinks a closed loop."
      : "Distance the constraint holds. Changing it re-solves the sketch and moves the geometry to suit.";

  return (
    <div className="sketch-distance-input-overlay" title={hint}>
      <span>
        {sketchDistanceInput.cornerResize
          ? sketchDistanceInput.cornerResize.mode === "bevel"
            ? "Radius (mm):"
            : "Setback (mm):"
          : sketchDistanceInput.offsetConstraintIdx != null
            ? "Offset (mm):"
            : sketchDistanceInput.constraintIdx != null
              ? "Edit distance (mm):"
              : "Distance (mm):"}
      </span>
      <FormulaInput
        type="text"
        autoFocus
        title={hint}
        variables={variables}
        // Remount when the target changes (e.g. line-length → parallel-line
        // gap) so the shown default reflects the new measurement.
        key={
          sketchDistanceInput.pointLine
            ? `pl-${sketchDistanceInput.pointLine.pointShapeIdx}-${sketchDistanceInput.pointLine.lineShapeIdx}`
            : sketchDistanceInput.cornerResize
              ? `cr-${sketchDistanceInput.cornerResize.shapeIdx}`
              : `d-${sketchDistanceInput.shapeAIdx}-${sketchDistanceInput.shapeBIdx}-${sketchDistanceInput.constraintIdx ?? "new"}`
        }
        defaultValue={
          typeof sketchDistanceInput.defaultDistance === "string"
            ? sketchDistanceInput.defaultDistance
            : (sketchDistanceInput.defaultDistance * MM_PER_UNIT).toFixed(2)
        }
        onChange={(e) => {
          // Offset edits update live as you type: re-solve the copies (no
          // history/undo churn) so the geometry follows the typed value.
          if (sketchDistanceInput.offsetConstraintIdx == null) return;
          const raw = e.target.value.trim();
          offsetDraftRef.current = raw;
          const mm = evaluateFormula(
            raw,
            variablesToMap(useStore.getState().variables),
          );
          if (Number.isFinite(mm) && mm !== 0)
            useStore
              .getState()
              .previewSketchOffsetDistance(
                selectedId,
                sketchDistanceInput.offsetGroup,
                sketchDistanceInput.offsetConstraintIdx,
                raw,
              );
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            const raw = e.target.value.trim();
            // Quick validation: evaluate the formula against the current
            // variable map to ensure it produces a positive number; if not,
            // bail without committing so the user can fix their input.
            const variablesMap = variablesToMap(useStore.getState().variables);
            const mm = evaluateFormula(raw, variablesMap);
            // Offset edit: Enter confirms (matching the Confirm button).
            if (sketchDistanceInput.offsetConstraintIdx != null) {
              offsetDraftRef.current = raw;
              confirmOffset();
              return;
            }
            // Chamfer/bevel resize: apply the new setback / radius.  A
            // negative bevel radius is allowed (flips the arc); a chamfer
            // stays positive.
            if (sketchDistanceInput.cornerResize) {
              const allowNeg =
                sketchDistanceInput.cornerResize.mode === "bevel";
              if (Number.isFinite(mm) && (allowNeg ? mm !== 0 : mm > 0)) {
                const { sketchId, shapeIdx } = sketchDistanceInput.cornerResize;
                useStore
                  .getState()
                  .resizeSketchCorner(sketchId, shapeIdx, mm, raw);
                cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
              }
              useStore.getState().setSketchDistanceInput(null);
              useStore.getState().setSketchConstraintMode(null);
              return;
            }
            // Point-to-line perpendicular distance.  Staged solve in pick
            // order: the point's shape moves first, then also the line,
            // then the whole sketch.
            if (sketchDistanceInput.pointLine) {
              if (Number.isFinite(mm) && mm > 0) {
                const { pointShapeIdx, pointKey, lineShapeIdx } =
                  sketchDistanceInput.pointLine;
                const { constraintIdx } = sketchDistanceInput;
                const formula = raw;
                const store = useStore.getState();
                const freshItem = store.items.find((i) => i.id === selectedId);
                if (freshItem) {
                  const newC = {
                    type: "pointLineDistance",
                    pointShapeIdx,
                    pointKey,
                    lineShapeIdx,
                    distance: formula,
                  };
                  const proposed =
                    constraintIdx != null
                      ? (freshItem.constraints || []).map((c, i) =>
                          i === constraintIdx && c.type === "pointLineDistance"
                            ? { ...c, distance: formula }
                            : c,
                        )
                      : [...(freshItem.constraints || []), newC];
                  const stagedFixed = (freeIdxs) => {
                    const freeSet = new Set(freeIdxs);
                    const fixed = new Set();
                    freshItem.shapes.forEach((sh, i) => {
                      if (freeSet.has(i)) return;
                      for (const f of varFields(sh)) fixed.add(`${i}:${f}`);
                    });
                    return fixed;
                  };
                  let solved = null;
                  for (const free of [
                    [pointShapeIdx],
                    [pointShapeIdx, lineShapeIdx],
                    null,
                  ]) {
                    const res = solveConstraints(freshItem.shapes, proposed, {
                      variables: variablesMap,
                      ...(free ? { fixed: stagedFixed(free) } : {}),
                    });
                    if (res.ok) {
                      solved = res.shapes;
                      break;
                    }
                  }
                  if (solved) {
                    if (constraintIdx != null)
                      store.updateSketchConstraintDistance(
                        selectedId,
                        constraintIdx,
                        formula,
                      );
                    else store.addSketchConstraints(selectedId, [newC]);
                    const map = new Map();
                    solved.forEach((sh, i) => map.set(i, sh));
                    store.updateSketchShapes(selectedId, map);
                    itemsRef.current = useStore.getState().items;
                  } else {
                    store.showNotification(
                      "Can't apply that dimension — it would break another constraint",
                    );
                  }
                }
              }
              cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
              useStore.getState().setSketchDistanceInput(null);
              useStore.getState().setSketchConstraintMode(null);
              return;
            }
            if (Number.isFinite(mm) && mm > 0) {
              const { shapeAIdx, pointA, shapeBIdx, pointB, constraintIdx } =
                sketchDistanceInput;
              // Store the formula string so future edits can reference
              // variables; the solver resolves it to scene units.
              const formula = raw;
              const store = useStore.getState();
              const freshItem = store.items.find((i) => i.id === selectedId);
              const newDistC = {
                type: "distance",
                shapeAIdx,
                pointA,
                shapeBIdx,
                pointB,
                distance: formula,
              };
              // Resolve the change in-memory FIRST and only commit it if the
              // result keeps every constraint satisfied — otherwise the
              // transformation is rejected rather than distorting geometry.
              const proposed =
                constraintIdx != null
                  ? (freshItem?.constraints || []).map((c, i) =>
                      i === constraintIdx && c.type === "distance"
                        ? { ...c, distance: formula }
                        : c,
                    )
                  : [...(freshItem?.constraints || []), newDistC];
              if (freshItem) {
                // Numerically solve the WHOLE constraint system for the new
                // dimension.  Anchor the dimension's endpoints so the change
                // grows from the reference point WITHOUT rotating: for a
                // line-length the far end is pinned along the current
                // direction (pins translation + orientation); a two-point
                // distance pins only the reference end.  Reject if the result
                // can't satisfy every constraint.
                const d = mm / MM_PER_UNIT;
                const fixedSet = new Set();
                const aShape = freshItem.shapes[shapeAIdx];
                for (const f of fieldsForPoint(aShape, pointA))
                  fixedSet.add(`${shapeAIdx}:${f}`);
                let inputShapes = freshItem.shapes;
                if (shapeAIdx === shapeBIdx) {
                  const pA = getShapePoint(aShape, pointA);
                  const pB = getShapePoint(aShape, pointB);
                  if (pA && pB) {
                    const dx = pB.x - pA.x,
                      dy = pB.y - pA.y;
                    const cur = Math.hypot(dx, dy) || 1;
                    inputShapes = freshItem.shapes.slice();
                    inputShapes[shapeBIdx] = moveShapePoint(aShape, pointB, {
                      x: pA.x + (dx / cur) * d,
                      y: pA.y + (dy / cur) * d,
                    });
                    for (const f of fieldsForPoint(aShape, pointB))
                      fixedSet.add(`${shapeBIdx}:${f}`);
                  }
                }
                const { shapes: solved, ok } = solveConstraints(
                  inputShapes,
                  proposed,
                  { variables: variablesMap, fixed: fixedSet },
                );
                if (ok) {
                  if (constraintIdx != null)
                    store.updateSketchConstraintDistance(
                      selectedId,
                      constraintIdx,
                      formula,
                    );
                  else store.addSketchConstraints(selectedId, [newDistC]);
                  const map = new Map();
                  solved.forEach((s, i) => map.set(i, s));
                  store.updateSketchShapes(selectedId, map);
                  itemsRef.current = useStore.getState().items;
                } else {
                  store.showNotification(
                    "Can't apply that dimension — it would break another constraint",
                  );
                }
              }
            }
            // The line just moved to satisfy the new dimension; re-anchor
            // the green selection highlight (a standalone scene mesh) so it
            // doesn't linger at the old position.
            cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
            useStore.getState().setSketchDistanceInput(null);
            useStore.getState().setSketchConstraintMode(null);
          } else if (e.key === "Escape") {
            // Offset: Escape cancels the whole offset (matching Cancel);
            // a plain dimension edit just closes.
            if (sketchDistanceInput.offsetConstraintIdx != null) {
              cancelOffset();
              return;
            }
            useStore.getState().setSketchDistanceInput(null);
            useStore.getState().setSketchConstraintMode(null);
          }
        }}
      />
      {sketchDistanceInput.offsetConstraintIdx != null && (
        <>
          <button
            type="button"
            onClick={cancelOffset}
            title="Cancel — discard the offset"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              marginLeft: 8,
              borderRadius: 3,
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmOffset}
            title="Confirm — keep the offset at this distance"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              marginLeft: 8,
              borderRadius: 3,
              border: "1px solid var(--accent, #4488ff)",
              background: "var(--accent, #4488ff)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Confirm
          </button>
        </>
      )}
    </div>
  );
}
