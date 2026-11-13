import { useEffect, useState } from "react";
import { useStore } from "../store";
import { NumberInput } from "./inputs.jsx";
import { claudeCodeCommand, claudeDesktopConfig } from "../api/mcpConfig.js";
import "../styles/VariablesDialog.css";

// The agent API (MCP) switch.  Its own component so its hooks run only while
// the dialog is open -- below the dialog's early return they would blank the
// app.  Hidden where the host has no agent API (the iPad, a plain browser).
const AgentApiRow = ({ rowStyle, labelStyle, control, buttonStyle }) => {
  const api = window.electronAPI;
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    api?.agentApiStatus?.().then(setStatus);
  }, [api]);
  if (!status) return null;

  const toggle = async () => setStatus(await api.setAgentApi(!status.enabled));
  const copy = async (what, text) => {
    await api.copyText(text);
    setCopied(what);
  };
  const note = !status.supported
    ? "not available on Windows yet"
    : status.forced
      ? "on for this launch (--agent-api)"
      : "lets Claude and other MCP clients build models in this window";
  const state = status.problem
    ? status.problem
    : status.listening
      ? `Listening on ${status.socketPath}`
      : null;

  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>
          <span>AI agent access (MCP)</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>{note}</span>
        </span>
        {control(
          <button
            className="variables-btn agent-api-toggle"
            onClick={toggle}
            disabled={!status.supported || status.forced}
            style={buttonStyle}
          >
            {status.enabled ? "On" : "Off"}
          </button>,
        )}
      </div>
      {status.enabled && status.supported && (
        <div
          className="agent-api-details"
          style={{ ...labelStyle, gap: 6, paddingBottom: 8 }}
        >
          {state && (
            <span
              className="agent-api-state"
              style={{ fontSize: 10, wordBreak: "break-all" }}
            >
              {state}
            </span>
          )}
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            Add PurpleCAD to your MCP client, then keep this window open while
            the agent works.
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              className="variables-btn agent-api-copy"
              onClick={() => copy("code", claudeCodeCommand(status))}
            >
              {copied === "code" ? "Copied" : "Copy Claude Code command"}
            </button>
            <button
              className="variables-btn agent-api-copy"
              onClick={() => copy("desktop", claudeDesktopConfig(status))}
            >
              {copied === "desktop" ? "Copied" : "Copy Claude Desktop config"}
            </button>
          </span>
        </div>
      )}
    </>
  );
};

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
  const resolutionMm = useStore((s) => s.resolutionMm);
  const setResolutionMm = useStore((s) => s.setResolutionMm);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const widgetVisible = useStore((s) => s.widgetVisible);
  const toggleWidgetVisibility = useStore((s) => s.toggleWidgetVisibility);
  const axisVisible = useStore((s) => s.axisVisible);
  const toggleAxisVisibility = useStore((s) => s.toggleAxisVisibility);
  const alwaysExtrudeSingleObject = useStore(
    (s) => s.alwaysExtrudeSingleObject,
  );
  const setAlwaysExtrudeSingleObject = useStore(
    (s) => s.setAlwaysExtrudeSingleObject,
  );
  const wheelDevice = useStore((s) => s.wheelDevice);
  const setWheelDevice = useStore((s) => s.setWheelDevice);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const setCheckForUpdates = useStore((s) => s.setCheckForUpdates);
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
  // Every control is one width and height, and is followed by a unit slot of
  // one width (empty beside a button), so inputs and buttons share a right
  // edge down the dialog: a degree sign and "mm" are different widths.
  const controlSize = { width: 72, height: 26, boxSizing: "border-box" };
  const numStyle = {
    ...controlSize,
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border-color)",
    color: "var(--text-primary)",
    padding: "4px 6px",
    borderRadius: 3,
    fontFamily: "monospace",
    fontSize: 13,
    textAlign: "right",
  };
  const buttonStyle = { ...controlSize, padding: 0 };
  const control = (el, unit = "") => (
    <span
      style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
    >
      {el}
      <span style={{ width: 20, fontSize: 10, opacity: 0.7 }}>{unit}</span>
    </span>
  );

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
            {control(
              <>
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
              </>,
              "\u00b0",
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap distance</span>
            {control(
              <NumberInput
                min="0.1"
                step="0.5"
                value={snapDistanceMm}
                onCommit={(n, raw) => setSnapDistanceMm(raw)}
                onKeyDown={stop}
                style={numStyle}
              />,
              "mm",
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Snap angle</span>
            {control(
              <NumberInput
                min="0.1"
                step="1"
                value={snapAngleDeg}
                onCommit={(n, raw) => setSnapAngleDeg(raw)}
                onKeyDown={stop}
                style={numStyle}
              />,
              "\u00b0",
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Curve detection</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                max bend between connected lines to highlight as one curve
              </span>
            </span>
            {control(
              <NumberInput
                min="0"
                step="1"
                value={curveDetectionAngleDeg}
                onCommit={(n, raw) => setCurveDetectionAngleDeg(raw)}
                onKeyDown={stop}
                style={numStyle}
              />,
              "\u00b0",
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Resolution</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                surface deviation of curved faces (lower = denser); a new value
                rebuilds the whole timeline
              </span>
            </span>
            {control(
              <NumberInput
                min="0.001"
                step="0.05"
                value={resolutionMm}
                onCommit={(n, raw) => setResolutionMm(raw)}
                onKeyDown={stop}
                style={numStyle}
              />,
              "mm",
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Dark mode</span>
            {control(
              <button
                className="variables-btn"
                onClick={toggleTheme}
                style={buttonStyle}
              >
                {theme === "dark" ? "On" : "Off"}
              </button>,
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Orientation widget</span>
            {control(
              <button
                className="variables-btn"
                onClick={toggleWidgetVisibility}
                style={buttonStyle}
              >
                {widgetVisible ? "On" : "Off"}
              </button>,
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>Combined axis</span>
            {control(
              <button
                className="variables-btn"
                onClick={toggleAxisVisibility}
                style={buttonStyle}
              >
                {axisVisible ? "On" : "Off"}
              </button>,
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Scroll wheel</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                {wheelDevice === "mouse"
                  ? "always zooms"
                  : wheelDevice === "trackpad"
                    ? "always scrolls the view, as a trackpad does"
                    : "a mouse wheel zooms, a trackpad scrolls the view"}
              </span>
            </span>
            {control(
              <button
                className="variables-btn wheel-device"
                onClick={() =>
                  setWheelDevice(
                    { auto: "mouse", mouse: "trackpad", trackpad: "auto" }[
                      wheelDevice
                    ],
                  )
                }
                style={buttonStyle}
              >
                {
                  { auto: "Auto", mouse: "Mouse", trackpad: "Trackpad" }[
                    wheelDevice
                  ]
                }
              </button>,
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>
              <span>Always extrude as single object</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                combine disjoint profiles (e.g. text glyphs) into one body
              </span>
            </span>
            {control(
              <button
                className="variables-btn"
                onClick={() =>
                  setAlwaysExtrudeSingleObject(!alwaysExtrudeSingleObject)
                }
                style={buttonStyle}
              >
                {alwaysExtrudeSingleObject ? "On" : "Off"}
              </button>,
            )}
          </div>

          <AgentApiRow
            rowStyle={rowStyle}
            labelStyle={labelStyle}
            control={control}
            buttonStyle={buttonStyle}
          />

          {/* Only where the host can check: the iPad updates through the App
              Store. */}
          {window.electronAPI?.checkForUpdate && (
            <div style={rowStyle}>
              <label htmlFor="settings-check-updates" style={labelStyle}>
                <span>Check for updates</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>
                  asks GitHub for a newer release at launch
                </span>
              </label>
              {control(
                <span style={{ ...controlSize, display: "flex" }}>
                  <input
                    id="settings-check-updates"
                    type="checkbox"
                    checked={checkForUpdates}
                    onChange={(e) => setCheckForUpdates(e.target.checked)}
                    style={{ margin: "auto 0 auto auto" }}
                  />
                </span>,
              )}
            </div>
          )}

          <div style={rowStyle}>
            <span style={labelStyle}>Reset all settings</span>
            {control(
              <button
                className="variables-btn"
                onClick={resetSettings}
                style={buttonStyle}
              >
                Reset
              </button>,
            )}
          </div>

          <div style={rowStyle}>
            <span style={labelStyle}>About PurpleCAD</span>
            {control(
              <button
                className="variables-btn"
                onClick={() => setAboutDialogOpen(true)}
                style={buttonStyle}
              >
                About
              </button>,
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
