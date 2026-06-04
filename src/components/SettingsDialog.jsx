import React from "react";
import { useStore } from "../store";
import "../styles/VariablesDialog.css";

// App settings: perspective field of view + snap-to-grid interval / angle.
// Values are live (no Save button) and persist to localStorage via the store.
const SettingsDialog = () => {
  const open = useStore((s) => s.settingsDialogOpen);
  const setOpen = useStore((s) => s.setSettingsDialogOpen);

  const fov = useStore((s) => s.fov);
  const setFov = useStore((s) => s.setFov);
  const snapDistanceMm = useStore((s) => s.snapDistanceMm);
  const setSnapDistanceMm = useStore((s) => s.setSnapDistanceMm);
  const snapAngleDeg = useStore((s) => s.snapAngleDeg);
  const setSnapAngleDeg = useStore((s) => s.setSnapAngleDeg);
  const curveDetectionAngleDeg = useStore((s) => s.curveDetectionAngleDeg);
  const setCurveDetectionAngleDeg = useStore(
    (s) => s.setCurveDetectionAngleDeg,
  );

  if (!open) return null;

  const close = () => setOpen(false);
  const stop = (e) => e.stopPropagation();

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "8px 0",
  };
  const labelStyle = {
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    color: "var(--text-secondary)",
  };
  const numStyle = {
    width: 64,
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border-color)",
    color: "var(--text-primary)",
    padding: "4px 6px",
    borderRadius: 3,
    fontFamily: "monospace",
    fontSize: 13,
    textAlign: "right",
  };

  return (
    <div className="variables-dialog-backdrop" onClick={close}>
      <div
        className="variables-dialog"
        style={{ minWidth: 380 }}
        onClick={stop}
      >
        <div className="variables-dialog-header">
          <h2>Settings</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Perspective (field of view)</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                lower = flatter, less perspective
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min="5"
                max="90"
                step="1"
                value={fov}
                onChange={(e) => setFov(e.target.value)}
                onKeyDown={stop}
              />
              <input
                type="number"
                min="5"
                max="90"
                step="1"
                value={fov}
                onChange={(e) => setFov(e.target.value)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>&deg;</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap distance</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={snapDistanceMm}
                onChange={(e) => setSnapDistanceMm(e.target.value)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>mm</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap angle</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                min="0.1"
                step="1"
                value={snapAngleDeg}
                onChange={(e) => setSnapAngleDeg(e.target.value)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>&deg;</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Curve detection</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                max bend between connected lines to highlight as one curve
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                min="0"
                step="1"
                value={curveDetectionAngleDeg}
                onChange={(e) => setCurveDetectionAngleDeg(e.target.value)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>&deg;</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
