// All of the conditional in-viewport hint banners and formula-input
// overlays that the previous monolithic Viewport.jsx rendered inline.
// Keeps Viewport.jsx focused on scene setup; this file owns the
// per-mode UI surface (sketch placement hints, extrude depth /
// distance overlays, sketch-mode close button).

import React from "react";
import FormulaInput from "../FormulaInput";
import SketchRulers from "./SketchRulers";
import SketchLongPressMenu from "./SketchLongPressMenu";
import { useStore } from "../../store";
import { evaluateFormula, variablesToMap } from "../../utils/formulas.js";
import {
  MM_PER_UNIT,
  getShapePoint,
  moveShapePoint,
} from "../../three/sceneObjects.js";
import {
  enforceConstraints,
  allConstraintsSatisfied,
} from "../../three/sketchConstraints.js";

export default function SketchOverlays({
  // store-derived state
  sketchPlacementMode,
  extrudeSelectMode,
  extrudeDepthInput,
  activeSketchTool,
  sketchDrawPhase,
  sketchMode,
  sketchConstraintMode,
  sketchConstraintFirstPoint,
  sketchModifyMode,
  sketchDistanceInput,
  isInSketchMode,
  selectedId,
  variables,
  // refs / callbacks that hand control back to the camera-controls layer
  cameraControlsRef,
  cameraRef,
  rendererRef,
  objectsRef,
  dimHintRef,
  itemsRef,
  propagateConstraintsRef,
  selectItem,
}) {
  return (
    <>
      {sketchPlacementMode && (
        <div className="sketch-placement-hint">
          Click an axis plane or object face to place the sketch · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "profile" && (
        <div className="sketch-placement-hint">
          Click an enclosed sketch region or flat object face · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "depth" && (
        <div className="sketch-placement-hint">
          Move mouse to set depth, or type below · Click to confirm · Esc to
          cancel
        </div>
      )}
      {extrudeSelectMode === "depth" && extrudeDepthInput && (
        <div className="sketch-distance-input-overlay">
          <span>Depth (mm):</span>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "#aaa",
              marginRight: 8,
            }}
            title="Cut extrusion — subtract this solid from the target instead of adding it"
          >
            <input
              type="checkbox"
              checked={!!extrudeDepthInput.cut}
              onChange={(e) => {
                useStore.getState().setExtrudeDepthInput({
                  ...extrudeDepthInput,
                  cut: e.target.checked,
                });
              }}
            />
            Cut
          </label>
          <FormulaInput
            type="text"
            autoFocus
            variables={variables}
            // Accept either a bare number or a formula like "width * 2".
            // The mouse-drag path clears `formula` and updates `currentDepth`
            // so the field reverts to a numeric mm value as the user drags;
            // typing replaces both with the user's text and its evaluation.
            value={
              extrudeDepthInput.formula ??
              (
                (extrudeDepthInput.currentDepth ??
                  extrudeDepthInput.defaultDepth) * MM_PER_UNIT
              ).toFixed(2)
            }
            onChange={(e) => {
              const raw = e.target.value;
              const variablesMap = variablesToMap(
                useStore.getState().variables,
              );
              const mm = evaluateFormula(raw, variablesMap);
              // Allow negative depths (extrude backward from the sketch
              // plane).  Reject only zero / NaN.
              const validNum = Number.isFinite(mm) && mm !== 0;
              const depth = validNum ? mm / MM_PER_UNIT : undefined;
              if (validNum) {
                cameraControlsRef.current?.updateExtrudePreview?.(depth);
              }
              useStore.getState().setExtrudeDepthInput({
                ...extrudeDepthInput,
                formula: raw,
                currentDepth: validNum ? depth : extrudeDepthInput.currentDepth,
              });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const raw = e.target.value.trim();
                const variablesMap = variablesToMap(
                  useStore.getState().variables,
                );
                const mm = evaluateFormula(raw, variablesMap);
                if (Number.isFinite(mm) && mm !== 0) {
                  const depth = mm / MM_PER_UNIT;
                  // If the user typed a non-numeric formula, preserve it as
                  // the stored value; otherwise the bare numeric path
                  // (formatAsFormula) handles it inside finalizeExtrude.
                  const isFormula = !/^-?\d+(\.\d+)?$/.test(raw);
                  if (isFormula) {
                    cameraControlsRef.current?.finalizeExtrudeWithFormula?.(
                      raw,
                      depth,
                    );
                  } else {
                    cameraControlsRef.current?.finalizeExtrudeWithDepth?.(
                      depth,
                    );
                  }
                }
              } else if (e.key === "Escape") {
                // cancelExtrude clears BOTH the preview mesh and the
                // store state, then resets cursor / face highlights —
                // the store-only path would leave the preview hovering
                // in the scene.
                cameraControlsRef.current?.cancelExtrude?.();
              }
            }}
          />
        </div>
      )}
      {activeSketchTool && sketchDrawPhase !== "second" && (
        <div className="sketch-placement-hint">
          Click to set the start point
        </div>
      )}
      {sketchMode && sketchConstraintMode === "coincident" && (
        <div className="sketch-placement-hint">
          {sketchConstraintFirstPoint
            ? "Select second point · Esc to cancel"
            : "Select a point · Esc to cancel"}
        </div>
      )}
      {sketchMode &&
        sketchConstraintMode === "distance" &&
        !sketchDistanceInput && (
          <div className="sketch-placement-hint">
            {sketchConstraintFirstPoint
              ? "Select second point · Esc to cancel"
              : "Click a line to set its length, or click two points · Esc to cancel"}
          </div>
        )}
      {sketchMode && sketchDistanceInput && (
        <div className="sketch-distance-input-overlay">
          <span>
            {sketchDistanceInput.constraintIdx != null
              ? "Edit distance (mm):"
              : "Distance (mm):"}
          </span>
          <FormulaInput
            type="text"
            autoFocus
            variables={variables}
            defaultValue={
              typeof sketchDistanceInput.defaultDistance === "string"
                ? sketchDistanceInput.defaultDistance
                : (sketchDistanceInput.defaultDistance * MM_PER_UNIT).toFixed(2)
            }
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const raw = e.target.value.trim();
                // Quick validation: evaluate the formula against the current
                // variable map to ensure it produces a positive number; if not,
                // bail without committing so the user can fix their input.
                const variablesMap = variablesToMap(
                  useStore.getState().variables,
                );
                const mm = evaluateFormula(raw, variablesMap);
                if (Number.isFinite(mm) && mm > 0) {
                  const {
                    shapeAIdx,
                    pointA,
                    shapeBIdx,
                    pointB,
                    constraintIdx,
                  } = sketchDistanceInput;
                  // Store the formula string so future edits can reference
                  // variables; geometry resolution converts mm → scene units.
                  const formula = raw;
                  const d = mm / MM_PER_UNIT;
                  const store = useStore.getState();
                  const freshItem = store.items.find(
                    (i) => i.id === selectedId,
                  );
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
                  const sA = freshItem?.shapes[shapeAIdx];
                  const sB = freshItem?.shapes[shapeBIdx];
                  const pA = sA && getShapePoint(sA, pointA);
                  const pB = sB && getShapePoint(sB, pointB);
                  let movedSB = null;
                  if (pA && pB) {
                    const ddx = pB.x - pA.x,
                      ddy = pB.y - pA.y;
                    const cur = Math.hypot(ddx, ddy);
                    if (cur > 1e-10)
                      movedSB = moveShapePoint(sB, pointB, {
                        x: pA.x + (ddx / cur) * d,
                        y: pA.y + (ddy / cur) * d,
                      });
                  }
                  if (freshItem && movedSB) {
                    const updatedMap = enforceConstraints(
                      freshItem.shapes,
                      proposed,
                      shapeBIdx,
                      movedSB,
                      pointB,
                    );
                    const resultShapes = freshItem.shapes.slice();
                    for (const [i, s] of updatedMap) resultShapes[i] = s;
                    if (
                      allConstraintsSatisfied(
                        resultShapes,
                        proposed,
                        variablesMap,
                      )
                    ) {
                      if (constraintIdx != null)
                        store.updateSketchConstraintDistance(
                          selectedId,
                          constraintIdx,
                          formula,
                        );
                      else store.addSketchConstraints(selectedId, [newDistC]);
                      store.updateSketchShapes(selectedId, updatedMap);
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
                useStore.getState().setSketchDistanceInput(null);
                useStore.getState().setSketchConstraintMode(null);
              }
            }}
          />
        </div>
      )}
      {sketchMode && sketchModifyMode && (
        <div className="sketch-placement-hint">
          {sketchModifyMode === "chamfer"
            ? "Click a corner between two lines to chamfer"
            : "Click a corner between two lines to bevel"}{" "}
          · Esc to cancel
        </div>
      )}
      <div
        ref={dimHintRef}
        className="sketch-dim-overlay"
        style={{ display: "none" }}
      />
      <SketchLongPressMenu cameraControlsRef={cameraControlsRef} />
      <SketchRulers
        active={isInSketchMode}
        cameraRef={cameraRef}
        rendererRef={rendererRef}
        objectsRef={objectsRef}
        selectedId={selectedId}
      />
      {isInSketchMode && (
        <button
          className="close-sketch-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            selectItem(null);
          }}
        >
          ✕ Close Sketch
        </button>
      )}
    </>
  );
}
