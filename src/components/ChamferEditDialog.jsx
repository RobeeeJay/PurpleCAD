import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

const ChamferEditDialog = () => {
  const target = useStore((s) => s.chamferEditTarget);
  const setTarget = useStore((s) => s.setChamferEditTarget);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const updateChamferParams = useStore((s) => s.updateChamferParams);

  const entry =
    target?.entryId != null
      ? history.find((h) => h.id === target.entryId)
      : null;
  const regenerator = entry?.instruction?.patches?.regenerator;
  const isFillet = regenerator?.segments !== 1;

  // Inputs are in user units (mm for distance/radius, degrees for angle) and
  // accept variable formulas.
  const [distanceMm, setDistanceMm] = useState("");
  const [angleDeg, setAngleDeg] = useState("");
  useEffect(() => {
    if (regenerator) {
      setDistanceMm(((regenerator.amount ?? 0.05) * MM_PER_UNIT).toString());
      setAngleDeg(
        regenerator.angleRad != null
          ? ((regenerator.angleRad * 180) / Math.PI).toString()
          : "45",
      );
    }
  }, [regenerator]);

  const distVal = evalValue(distanceMm, variables);
  const angVal = evalValue(angleDeg, variables);
  const distValid = Number.isFinite(distVal) && distVal > 0;
  const angValid =
    isFillet || (Number.isFinite(angVal) && angVal > 0 && angVal < 90);
  const valid = distValid && angValid;

  // Live preview: debounced re-run of the chamfer/fillet with the typed
  // distance/angle, overlaid as a wireframe so the edit is visible before Save;
  // cleared the moment a value goes blank/invalid.
  useDebouncedPreview(
    !!regenerator && valid,
    () =>
      useStore
        .getState()
        ._cameraControls?.updateChamferEditPreview?.(
          regenerator,
          distVal,
          angVal,
          entry?.itemId,
        ),
    () => useStore.getState()._cameraControls?.clearChamferPreview?.(),
    [distVal, angVal, regenerator, entry?.itemId],
  );

  // Drop the preview overlay whenever the dialog closes (Save, Cancel,
  // Escape, backdrop click) or unmounts.
  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearChamferPreview?.();
  }, [target]);

  if (!target || !entry || !regenerator) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearChamferPreview?.();
    setTarget(null);
  };
  const commit = () => {
    if (!valid) return;
    const amount = distVal / MM_PER_UNIT;
    let angleRad = null;
    if (!isFillet && Math.abs(angVal - 45) > 0.1)
      angleRad = (angVal * Math.PI) / 180;
    updateChamferParams(entry.id, { amount, angleRad });
    close();
  };

  const opName = isFillet ? "fillet" : "chamfer";
  const valueLabel = isFillet ? "Radius (mm)" : "Distance (mm)";

  return (
    // Non-blocking: a click-through, undimmed backdrop keeps the viewport
    // visible and orbitable so the live preview is actually seen.  The dialog
    // floats near the bottom (above the create-overlay band) with its own
    // pointer events; closing is via Cancel / Save / × / Escape, not
    // click-away.
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
        style={{ minWidth: 400, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Edit {opName}</h2>
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
              flexDirection: "column",
              gap: 4,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>{valueLabel}</span>
            <FormulaInput
              variables={variables}
              autoFocus
              value={distanceMm}
              onChange={(e) => setDistanceMm(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") close();
              }}
              style={{
                background: "var(--bg-tertiary)",
                border: `1px solid ${
                  distValid ? "var(--border-color)" : "#e87575"
                }`,
                color: "var(--text-primary)",
                padding: "6px 8px",
                borderRadius: 3,
                fontFamily: "monospace",
                fontSize: 13,
              }}
            />
          </label>
          {!isFillet && (
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Angle (degrees · 45° = symmetric)</span>
              <FormulaInput
                variables={variables}
                value={angleDeg}
                onChange={(e) => setAngleDeg(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") close();
                }}
                style={{
                  background: "var(--bg-tertiary)",
                  border: `1px solid ${
                    angValid ? "var(--border-color)" : "#e87575"
                  }`,
                  color: "var(--text-primary)",
                  padding: "6px 8px",
                  borderRadius: 3,
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
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

export default ChamferEditDialog;
