import React, { useState, useEffect, useRef } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

// Rich editor for a committed revolve, opened from its timeline step.  It drives
// a `sweepSelectMode` edit session (seeded by beginRevolveEdit): the parameters
// here, plus "Pick new geometry" / "Pick new axis" which hand picking back to
// the viewport.  The original solid is hidden while editing so only the live
// preview shows; Cancel restores it, Save replaces it in place.
const RevolveEditDialog = () => {
  const sm = useStore((s) => s.sweepSelectMode);
  const target = useStore((s) => s.sweepRetargetTarget);
  const variables = useStore((s) => s.variables);
  const setSweepParams = useStore((s) => s.setSweepParams);
  const setSweepProfile = useStore((s) => s.setSweepProfile);
  const setSweepAxis = useStore((s) => s.setSweepAxis);

  const editing = !!sm?.editing && sm?.kind === "revolve";
  const params = sm?.params || {};
  const itemId = target?.itemId;

  const [rotations, setRotations] = useState("1");
  const [offset, setOffset] = useState("0");
  const [sides, setSides] = useState("6");
  const seededRef = useRef(false);

  // Seed the inputs once when the edit session opens; reset when it closes.
  useEffect(() => {
    if (editing && !seededRef.current) {
      seededRef.current = true;
      setRotations(String(params.rotations ?? 1));
      setOffset(String(params.offsetPerRotation ?? 0));
      setSides(String(params.sides ?? 6));
    }
    if (!editing) seededRef.current = false;
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide the original solid for the duration of the dialog; restore on unmount
  // (Cancel/Save also restore explicitly).
  useEffect(() => {
    if (!editing || itemId == null) return;
    useStore.getState()._cameraControls?.setRevolveEditHidden?.(itemId);
    return () =>
      useStore.getState()._cameraControls?.restoreRevolveEditHidden?.();
  }, [editing, itemId]);

  const rotationsVal = evalValue(rotations, variables);
  const offsetVal = evalValue(offset, variables);
  const sidesVal = evalValue(sides, variables);
  const rotationsValid = Number.isFinite(rotationsVal) && rotationsVal > 0;
  const offsetValid = Number.isFinite(offsetVal);
  const sidesValid =
    !params.prism || (Number.isFinite(sidesVal) && sidesVal >= 3);
  const valid = rotationsValid && offsetValid && sidesValid;
  const ready = !!sm?.profile && !!sm?.axis;

  const pushParams = () =>
    setSweepParams({
      rotations: rotationsVal,
      offsetPerRotation: offsetVal,
      sides: Math.round(sidesVal),
    });

  // Push valid params and refresh the (debounced) preview; clear it while
  // invalid or mid re-pick (no profile/axis yet).  Re-runs when the re-picked
  // profile/axis change too.
  useEffect(() => {
    if (!editing) return;
    const cc = useStore.getState()._cameraControls;
    if (!ready || !valid) {
      cc?.clearSweepPreview?.();
      return;
    }
    pushParams();
    cc?.updateSweepPreview?.();
  }, [
    editing,
    ready,
    valid,
    rotationsVal,
    offsetVal,
    sidesVal,
    params.prism,
    sm?.profile,
    sm?.axis,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editing) return null;

  const cancel = () => useStore.getState()._cameraControls?.cancelSweep?.();
  const save = () => {
    if (!valid || !ready) return;
    pushParams();
    useStore.getState()._cameraControls?.commitSweep?.();
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
  const rowLabel = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-secondary)",
  };
  const pickBtnStyle = (active) => ({
    flex: 1,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 3,
    border: `1px solid ${active ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
    background: active ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
    color: active ? "#fff" : "var(--text-primary)",
    cursor: "pointer",
  });

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") save();
    else if (e.key === "Escape") cancel();
  };

  const hint = !sm.profile
    ? "Click a sketch region in the viewport to revolve"
    : !sm.axis
      ? "Click the axis line in the viewport (any sketch)"
      : null;

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
        style={{ minWidth: 360, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Edit revolve</h2>
          <button
            className="variables-dialog-close"
            onClick={cancel}
            title="Cancel — restore the original"
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
          {/* Re-pick geometry / axis from the viewport. */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={pickBtnStyle(!sm.profile)}
              title="Pick a new sketch region to revolve"
              onClick={() => setSweepProfile(null)}
            >
              {sm.profile ? "Pick new geometry" : "Click a region…"}
            </button>
            <button
              type="button"
              style={pickBtnStyle(!sm.axis)}
              title="Pick a new rotation axis line (any sketch)"
              onClick={() => setSweepAxis(null)}
            >
              {sm.axis ? "Pick new axis" : "Click a line…"}
            </button>
          </div>

          {hint ? (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {hint}
            </div>
          ) : (
            <>
              <label style={rowLabel}>
                <span>Rotations</span>
                <FormulaInput
                  variables={variables}
                  autoFocus
                  value={rotations}
                  onChange={(e) => setRotations(e.target.value)}
                  onKeyDown={onKey}
                  style={field(rotationsValid)}
                />
              </label>
              <label style={rowLabel}>
                <span>Offset per rotation (mm)</span>
                <FormulaInput
                  variables={variables}
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                  onKeyDown={onKey}
                  style={field(offsetValid)}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!params.prism}
                  onChange={(e) => setSweepParams({ prism: e.target.checked })}
                />
                Prism mode (faceted sweep)
              </label>
              {params.prism && (
                <label style={rowLabel}>
                  <span>Sides</span>
                  <FormulaInput
                    variables={variables}
                    value={sides}
                    onChange={(e) => setSides(e.target.value)}
                    onKeyDown={onKey}
                    style={field(sidesValid)}
                  />
                </label>
              )}
            </>
          )}
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={cancel}>
              Cancel
            </button>
            <button
              className="variables-btn primary"
              disabled={!valid || !ready}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevolveEditDialog;
