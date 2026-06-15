// Hint banners + parameter panel for the sketch→solid sweep tools (Revolve,
// Pipe, Loft).  Picking happens in the viewport (handled by
// cameraControls/sweep.js via _cameraControls); this overlay shows the per-phase
// hint and, for Revolve, once a profile + axis are picked, the Angle / Prism /
// Sides inputs with a debounced live preview, gating Confirm on a valid value —
// like the chamfer/push-pull overlays.  Pipe and Loft have no parameters, so
// they show just a Confirm/Cancel bar once both picks are made.

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import FormulaInput from "../FormulaInput";
import { evalValue } from "../inputs.jsx";

const btn = (accent, disabled) => ({
  fontSize: 11,
  padding: "3px 10px",
  marginLeft: 8,
  borderRadius: 3,
  border: `1px solid ${accent ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
  background: accent ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
  color: accent ? "#fff" : "var(--text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

export default function SweepOverlay() {
  const sweepSelectMode = useStore((s) => s.sweepSelectMode);
  const variables = useStore((s) => s.variables);
  const setSweepParams = useStore((s) => s.setSweepParams);

  const [angleDeg, setAngleDeg] = useState("360");
  const [sides, setSides] = useState("6");
  const seededRef = useRef(false);

  const params = sweepSelectMode?.params || {};
  const isRevolve = sweepSelectMode?.kind === "revolve";
  const isPipe = sweepSelectMode?.kind === "pipe";
  const isLoft = sweepSelectMode?.kind === "loft";
  // The revolve param panel is "ready" once a profile + axis are picked.
  const ready =
    isRevolve && !!sweepSelectMode?.profile && !!sweepSelectMode?.axis;
  const angleVal = evalValue(angleDeg, variables);
  const sidesVal = evalValue(sides, variables);
  const angleValid =
    Number.isFinite(angleVal) && angleVal > 0 && angleVal <= 360;
  const sidesValid =
    !params.prism || (Number.isFinite(sidesVal) && sidesVal >= 3);
  const valid = angleValid && sidesValid;

  // Seed the inputs when the params panel first appears (covers retarget, which
  // pre-fills params); reset the latch when the tool closes.
  useEffect(() => {
    if (ready && !seededRef.current) {
      seededRef.current = true;
      setAngleDeg(String(params.angleDeg ?? 360));
      setSides(String(params.sides ?? 6));
    }
    if (!sweepSelectMode) seededRef.current = false;
  }, [ready, sweepSelectMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push valid params to the store and refresh the (debounced) preview; clear it
  // while a value is invalid.
  useEffect(() => {
    if (!ready) return;
    const cc = useStore.getState()._cameraControls;
    if (!valid) {
      cc?.clearSweepPreview?.();
      return;
    }
    setSweepParams({ angleDeg: angleVal, sides: Math.round(sidesVal) });
    cc?.updateSweepPreview?.();
  }, [ready, valid, angleVal, sidesVal, params.prism]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc cancels the whole tool from any phase.
  useEffect(() => {
    if (!sweepSelectMode) return;
    const onKey = (e) => {
      if (e.key === "Escape")
        useStore.getState()._cameraControls?.cancelSweep?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sweepSelectMode]);

  if (!sweepSelectMode) return null;

  const cancel = () => useStore.getState()._cameraControls?.cancelSweep?.();
  const confirm = () => {
    if (valid) useStore.getState()._cameraControls?.commitSweep?.();
  };

  // Pipe and loft have no parameters: a per-phase hint, then a Confirm/Cancel
  // bar once both picks are made.
  const confirmBar = (label) => (
    <>
      <div className="sketch-placement-hint">
        Confirm to create the {label} · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay">
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          style={btn(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => useStore.getState()._cameraControls?.commitSweep?.()}
          title={`Confirm — create the ${label}`}
          style={btn(true)}
        >
          Confirm
        </button>
      </div>
    </>
  );

  if (isPipe) {
    if (!sweepSelectMode.profile) {
      return (
        <div className="sketch-placement-hint">
          Click a sketch region to sweep · Esc to cancel
        </div>
      );
    }
    if (!sweepSelectMode.path) {
      return (
        <div className="sketch-placement-hint">
          Click a path line (in another sketch) to follow · Esc to cancel
        </div>
      );
    }
    return confirmBar("pipe");
  }

  if (isLoft) {
    if (!sweepSelectMode.profile) {
      return (
        <div className="sketch-placement-hint">
          Click the first sketch region to loft from · Esc to cancel
        </div>
      );
    }
    if (!sweepSelectMode.secondProfile) {
      return (
        <div className="sketch-placement-hint">
          Click the second region (on a parallel plane) to loft to · Esc to
          cancel
        </div>
      );
    }
    return confirmBar("loft");
  }

  if (!isRevolve) return null;

  if (!sweepSelectMode.profile) {
    return (
      <div className="sketch-placement-hint">
        Click a sketch region to revolve · Esc to cancel
      </div>
    );
  }
  if (!sweepSelectMode.axis) {
    return (
      <div className="sketch-placement-hint">
        Click the axis line to revolve around · Esc to cancel
      </div>
    );
  }

  return (
    <>
      <div className="sketch-placement-hint">
        Set the revolve options, then Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay">
        <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
          Angle (°):
        </span>
        <FormulaInput
          variables={variables}
          autoFocus
          value={angleDeg}
          onChange={(e) => setAngleDeg(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") confirm();
          }}
          style={{
            width: 56,
            marginRight: 8,
            border: `1px solid ${angleValid ? "var(--border-color)" : "#e87575"}`,
          }}
        />
        <label
          style={{
            fontSize: 11,
            color: "#ccc",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginRight: 8,
          }}
        >
          <input
            type="checkbox"
            checked={!!params.prism}
            onChange={(e) => setSweepParams({ prism: e.target.checked })}
          />
          Prism
        </label>
        {params.prism && (
          <>
            <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
              Sides:
            </span>
            <FormulaInput
              variables={variables}
              value={sides}
              onChange={(e) => setSides(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") confirm();
              }}
              style={{
                width: 44,
                marginRight: 8,
                border: `1px solid ${sidesValid ? "var(--border-color)" : "#e87575"}`,
              }}
            />
          </>
        )}
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          style={btn(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Confirm — create the revolve" : "Enter valid values"}
          style={btn(true, !valid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
