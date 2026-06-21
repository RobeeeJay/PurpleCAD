import React from "react";
import { useStore } from "../store";
import { NumberInput } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

// App settings: perspective field of view + snap-to-grid interval / angle.
// Values are live (no Save button) and persist via the store.
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
  const previewPrecisionMm = useStore((s) => s.previewPrecisionMm);
  const setPreviewPrecisionMm = useStore((s) => s.setPreviewPrecisionMm);
  const printPrecisionMm = useStore((s) => s.printPrecisionMm);
  const setPrintPrecisionMm = useStore((s) => s.setPrintPrecisionMm);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const widgetVisible = useStore((s) => s.widgetVisible);
  const toggleWidgetVisibility = useStore((s) => s.toggleWidgetVisibility);
  const alwaysExtrudeSingleObject = useStore(
    (s) => s.alwaysExtrudeSingleObject,
  );
  const setAlwaysExtrudeSingleObject = useStore(
    (s) => s.setAlwaysExtrudeSingleObject,
  );
  const resetSettings = useStore((s) => s.resetSettings);
  const setAboutDialogOpen = useStore((s) => s.setAboutDialogOpen);

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
              <NumberInput
                min="5"
                max="90"
                step="1"
                value={fov}
                onCommit={(n, raw) => setFov(raw)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>&deg;</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap distance</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <NumberInput
                min="0.1"
                step="0.5"
                value={snapDistanceMm}
                onCommit={(n, raw) => setSnapDistanceMm(raw)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>mm</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap angle</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <NumberInput
                min="0.1"
                step="1"
                value={snapAngleDeg}
                onCommit={(n, raw) => setSnapAngleDeg(raw)}
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
              <NumberInput
                min="0"
                step="1"
                value={curveDetectionAngleDeg}
                onCommit={(n, raw) => setCurveDetectionAngleDeg(raw)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>&deg;</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Preview resolution</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                surface deviation while editing (lower = denser)
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <NumberInput
                min="0.001"
                step="0.05"
                value={previewPrecisionMm}
                onCommit={(n, raw) => setPreviewPrecisionMm(raw)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>mm</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Normal resolution</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                final density (the high-res toggle / 3D print)
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <NumberInput
                min="0.001"
                step="0.005"
                value={printPrecisionMm}
                onCommit={(n, raw) => setPrintPrecisionMm(raw)}
                onKeyDown={stop}
                style={numStyle}
              />
              <span style={{ fontSize: 10, opacity: 0.7 }}>mm</span>
            </span>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Dark mode</span>
            <button
              className="variables-btn"
              onClick={toggleTheme}
              style={{ minWidth: 56 }}
            >
              {theme === "dark" ? "On" : "Off"}
            </button>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Orientation widget</span>
            <button
              className="variables-btn"
              onClick={toggleWidgetVisibility}
              style={{ minWidth: 56 }}
            >
              {widgetVisible ? "On" : "Off"}
            </button>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Always extrude as single object</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                combine disjoint profiles (e.g. text glyphs) into one body
              </span>
            </span>
            <button
              className="variables-btn"
              onClick={() =>
                setAlwaysExtrudeSingleObject(!alwaysExtrudeSingleObject)
              }
              style={{ minWidth: 56 }}
            >
              {alwaysExtrudeSingleObject ? "On" : "Off"}
            </button>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Reset all settings</span>
            <button
              className="variables-btn"
              onClick={resetSettings}
              style={{ minWidth: 56 }}
            >
              Reset
            </button>
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>About PurpleCAD</span>
            <button
              className="variables-btn"
              onClick={() => setAboutDialogOpen(true)}
              style={{ minWidth: 56 }}
            >
              About
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
