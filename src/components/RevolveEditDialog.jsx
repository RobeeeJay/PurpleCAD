import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

// Edit a committed revolve's parameters (angle, prism mode, sides) from its
// timeline step.  A revolve is a CREATE entry, so its recipe lives on
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

  const [angleDeg, setAngleDeg] = useState("");
  const [prism, setPrism] = useState(false);
  const [sides, setSides] = useState("6");
  useEffect(() => {
    if (regenerator?.kind === "revolve") {
      setAngleDeg(
        String(
          Math.round(((regenerator.angleRad ?? 2 * Math.PI) * 180) / Math.PI),
        ),
      );
      setPrism((regenerator.prismSides ?? 0) >= 3);
      setSides(
        String(regenerator.prismSides >= 3 ? regenerator.prismSides : 6),
      );
    }
  }, [regenerator]);

  const angleVal = evalValue(angleDeg, variables);
  const sidesVal = evalValue(sides, variables);
  const angleValid =
    Number.isFinite(angleVal) && angleVal > 0 && angleVal <= 360;
  const sidesValid = !prism || (Number.isFinite(sidesVal) && sidesVal >= 3);
  const valid = angleValid && sidesValid;

  useDebouncedPreview(
    regenerator?.kind === "revolve" && valid,
    () =>
      useStore
        .getState()
        ._cameraControls?.updateRevolveEditPreview?.(
          regenerator,
          { angleDeg: angleVal, prism, sides: sidesVal },
          item?.id,
        ),
    () => useStore.getState()._cameraControls?.clearSweepPreview?.(),
    [angleVal, sidesVal, prism, regenerator, item?.id],
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
      angleRad: (angleVal * Math.PI) / 180,
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
            <span>Angle (degrees)</span>
            <FormulaInput
              variables={variables}
              autoFocus
              value={angleDeg}
              onChange={(e) => setAngleDeg(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") close();
              }}
              style={field(angleValid)}
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
