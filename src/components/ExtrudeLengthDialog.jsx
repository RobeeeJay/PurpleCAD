import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

// Returns the depth as a user-editable mm formula string regardless of the
// stored representation (legacy number = scene units; new string = mm).
const formulaFor = (item) => {
  if (!item) return "";
  const v = item.depth;
  if (typeof v === "number") return (v * MM_PER_UNIT).toString();
  if (typeof v === "string") return v;
  return "";
};

const ExtrudeLengthDialog = () => {
  const target = useStore((s) => s.extrudeEditTarget);
  const setTarget = useStore((s) => s.setExtrudeEditTarget);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const modifyItem = useStore((s) => s.modifyItem);

  const item = target?.itemId != null
    ? items.find((i) => i.id === target.itemId)
    : null;

  const [formula, setFormula] = useState("");
  useEffect(() => {
    if (target && item) setFormula(formulaFor(item));
  }, [target, item]);

  if (!target || !item) return null;

  const map = variablesToMap(variables);
  const mm = evaluateFormula(formula, map);
  const valid = Number.isFinite(mm) && mm > 0;

  const close = () => setTarget(null);
  const commit = () => {
    if (!valid) return;
    // Store as mm formula string so future evaluations can resolve variables.
    modifyItem(item.id, { depth: formula.trim() });
    close();
  };

  return (
    <div className="variables-dialog-backdrop" onClick={close}>
      <div
        className="variables-dialog"
        style={{ minWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Edit extrusion length</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Close without saving"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <span>Length (mm) — number or formula referencing variables</span>
            <input
              type="text"
              autoFocus
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") close();
              }}
              style={{
                background: "var(--bg-tertiary)",
                border: `1px solid ${
                  valid ? "var(--border-color)" : "#e87575"
                }`,
                color: "var(--text-primary)",
                padding: "6px 8px",
                borderRadius: 3,
                fontFamily: "monospace",
                fontSize: 13,
              }}
            />
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>
              ={" "}
              {valid ? (
                `${mm.toFixed(2)} mm`
              ) : (
                <span style={{ color: "#e87575" }}>invalid</span>
              )}
            </span>
          </label>
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

export default ExtrudeLengthDialog;
