import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

// Edit a committed revolve's parameters (rotations, offset/turn, prism mode,
// sides) from its timeline step.  A revolve is a CREATE entry, so it lives on
// inst.item.regenerator.  Mirrors ChamferEditDialog: a non-blocking floating
// panel with a debounced live preview that ghosts the existing solid.
const RevolveEditDialog = () => {
  const target = useStore((s) => s.sweepEditTarget);
  const setTarget = useStore((s) => s.setSweepEditTarget);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const updateRevolveParams = useStore((s) => s.updateRevolveParams);

  const entry =
    target?.entryId != null
      ? history.find((h) => h.id === target.entryId)
      : null;
  const item = entry?.instruction?.item;
  const regenerator = item?.regenerator;

  const [rotations, setRotations] = useState("1");
  const [offset, setOffset] = useState("0");
  const [prism, setPrism] = useState(false);
  const [sides, setSides] = useState("6");
  useEffect(() => {
    if (regenerator?.kind === "revolve") {
      setRotations(
        String((regenerator.angleRad ?? 2 * Math.PI) / (2 * Math.PI)),
      );
      setOffset(String((regenerator.offsetPerRotation ?? 0) * MM_PER_UNIT));
      setPrism((regenerator.prismSides ?? 0) >= 3);
      setSides(
        String(regenerator.prismSides >= 3 ? regenerator.prismSides : 6),
      );
    }
  }, [regenerator]);

  const rotationsVal = evalValue(rotations, variables);
  const offsetVal = evalValue(offset, variables);
  const sidesVal = evalValue(sides, variables);
  const rotationsValid = Number.isFinite(rotationsVal) && rotationsVal > 0;
  const offsetValid = Number.isFinite(offsetVal);
  const sidesValid = !prism || (Number.isFinite(sidesVal) && sidesVal >= 3);
  const valid = rotationsValid && offsetValid && sidesValid;

  useDebouncedPreview(
    regenerator?.kind === "revolve" && valid,
    () =>
      useStore.getState()._cameraControls?.updateRevolveEditPreview?.(
        regenerator,
        {
          rotations: rotationsVal,
          offsetPerRotation: offsetVal,
          prism,
          sides: sidesVal,
        },
        item?.id,
      ),
    () => useStore.getState()._cameraControls?.clearSweepPreview?.(),
    [rotationsVal, offsetVal, sidesVal, prism, regenerator, item?.id],
  );

  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearSweepPreview?.();
  }, [target]);

  if (!target || !entry || regenerator?.kind !== "revolve") return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearSweepPreview?.();
    setTarget(null);
  };
  const commit = () => {
    if (!valid) return;
    updateRevolveParams(entry.id, {
      angleRad: rotationsVal * 2 * Math.PI,
      offsetPerRotation: offsetVal / MM_PER_UNIT,
      prismSides: prism ? Math.max(3, Math.round(sidesVal)) : 0,
    });
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
            onClick={close}
            title="Close without saving"
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
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>Rotations</span>
            <FormulaInput
              variables={variables}
              autoFocus
              value={rotations}
              onChange={(e) => setRotations(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") close();
              }}
              style={field(rotationsValid)}
            />
          </label>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>Offset per rotation (mm)</span>
            <FormulaInput
              variables={variables}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") close();
              }}
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
              checked={prism}
              onChange={(e) => setPrism(e.target.checked)}
            />
            Prism mode (faceted sweep)
          </label>
          {prism && (
            <label
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Sides</span>
              <FormulaInput
                variables={variables}
                value={sides}
                onChange={(e) => setSides(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") close();
                }}
                style={field(sidesValid)}
              />
            </label>
          )}
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
              onClick={commit}
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
