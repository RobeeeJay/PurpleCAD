import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

const ChamferEditDialog = () => {
  const target = useStore((s) => s.chamferEditTarget);
  const setTarget = useStore((s) => s.setChamferEditTarget);
  const history = useStore((s) => s.history);
  const updateChamferParams = useStore((s) => s.updateChamferParams);

  const entry =
    target?.entryId != null
      ? history.find((h) => h.id === target.entryId)
      : null;
  const regenerator = entry?.instruction?.patches?.regenerator;
  const isFillet = regenerator?.segments !== 1;

  // Inputs are in user units (mm for distance/radius, degrees for angle).
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

  if (!target || !entry || !regenerator) return null;

  const close = () => setTarget(null);
  const commit = () => {
    const mm = parseFloat(distanceMm);
    if (!Number.isFinite(mm) || mm <= 0) return;
    const amount = mm / MM_PER_UNIT;
    let angleRad = null;
    if (!isFillet) {
      const deg = parseFloat(angleDeg);
      if (Number.isFinite(deg) && Math.abs(deg - 45) > 0.1)
        angleRad = (deg * Math.PI) / 180;
    }
    updateChamferParams(entry.id, { amount, angleRad });
    close();
  };

  const opName = isFillet ? "fillet" : "chamfer";
  const valueLabel = isFillet ? "Radius (mm)" : "Distance (mm)";
  const distValid = Number.isFinite(parseFloat(distanceMm)) && parseFloat(distanceMm) > 0;
  const angValid = isFillet
    ? true
    : (() => {
        const d = parseFloat(angleDeg);
        return Number.isFinite(d) && d > 0 && d < 90;
      })();
  const valid = distValid && angValid;

  return (
    <div className="variables-dialog-backdrop" onClick={close}>
      <div
        className="variables-dialog"
        style={{ minWidth: 400 }}
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
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
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
            <input
              type="number"
              step="0.1"
              min="0.05"
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
              <input
                type="number"
                step="1"
                min="1"
                max="89"
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
