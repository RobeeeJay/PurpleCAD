// All of the conditional in-viewport hint banners and formula-input
// overlays that the previous monolithic Viewport.jsx rendered inline.
// Keeps Viewport.jsx focused on scene setup; this file owns the
// per-mode UI surface (sketch placement hints, extrude depth /
// distance overlays, sketch-mode close button).

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import FormulaInput from "../FormulaInput";
import { useStore } from "../../store";
import { evaluateFormula, variablesToMap } from "../../utils/formulas.js";
import {
  MM_PER_UNIT,
  getShapePoint,
  moveShapePoint,
} from "../../three/sceneObjects.js";

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
                  if (constraintIdx != null) {
                    useStore
                      .getState()
                      .updateSketchConstraintDistance(
                        selectedId,
                        constraintIdx,
                        formula,
                      );
                  } else {
                    useStore.getState().addSketchConstraints(selectedId, [
                      {
                        type: "distance",
                        shapeAIdx,
                        pointA,
                        shapeBIdx,
                        pointB,
                        distance: formula,
                      },
                    ]);
                  }
                  // Enforce the new/changed distance immediately.
                  // Key: use B (the shape being moved) as the primary, not A.
                  // Using A as primary causes the coincident BFS to mark B as "updated"
                  // before the distance enforcement pass runs, which makes it skip.
                  itemsRef.current = useStore.getState().items;
                  if (propagateConstraintsRef.current) {
                    const freshItem = itemsRef.current.find(
                      (i) => i.id === selectedId,
                    );
                    if (freshItem) {
                      if (shapeAIdx === shapeBIdx) {
                        // Same shape: line-length — keep pointA end fixed, slide pointB end.
                        const shape = freshItem.shapes[shapeAIdx];
                        if (shape) {
                          const pA = getShapePoint(shape, pointA);
                          const pB = getShapePoint(shape, pointB);
                          if (pA && pB) {
                            const ddx = pB.x - pA.x,
                              ddy = pB.y - pA.y;
                            const curLen = Math.hypot(ddx, ddy);
                            if (curLen > 1e-10) {
                              const newEnd = {
                                x: pA.x + (ddx / curLen) * d,
                                y: pA.y + (ddy / curLen) * d,
                              };
                              const newShape = moveShapePoint(
                                shape,
                                pointB,
                                newEnd,
                              );
                              if (newShape) {
                                const propagated =
                                  propagateConstraintsRef.current(
                                    selectedId,
                                    shapeAIdx,
                                    newShape,
                                    pointB,
                                  );
                                if (propagated.size > 1)
                                  useStore
                                    .getState()
                                    .updateSketchShapes(selectedId, propagated);
                                else
                                  useStore
                                    .getState()
                                    .updateSketchShape(
                                      selectedId,
                                      shapeAIdx,
                                      newShape,
                                    );
                              }
                            }
                          }
                        }
                      } else {
                        // Two shapes: keep A fixed, move B's constrained point to distance d from A.
                        const sA = freshItem.shapes[shapeAIdx];
                        const sB = freshItem.shapes[shapeBIdx];
                        if (sA && sB) {
                          const pA = getShapePoint(sA, pointA);
                          const pB = getShapePoint(sB, pointB);
                          if (pA && pB) {
                            const ddx = pB.x - pA.x,
                              ddy = pB.y - pA.y;
                            const curDist = Math.hypot(ddx, ddy);
                            if (curDist > 1e-10) {
                              const newPt = {
                                x: pA.x + (ddx / curDist) * d,
                                y: pA.y + (ddy / curDist) * d,
                              };
                              const newSB = moveShapePoint(sB, pointB, newPt);
                              if (newSB) {
                                const propagated =
                                  propagateConstraintsRef.current(
                                    selectedId,
                                    shapeBIdx,
                                    newSB,
                                    pointB,
                                  );
                                if (propagated.size > 1)
                                  useStore
                                    .getState()
                                    .updateSketchShapes(selectedId, propagated);
                                else
                                  useStore
                                    .getState()
                                    .updateSketchShape(
                                      selectedId,
                                      shapeBIdx,
                                      newSB,
                                    );
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
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

// Screen-locked rulers for sketch mode.  Two canvas strips (bottom = sketch
// local X, left = sketch local Y) pinned to the viewport edges; labels show the
// mm offset from the sketch origin and update live as the user pans / zooms.
const RULER_W = 44; // left strip width (px) — keep in sync with Viewport.css
const RULER_H = 22; // bottom strip height (px)
const X_AXIS_COLOR = "#ff6666";
const Y_AXIS_COLOR = "#6699ff";
const RULER_INK = "#0055ff";

// Pick a "nice" major-tick step in mm (1/2/5 × 10ⁿ) ≈ targetPx apart on screen.
function niceStepMm(mmPerPx, targetPx) {
  const raw = mmPerPx * targetPx;
  if (!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const c of [1, 2, 5, 10]) if (c * pow >= raw) return c * pow;
  return 10 * pow;
}

// Draw one axis strip.  `origin` is the sketch-origin position along the axis
// (container px), `perUnit` is px per local unit (signed), `lead` is the px
// offset between the canvas's 0 and the container's 0 (RULER_W for the bottom
// strip, 0 for the left strip).
function drawRulerStrip(canvas, orient, cssLen, perUnit, origin, lead, dpr) {
  const ctx = canvas.getContext("2d");
  const cw = orient === "h" ? cssLen : RULER_W;
  const ch = orient === "h" ? RULER_H : cssLen;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // Faint light wash instead of a solid dark strip: keeps the ruler light and
  // lets sketch lines passing under the edge bars stay visible.
  ctx.fillStyle = "rgba(170, 170, 170, 0.15)";
  ctx.fillRect(0, 0, cw, ch);

  const mmPerPx = MM_PER_UNIT / Math.abs(perUnit);
  const majorMm = niceStepMm(mmPerPx, 70);
  const minorLocal = majorMm / 5 / MM_PER_UNIT;
  // local coordinate at each end of the visible strip
  const locAt = (containerPos) => (containerPos - origin) / perUnit;
  const a = locAt(lead);
  const b = locAt(lead + cssLen);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const startN = Math.floor(lo / minorLocal);
  const endN = Math.ceil(hi / minorLocal);

  ctx.font = "10px monospace";
  ctx.lineWidth = 1;
  for (let n = startN; n <= endN; n++) {
    const localV = n * minorLocal;
    const pos = origin + localV * perUnit - lead; // px within the canvas
    if (pos < 0 || pos > cssLen) continue;
    const major = n % 5 === 0;
    const isOrigin = n === 0;
    const tick = major ? 10 : 5;
    ctx.strokeStyle = isOrigin
      ? orient === "h"
        ? X_AXIS_COLOR
        : Y_AXIS_COLOR
      : "rgb(64, 127, 253)";
    ctx.beginPath();
    if (orient === "h") {
      ctx.moveTo(pos, RULER_H);
      ctx.lineTo(pos, RULER_H - tick);
    } else {
      ctx.moveTo(RULER_W, pos);
      ctx.lineTo(RULER_W - tick, pos);
    }
    ctx.stroke();
    if (major) {
      ctx.fillStyle = isOrigin
        ? orient === "h"
          ? X_AXIS_COLOR
          : Y_AXIS_COLOR
        : RULER_INK;
      const mm = Math.round(localV * MM_PER_UNIT);
      if (orient === "h") {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(String(mm), pos, 2);
      } else {
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(String(mm), RULER_W - 12, pos);
      }
    }
  }
}

function SketchRulers({
  active,
  cameraRef,
  rendererRef,
  objectsRef,
  selectedId,
}) {
  const hRef = useRef(null);
  const vRef = useRef(null);
  const lastKey = useRef("");

  useEffect(() => {
    if (!active) return undefined;
    const scratch = new THREE.Vector3();
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cam = cameraRef.current;
      const renderer = rendererRef.current;
      const mesh = objectsRef.current?.[selectedId];
      const hCanvas = hRef.current;
      const vCanvas = vRef.current;
      if (!cam || !renderer || !mesh || !hCanvas || !vCanvas) return;
      const dom = renderer.domElement;
      const W = dom.clientWidth;
      const H = dom.clientHeight;
      if (W === 0 || H === 0) return;
      const dpr = window.devicePixelRatio || 1;

      const toScreen = (lx, ly) => {
        scratch
          .set(lx, ly, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position)
          .project(cam);
        return {
          x: ((scratch.x + 1) / 2) * W,
          y: ((-scratch.y + 1) / 2) * H,
        };
      };
      const O = toScreen(0, 0);
      const X = toScreen(1, 0);
      const Y = toScreen(0, 1);
      const ux = X.x - O.x; // px per local unit, horizontal
      const uy = Y.y - O.y; // px per local unit, vertical (usually negative)
      if (Math.abs(ux) < 1e-3 || Math.abs(uy) < 1e-3) return;

      // Skip redraw when the camera is idle (cheap change-detect).
      const key = `${W}|${H}|${O.x.toFixed(2)}|${O.y.toFixed(2)}|${ux.toFixed(4)}|${uy.toFixed(4)}`;
      if (key === lastKey.current) return;
      lastKey.current = key;

      drawRulerStrip(hCanvas, "h", W - RULER_W, ux, O.x, RULER_W, dpr);
      drawRulerStrip(vCanvas, "v", H, uy, O.y, 0, dpr);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, selectedId, cameraRef, rendererRef, objectsRef]);

  if (!active) return null;
  return (
    <>
      <canvas ref={hRef} className="sketch-ruler sketch-ruler-bottom" />
      <canvas ref={vRef} className="sketch-ruler sketch-ruler-left" />
    </>
  );
}

const KIND_COLORS = {
  point: "#aabbff",
  line: "#88aaff",
};

function SketchLongPressMenu({ cameraControlsRef }) {
  const menu = useStore((state) => state.sketchLongPressMenu);
  if (!menu) return null;

  const { x, y, items } = menu;

  const constraintHex = (color) =>
    `#${(color ?? 0xffaa00).toString(16).padStart(6, "0")}`;

  return (
    <div
      className="sketch-long-press-menu"
      style={{ left: x + 10, top: y + 10 }}
      onMouseLeave={() => cameraControlsRef.current?.clearMenuHighlight?.()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="sketch-long-press-menu-item"
          onMouseEnter={() =>
            cameraControlsRef.current?.highlightForMenu?.(item)
          }
          onClick={(e) => {
            e.stopPropagation();
            cameraControlsRef.current?.clearMenuHighlight?.();
            cameraControlsRef.current?.selectMenuItem?.(item);
            useStore.getState().setSketchLongPressMenu(null);
          }}
        >
          <span
            className="sketch-long-press-menu-dot"
            style={{
              background:
                item.kind === "constraint"
                  ? constraintHex(item.constraintColor)
                  : (KIND_COLORS[item.kind] ?? "#aaa"),
            }}
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}
