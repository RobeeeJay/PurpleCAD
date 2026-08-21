// All of the conditional in-viewport hint banners and formula-input
// overlays that the previous monolithic Viewport.jsx rendered inline.
// Keeps Viewport.jsx focused on scene setup; this file owns the
// per-mode UI surface (sketch placement hints, extrude depth /
// distance overlays, sketch-mode close button).

import React from "react";
import FormulaInput from "../FormulaInput";
import SketchRulers from "./SketchRulers";
import SketchLongPressMenu from "./SketchLongPressMenu";
import SketchDistanceOverlay from "./SketchDistanceOverlay";
import SketchPatternOverlays from "./SketchPatternOverlays";
import { useStore } from "../../store";
import { evaluateFormula, variablesToMap } from "../../utils/formulas.js";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";

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

  const sketchModifyDistMm = useStore((s) => s.sketchModifyDistMm);
  // Live draft of the chamfer/bevel value while typing (may be an incomplete
  // formula); the store only receives values that evaluate.
  const [modifyDraft, setModifyDraft] = React.useState(null);

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
      <SketchPatternOverlays
        sketchMode={sketchMode}
        activeSketchTool={activeSketchTool}
        sketchMirrorState={sketchMirrorState}
        sketchCircularPatternState={sketchCircularPatternState}
        sketchRectangularPatternState={sketchRectangularPatternState}
        selectedId={selectedId}
        variables={variables}
      />
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
      <SketchDistanceOverlay
        sketchMode={sketchMode}
        sketchDistanceInput={sketchDistanceInput}
        selectedId={selectedId}
        variables={variables}
        itemsRef={itemsRef}
        cameraControlsRef={cameraControlsRef}
      />
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
