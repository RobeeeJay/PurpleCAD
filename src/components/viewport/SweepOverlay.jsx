// Hint banners + parameter panel for the sketch→solid sweep tools (Revolve,
// Pipe, Loft).  Picking happens in the viewport (handled by
// cameraControls/sweep.js via _cameraControls); this overlay shows the per-phase
// hint and, for Revolve, once a profile + axis are picked, the Angle / Prism /
// Sides inputs with a debounced live preview, gating Confirm on a valid value —
// like the chamfer/push-pull overlays.  Pipe shows Rotations (twist) + an
// Auto-rotate toggle; Loft has no parameters (just Confirm/Cancel).

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import FormulaInput from "../FormulaInput";
import { evalValue } from "../inputs.jsx";
import { pickBtn } from "./overlayBar.js";

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

  const [rotations, setRotations] = useState("1");
  const [offset, setOffset] = useState("0");
  const [sides, setSides] = useState("6");
  const [twist, setTwist] = useState("0");
  const seededRef = useRef(false);
  const pipeSeededRef = useRef(false);

  const params = sweepSelectMode?.params || {};
  const isRevolve = sweepSelectMode?.kind === "revolve";
  const isPipe = sweepSelectMode?.kind === "pipe";
  const isLoft = sweepSelectMode?.kind === "loft";
  // A revolve EDIT session is driven by RevolveEditDialog instead of this
  // overlay, so stand down while it's active.
  const editing = !!sweepSelectMode?.editing;
  // The revolve param panel is "ready" once a profile + axis are picked.
  const ready =
    isRevolve &&
    !editing &&
    !!sweepSelectMode?.profile &&
    !!sweepSelectMode?.axis;
  const rotationsVal = evalValue(rotations, variables);
  const offsetVal = evalValue(offset, variables);
  const sidesVal = evalValue(sides, variables);
  const rotationsValid = Number.isFinite(rotationsVal) && rotationsVal > 0;
  const offsetValid = Number.isFinite(offsetVal); // 0 / negative are allowed
  const sidesValid =
    !params.prism || (Number.isFinite(sidesVal) && sidesVal >= 3);
  const valid = rotationsValid && offsetValid && sidesValid;

  // Pipe twist params.
  const pipeReady =
    isPipe && !!sweepSelectMode?.profile && !!sweepSelectMode?.path;
  const twistVal = evalValue(twist, variables);
  const twistValid = Number.isFinite(twistVal);

  // Seed the inputs when the params panel first appears (covers retarget, which
  // pre-fills params); reset the latch when the tool closes.
  useEffect(() => {
    if (ready && !seededRef.current) {
      seededRef.current = true;
      setRotations(String(params.rotations ?? 1));
      setOffset(String(params.offsetPerRotation ?? 0));
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
    setSweepParams({
      rotations: rotationsVal,
      offsetPerRotation: offsetVal,
      sides: Math.round(sidesVal),
    });
    cc?.updateSweepPreview?.();
  }, [ready, valid, rotationsVal, offsetVal, sidesVal, params.prism]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed + push pipe twist params (auto-rotate is toggled straight into params).
  useEffect(() => {
    if (pipeReady && !pipeSeededRef.current) {
      pipeSeededRef.current = true;
      setTwist(String(params.twistTurns ?? 0));
    }
    if (!sweepSelectMode) pipeSeededRef.current = false;
  }, [pipeReady, sweepSelectMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pipeReady) return;
    const cc = useStore.getState()._cameraControls;
    if (!twistValid) {
      cc?.clearSweepPreview?.();
      return;
    }
    setSweepParams({ twistTurns: twistVal });
    cc?.updateSweepPreview?.();
  }, [pipeReady, twistValid, twistVal, params.autoRotate]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!sweepSelectMode || editing) return null;

  const cancel = () => useStore.getState()._cameraControls?.cancelSweep?.();
  const confirm = () => {
    if (valid) useStore.getState()._cameraControls?.commitSweep?.();
  };
  const confirmPipe = () => {
    if (twistValid) useStore.getState()._cameraControls?.commitSweep?.();
  };

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
          Click a path line or curve (in another sketch) to follow · Esc to
          cancel
        </div>
      );
    }
    return (
      <>
        <div className="sketch-placement-hint">
          Set the sweep options, then Confirm · Esc to cancel
        </div>
        <div className="sketch-distance-input-overlay">
          <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
            Rotations:
          </span>
          <FormulaInput
            variables={variables}
            autoFocus
            value={twist}
            onChange={(e) => setTwist(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && twistValid) confirmPipe();
            }}
            style={{
              width: 48,
              marginRight: 8,
              border: `1px solid ${twistValid ? "var(--border-color)" : "#e87575"}`,
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
            title="Rotate the section to follow the path tangent (so a curved path isn't flattened)"
          >
            <input
              type="checkbox"
              checked={!!params.autoRotate}
              onChange={(e) => setSweepParams({ autoRotate: e.target.checked })}
            />
            Auto-rotate
          </label>
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
            onClick={confirmPipe}
            disabled={!twistValid}
            title="Confirm — create the pipe"
            style={btn(true, !twistValid)}
          >
            Confirm
          </button>
        </div>
      </>
    );
  }

  if (isLoft) {
    const lp = sweepSelectMode.loftPick;
    const hasStart = !!sweepSelectMode.profile;
    const hasEnd = !!sweepSelectMode.secondProfile;
    const both = hasStart && hasEnd;
    const arm = (t) =>
      useStore.getState().setSweepLoftPick(lp === t ? null : t);
    const hint =
      lp === "start"
        ? "Click the start sketch region · Esc to cancel"
        : lp === "end"
          ? "Click the end region (on a parallel plane) · Esc to cancel"
          : "Choose the start and end geometry, then Confirm · Esc to cancel";
    return (
      <>
        <div className="sketch-placement-hint">{hint}</div>
        <div className="sketch-distance-input-overlay">
          <button
            type="button"
            style={pickBtn(lp === "start")}
            onClick={() => arm("start")}
            title="Pick the start sketch region"
          >
            {hasStart ? "Start ✓" : "Start geometry"}
          </button>
          <button
            type="button"
            style={{ ...pickBtn(lp === "end"), marginLeft: 6 }}
            onClick={() => arm("end")}
            title="Pick the end sketch region (on a plane parallel to the start)"
          >
            {hasEnd ? "End ✓" : "End geometry"}
          </button>
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
            disabled={!both}
            title={
              both ? "Confirm — create the loft" : "Pick both regions first"
            }
            style={btn(true, !both)}
          >
            Confirm
          </button>
        </div>
      </>
    );
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
          Rotations:
        </span>
        <FormulaInput
          variables={variables}
          autoFocus
          value={rotations}
          onChange={(e) => setRotations(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") confirm();
          }}
          style={{
            width: 48,
            marginRight: 8,
            border: `1px solid ${rotationsValid ? "var(--border-color)" : "#e87575"}`,
          }}
        />
        <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
          Offset/turn (mm):
        </span>
        <FormulaInput
          variables={variables}
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") confirm();
          }}
          style={{
            width: 48,
            marginRight: 8,
            border: `1px solid ${offsetValid ? "var(--border-color)" : "#e87575"}`,
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
