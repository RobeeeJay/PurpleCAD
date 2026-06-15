import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue } from "./inputs.jsx";
import { applyPlaneAdjust } from "../three/planeFrame.js";
import { maxItemId } from "../store/internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

// Create a Plane object from a base frame (a selected sketch's plane, or the
// default XY), adjusting its rotation (degrees per axis) and an offset along the
// plane normal, with a live preview.  Confirm adds a `plane` item.
const PlaneDialog = () => {
  const planeTool = useStore((s) => s.planeTool);
  const cancelPlaneTool = useStore((s) => s.cancelPlaneTool);
  const updatePlaneTool = useStore((s) => s.updatePlaneTool);
  const setPlanePickActive = useStore((s) => s.setPlanePickActive);
  const variables = useStore((s) => s.variables);
  const addItem = useStore((s) => s.addItem);

  const [rx, setRx] = useState("0");
  const [ry, setRy] = useState("0");
  const [rz, setRz] = useState("0");
  const [offset, setOffset] = useState("0");

  const open = !!planeTool?.base;

  useEffect(() => {
    if (open) {
      setRx("0");
      setRy("0");
      setRz("0");
      setOffset("0");
    }
  }, [open]);

  const rxv = evalValue(rx, variables);
  const ryv = evalValue(ry, variables);
  const rzv = evalValue(rz, variables);
  const offv = evalValue(offset, variables);
  const valid =
    Number.isFinite(rxv) &&
    Number.isFinite(ryv) &&
    Number.isFinite(rzv) &&
    Number.isFinite(offv);

  const finalFrame = () =>
    applyPlaneAdjust(
      planeTool.base,
      { x: rxv, y: ryv, z: rzv },
      // Offset is entered in mm; the scene works in scene units.
      offv / MM_PER_UNIT,
    );

  // Live preview as the values change.
  useEffect(() => {
    if (!open) return;
    const cc = useStore.getState()._cameraControls;
    if (valid) cc?.previewPlane?.(finalFrame());
    return () => useStore.getState()._cameraControls?.clearPlanePreview?.();
  }, [open, valid, rxv, ryv, rzv, offv]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelPlaneTool();
  };
  const confirm = () => {
    if (!valid) return;
    const { position, rotation } = finalFrame();
    const id = maxItemId(useStore.getState().history) + 1;
    addItem({
      id,
      name: `Plane ${id}`,
      type: "plane",
      children: [],
      position,
      rotation,
      scale: { x: 1, y: 1, z: 1 },
    });
    useStore.getState().selectItem?.(id);
    close();
  };

  const field = (ok) => ({
    background: "var(--bg-tertiary)",
    border: `1px solid ${ok ? "var(--border-color)" : "#e87575"}`,
    color: "var(--text-primary)",
    padding: "6px 8px",
    borderRadius: 3,
    fontFamily: "monospace",
    fontSize: 13,
    width: 80,
  });
  const row = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-secondary)",
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  // Swap the base frame to a world axis-plane (resetting the rotation deltas).
  const setBase = (rotation) => {
    updatePlaneTool({ base: { position: { x: 0, y: 0, z: 0 }, rotation } });
    setRx("0");
    setRy("0");
    setRz("0");
    setOffset("0");
  };
  const startPick = (mode) => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelPlaneTool();
    setPlanePickActive(mode);
  };
  const baseBtn = {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 3,
    border: "1px solid var(--border-color)",
    background: "var(--bg-tertiary)",
    color: "var(--text-primary)",
    cursor: "pointer",
  };

  return (
    <div
      className="variables-dialog-backdrop"
      style={{
        background: "transparent",
        alignItems: "flex-end",
        paddingBottom: 72,
        pointerEvents: "none",
      }}
    >
      <div
        className="variables-dialog"
        style={{ minWidth: 320, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Create plane</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Cancel"
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginRight: 2,
              }}
            >
              Base:
            </span>
            <button
              type="button"
              style={baseBtn}
              onClick={() => setBase({ x: 0, y: 0, z: 0 })}
            >
              XY
            </button>
            <button
              type="button"
              style={baseBtn}
              onClick={() => setBase({ x: -Math.PI / 2, y: 0, z: 0 })}
            >
              XZ
            </button>
            <button
              type="button"
              style={baseBtn}
              onClick={() => setBase({ x: 0, y: Math.PI / 2, z: 0 })}
            >
              YZ
            </button>
            <button
              type="button"
              style={baseBtn}
              onClick={() => startPick("points")}
            >
              Pick 3 points
            </button>
            <button
              type="button"
              style={baseBtn}
              onClick={() => startPick("face")}
            >
              Select face
            </button>
          </div>
          <label style={row}>
            <span>Rotate X (°)</span>
            <FormulaInput
              variables={variables}
              autoFocus
              value={rx}
              onChange={(e) => setRx(e.target.value)}
              onKeyDown={onKey}
              style={field(Number.isFinite(rxv))}
            />
          </label>
          <label style={row}>
            <span>Rotate Y (°)</span>
            <FormulaInput
              variables={variables}
              value={ry}
              onChange={(e) => setRy(e.target.value)}
              onKeyDown={onKey}
              style={field(Number.isFinite(ryv))}
            />
          </label>
          <label style={row}>
            <span>Rotate Z (°)</span>
            <FormulaInput
              variables={variables}
              value={rz}
              onChange={(e) => setRz(e.target.value)}
              onKeyDown={onKey}
              style={field(Number.isFinite(rzv))}
            />
          </label>
          <label style={row}>
            <span>Offset (mm)</span>
            <FormulaInput
              variables={variables}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              onKeyDown={onKey}
              style={field(Number.isFinite(offv))}
            />
          </label>
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={close}>
              Cancel
            </button>
            <button
              className="variables-btn primary"
              disabled={!valid}
              onClick={confirm}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaneDialog;
