// All of the conditional in-viewport hint banners and formula-input
// overlays that the previous monolithic Viewport.jsx rendered inline.
// Keeps Viewport.jsx focused on scene setup; this file owns the
// per-mode UI surface (sketch placement hints, extrude depth /
// distance overlays, sketch-mode close button).

import React from "react";
import FormulaInput from "../FormulaInput";
import { DebouncedNumberField } from "../inputs.jsx";
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
  solveConstraints,
  fieldsForPoint,
  varFields,
} from "../../three/sketchSolver.js";

export default function SketchOverlays({
  // store-derived state
  sketchPlacementMode,
  extrudeSelectMode,
  extrudeDepthInput,
  activeSketchTool,
  sketchDrawPhase,
  sketchMode,
  sketchConstraintMode,
  sketchMidpointFirst,
  sketchConstraintFirstPoint,
  sketchModifyMode,
  sketchDistanceInput,
  sketchMirrorState,
  sketchCircularPatternState,
  sketchRectangularPatternState,
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
  // Tracks which pattern-overlay fields currently hold an invalid / blank
  // value, so Confirm can be disabled until every field parses again.  Keyed
  // by field name; a field reports true (valid) on unmount so a closed tool
  // never leaves a stale block.
  const [patternInvalid, setPatternInvalid] = React.useState({});
  const reportPatternValid = React.useCallback(
    (key) => (valid) =>
      setPatternInvalid((prev) => {
        const blocked = !!prev[key];
        if (valid && blocked) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (!valid && !blocked) return { ...prev, [key]: true };
        return prev;
      }),
    [],
  );
  const anyPatternInvalid = Object.keys(patternInvalid).length > 0;

  // Commit the extrude at the typed distance (shared by Enter and the Confirm
  // button).  Distance is read from the input state — never from the mouse.
  const confirmExtrude = () => {
    const di = useStore.getState().extrudeDepthInput;
    if (!di) return;
    const raw =
      di.formula != null
        ? di.formula.trim()
        : String((di.currentDepth ?? di.defaultDepth) * MM_PER_UNIT);
    const mm = evaluateFormula(
      raw,
      variablesToMap(useStore.getState().variables),
    );
    if (!(Number.isFinite(mm) && mm !== 0)) return;
    const depth = mm / MM_PER_UNIT;
    // A non-numeric formula is stored as-is so variable edits re-resolve it;
    // a bare number goes through the numeric path.
    if (/^-?\d+(\.\d+)?$/.test(raw))
      cameraControlsRef.current?.finalizeExtrudeWithDepth?.(depth);
    else cameraControlsRef.current?.finalizeExtrudeWithFormula?.(raw, depth);
  };

  // Offset confirm/cancel — shared by the overlay buttons and Enter/Escape.
  // The latest typed value is tracked here so the Confirm button (which has no
  // event) can read it; onChange already live-previews it via the store.
  const offsetDraftRef = React.useRef(null);
  const sketchModifyDistMm = useStore((s) => s.sketchModifyDistMm);
  // Live draft of the chamfer/bevel value while typing (may be an incomplete
  // formula); the store only receives values that evaluate.
  const [modifyDraft, setModifyDraft] = React.useState(null);

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

  return (
    <>
      {sketchPlacementMode && (
        <div className="sketch-placement-hint">
          Click an axis plane or object face to place the sketch · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "profile" && (
        <div className="sketch-placement-hint">
          Click regions or faces to add / remove · set the distance below, then
          Confirm · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "start" && (
        <div className="sketch-placement-hint">
          Click a face or sketch plane to start the extrude from · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "profile" && extrudeDepthInput && (
        <div className="sketch-distance-input-overlay">
          <button
            type="button"
            onClick={() => {
              useStore.getState().setExtrudeDepthInput({
                ...extrudeDepthInput,
                cut: !extrudeDepthInput.cut,
              });
              // Recolour the preview (red for cut, blue for add) — there's no
              // mouse-driven rebuild to pick the change up otherwise.
              cameraControlsRef.current?.updateExtrudePreview?.(
                extrudeDepthInput.currentDepth ??
                  extrudeDepthInput.defaultDepth,
              );
            }}
            title="Cut — subtract this solid from the target instead of adding it"
            style={{
              fontSize: 11,
              padding: "2px 8px",
              marginRight: 8,
              borderRadius: 3,
              border: `1px solid ${
                extrudeDepthInput.cut ? "#e8754f" : "var(--border-color)"
              }`,
              background: extrudeDepthInput.cut
                ? "#e8754f"
                : "var(--bg-tertiary)",
              color: extrudeDepthInput.cut ? "#fff" : "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Cut
          </button>
          <button
            type="button"
            onClick={() => cameraControlsRef.current?.beginExtrudeStartPick?.()}
            title="Start from… — pick a face or sketch plane to offset where the extrude begins"
            style={{
              fontSize: 11,
              padding: "2px 6px",
              marginRight: 8,
              borderRadius: 3,
              border: "1px solid var(--border-color)",
              background: extrudeDepthInput.startOffset
                ? "var(--accent, #4488ff)"
                : "var(--bg-tertiary)",
              color: extrudeDepthInput.startOffset
                ? "#fff"
                : "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            {extrudeDepthInput.startOffset
              ? `Start ${extrudeDepthInput.startOffset > 0 ? "+" : ""}${(
                  extrudeDepthInput.startOffset * MM_PER_UNIT
                ).toFixed(1)}mm`
              : "Start from…"}
          </button>
          <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
            Offset:
          </span>
          <FormulaInput
            type="text"
            variables={variables}
            title="Offset the extrude start ± from the sketch plane (or the picked Start-from face)"
            // ± distance the prism base is slid along the profile normal.  A
            // bare number or a formula; negative slides the opposite way, 0
            // starts flush with the sketch plane / picked face.
            value={
              extrudeDepthInput.offsetFormula ??
              ((extrudeDepthInput.startOffset ?? 0) * MM_PER_UNIT).toFixed(2)
            }
            onChange={(e) => {
              const raw = e.target.value;
              const mm = evaluateFormula(
                raw,
                variablesToMap(useStore.getState().variables),
              );
              const valid = Number.isFinite(mm);
              const offset = valid
                ? mm / MM_PER_UNIT
                : (extrudeDepthInput.startOffset ?? 0);
              useStore.getState().setExtrudeDepthInput({
                ...extrudeDepthInput,
                offsetFormula: raw,
                startOffset: offset,
              });
              cameraControlsRef.current?.updateExtrudePreview?.(
                extrudeDepthInput.currentDepth ??
                  extrudeDepthInput.defaultDepth,
              );
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") confirmExtrude();
              else if (e.key === "Escape")
                cameraControlsRef.current?.cancelExtrude?.();
            }}
            style={{ width: 64, marginRight: 8 }}
          />
          <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
            Distance (mm):
          </span>
          <FormulaInput
            type="text"
            autoFocus
            variables={variables}
            // Accept either a bare number or a formula like "width * 2".
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
              // Live-update the preview prisms as the distance is typed.
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
              if (e.key === "Enter") confirmExtrude();
              else if (e.key === "Escape")
                // cancelExtrude clears BOTH the preview mesh and the store
                // state, then resets cursor / face highlights.
                cameraControlsRef.current?.cancelExtrude?.();
            }}
          />
          <button
            type="button"
            onClick={confirmExtrude}
            title="Confirm — create the extrude at this distance"
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
        </div>
      )}
      {activeSketchTool &&
        activeSketchTool !== "mirror" &&
        activeSketchTool !== "circularPattern" &&
        activeSketchTool !== "rectangularPattern" &&
        activeSketchTool !== "project" &&
        activeSketchTool !== "trim" &&
        sketchDrawPhase !== "second" && (
          <div className="sketch-placement-hint">
            Click to set the start point
          </div>
        )}
      {activeSketchTool === "trim" && (
        <div className="sketch-placement-hint">
          Click or drag over a line or a point · Esc to cancel
        </div>
      )}
      {activeSketchTool === "project" && (
        <div className="sketch-placement-hint">
          Click a 3D edge to project its connected edges, or drag a box to
          project everything inside · Esc to cancel
        </div>
      )}
      {sketchMode && activeSketchTool === "mirror" && sketchMirrorState && (
        <>
          {sketchMirrorState.lineIdx == null ? (
            <div className="sketch-placement-hint">
              Click a line to use as the mirror line · Esc to cancel
            </div>
          ) : (
            <>
              <div className="sketch-placement-hint">
                Click geometry to mirror, click again to remove · Esc to cancel
              </div>
              <div className="sketch-distance-input-overlay">
                <span>
                  Mirroring {sketchMirrorState.shapeIndices.length} item
                  {sketchMirrorState.shapeIndices.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => useStore.getState().reselectMirrorLine()}
                  title="Reselect — pick a different mirror line"
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
                  Reselect line
                </button>
                <button
                  type="button"
                  onClick={() => useStore.getState().cancelMirrorTool()}
                  title="Cancel — discard the mirror"
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
                  disabled={sketchMirrorState.shapeIndices.length === 0}
                  onClick={() => useStore.getState().confirmMirror(selectedId)}
                  title="Confirm — create the mirrored geometry"
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    marginLeft: 8,
                    borderRadius: 3,
                    border: "1px solid var(--accent, #4488ff)",
                    background: "var(--accent, #4488ff)",
                    color: "#fff",
                    cursor: "pointer",
                    opacity:
                      sketchMirrorState.shapeIndices.length === 0 ? 0.5 : 1,
                  }}
                >
                  Confirm
                </button>
              </div>
            </>
          )}
        </>
      )}
      {sketchMode &&
        activeSketchTool === "circularPattern" &&
        sketchCircularPatternState && (
          <>
            {sketchCircularPatternState.centerShapeIdx == null ? (
              <div className="sketch-placement-hint">
                Click a point to use as the pattern centre · Esc to cancel
              </div>
            ) : (
              <>
                <div className="sketch-placement-hint">
                  Click geometry to pattern, click again to remove · Esc to
                  cancel
                </div>
                <div className="sketch-distance-input-overlay">
                  <span>
                    Patterning {sketchCircularPatternState.shapeIndices.length}{" "}
                    item
                    {sketchCircularPatternState.shapeIndices.length === 1
                      ? ""
                      : "s"}
                  </span>
                  <label
                    style={{
                      marginLeft: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Instances per 360°
                    <DebouncedNumberField
                      min={2}
                      step={1}
                      storeValue={sketchCircularPatternState.count}
                      validate={(v) => Number.isFinite(v) && v >= 2}
                      onValidChange={reportPatternValid("circCount")}
                      commit={(v) =>
                        useStore.getState().setCircularPatternCount(v)
                      }
                      style={{
                        width: 48,
                        fontSize: 11,
                        padding: "2px 4px",
                        borderRadius: 3,
                        background: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      useStore.getState().reselectCircularPatternCenter()
                    }
                    title="Reselect — pick a different centre point"
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
                    Reselect point
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      useStore.getState().cancelCircularPatternTool()
                    }
                    title="Cancel — discard the circular pattern"
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
                  {(() => {
                    const blocked =
                      sketchCircularPatternState.shapeIndices.length === 0 ||
                      anyPatternInvalid;
                    return (
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() =>
                          useStore.getState().confirmCircularPattern(selectedId)
                        }
                        title="Confirm — create the patterned geometry"
                        style={{
                          fontSize: 11,
                          padding: "3px 10px",
                          marginLeft: 8,
                          borderRadius: 3,
                          border: "1px solid var(--accent, #4488ff)",
                          background: "var(--accent, #4488ff)",
                          color: "#fff",
                          cursor: blocked ? "not-allowed" : "pointer",
                          opacity: blocked ? 0.5 : 1,
                        }}
                      >
                        Confirm
                      </button>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}
      {sketchMode &&
        activeSketchTool === "rectangularPattern" &&
        sketchRectangularPatternState && (
          <>
            <div className="sketch-placement-hint">
              Click geometry to pattern, click again to remove · Esc to cancel
            </div>
            <div className="sketch-distance-input-overlay">
              <span>
                Patterning {sketchRectangularPatternState.shapeIndices.length}{" "}
                item
                {sketchRectangularPatternState.shapeIndices.length === 1
                  ? ""
                  : "s"}
              </span>
              <label
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Count X
                <DebouncedNumberField
                  min={1}
                  step={1}
                  variables={variables}
                  storeValue={sketchRectangularPatternState.countX}
                  validate={(v) => Number.isFinite(v) && v >= 1}
                  onValidChange={reportPatternValid("rectCountX")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternCountX(raw ?? v)
                  }
                  style={{
                    width: 44,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Offset X (mm)
                <DebouncedNumberField
                  step="any"
                  variables={variables}
                  storeValue={sketchRectangularPatternState.offsetX}
                  validate={(v) => Number.isFinite(v)}
                  onValidChange={reportPatternValid("rectOffsetX")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternOffsetX(raw ?? v)
                  }
                  style={{
                    width: 56,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Count Y
                <DebouncedNumberField
                  min={1}
                  step={1}
                  variables={variables}
                  storeValue={sketchRectangularPatternState.countY}
                  validate={(v) => Number.isFinite(v) && v >= 1}
                  onValidChange={reportPatternValid("rectCountY")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternCountY(raw ?? v)
                  }
                  style={{
                    width: 44,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Offset Y (mm)
                <DebouncedNumberField
                  step="any"
                  variables={variables}
                  storeValue={sketchRectangularPatternState.offsetY}
                  validate={(v) => Number.isFinite(v)}
                  onValidChange={reportPatternValid("rectOffsetY")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternOffsetY(raw ?? v)
                  }
                  style={{
                    width: 56,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  useStore.getState().cancelRectangularPatternTool()
                }
                title="Cancel — discard the rectangular pattern"
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
              {(() => {
                const blocked =
                  sketchRectangularPatternState.shapeIndices.length === 0 ||
                  anyPatternInvalid;
                return (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      useStore.getState().confirmRectangularPattern(selectedId)
                    }
                    title="Confirm — create the patterned geometry"
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      marginLeft: 8,
                      borderRadius: 3,
                      border: "1px solid var(--accent, #4488ff)",
                      background: "var(--accent, #4488ff)",
                      color: "#fff",
                      cursor: blocked ? "not-allowed" : "pointer",
                      opacity: blocked ? 0.5 : 1,
                    }}
                  >
                    Confirm
                  </button>
                );
              })()}
            </div>
          </>
        )}
      {sketchMode && sketchConstraintMode === "midpoint" && (
        <div className="sketch-placement-hint">
          {sketchMidpointFirst?.kind === "point"
            ? "Now click a line, arc or curve — the point pins to its middle · Esc to cancel"
            : sketchMidpointFirst?.kind === "target"
              ? "Now click a point — it pins to the middle · Esc to cancel"
              : "Click a point, then a line, arc or curve · Esc to cancel"}
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
              ? "Select a second point, or a line for a point-to-line distance · Esc to cancel"
              : "Click a line to set its length, or click two points · Esc to cancel"}
          </div>
        )}
      {/* A line-length dimension is pending — tell the user they can instead
          click a second parallel line for the perpendicular gap between them. */}
      {sketchMode &&
        sketchDistanceInput &&
        sketchDistanceInput.constraintIdx == null &&
        sketchDistanceInput.shapeAIdx != null &&
        sketchDistanceInput.shapeAIdx === sketchDistanceInput.shapeBIdx &&
        sketchDistanceInput.pointA === "start" &&
        sketchDistanceInput.pointB === "end" && (
          <div className="sketch-placement-hint">
            Set the length, or click a parallel line for the gap between them
          </div>
        )}
      {sketchMode && sketchDistanceInput && (
        <div className="sketch-distance-input-overlay">
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
                const variablesMap = variablesToMap(
                  useStore.getState().variables,
                );
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
                    const { sketchId, shapeIdx } =
                      sketchDistanceInput.cornerResize;
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
                    const freshItem = store.items.find(
                      (i) => i.id === selectedId,
                    );
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
                              i === constraintIdx &&
                              c.type === "pointLineDistance"
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
                        const res = solveConstraints(
                          freshItem.shapes,
                          proposed,
                          {
                            variables: variablesMap,
                            ...(free ? { fixed: stagedFixed(free) } : {}),
                          },
                        );
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
                  const {
                    shapeAIdx,
                    pointA,
                    shapeBIdx,
                    pointB,
                    constraintIdx,
                  } = sketchDistanceInput;
                  // Store the formula string so future edits can reference
                  // variables; the solver resolves it to scene units.
                  const formula = raw;
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
                        inputShapes[shapeBIdx] = moveShapePoint(
                          aShape,
                          pointB,
                          {
                            x: pA.x + (dx / cur) * d,
                            y: pA.y + (dy / cur) * d,
                          },
                        );
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
      )}
      {sketchMode &&
        sketchDistanceInput &&
        sketchDistanceInput.offsetConstraintIdx != null && (
          <div className="sketch-placement-hint">
            Set the offset distance, then Confirm · Esc to cancel
          </div>
        )}
      {sketchMode &&
        sketchDistanceInput &&
        sketchDistanceInput.cornerResize && (
          <div className="sketch-placement-hint">
            {sketchDistanceInput.cornerResize.mode === "bevel"
              ? "Type a new radius, then Enter"
              : "Type a new setback, then Enter"}{" "}
            · Esc to cancel
          </div>
        )}
      {sketchMode && sketchModifyMode && (
        <>
          <div className="sketch-placement-hint">
            {sketchModifyMode === "chamfer"
              ? "Click a corner between two lines to chamfer"
              : "Click a corner between two lines to bevel"}{" "}
            · Esc to cancel
          </div>
          {!sketchDistanceInput && (
            <div className="sketch-distance-input-overlay">
              <span>
                {sketchModifyMode === "chamfer" ? "Chamfer" : "Bevel"}
              </span>
              <label
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {sketchModifyMode === "chamfer"
                  ? "Setback (mm)"
                  : "Radius (mm)"}
                <FormulaInput
                  type="text"
                  key={sketchModifyMode}
                  variables={variables}
                  title={
                    sketchModifyMode === "bevel"
                      ? "A number in mm (negative flips the arc), or a formula"
                      : "A number in mm, or a formula over the document variables"
                  }
                  value={modifyDraft ?? String(sketchModifyDistMm)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setModifyDraft(raw);
                    const mm = evaluateFormula(
                      raw,
                      variablesToMap(useStore.getState().variables),
                    );
                    const allowNeg = sketchModifyMode === "bevel";
                    if (Number.isFinite(mm) && (allowNeg ? mm !== 0 : mm > 0))
                      useStore.getState().setSketchModifyDistMm(raw.trim());
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  onBlur={() => setModifyDraft(null)}
                  style={{
                    width: 90,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => useStore.getState().setSketchModifyMode(null)}
                title={
                  sketchModifyMode === "chamfer"
                    ? "Done — leave the chamfer tool"
                    : "Done — leave the bevel tool"
                }
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
                Done
              </button>
            </div>
          )}
        </>
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
