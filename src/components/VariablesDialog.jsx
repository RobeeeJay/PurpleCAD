import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
import FormulaInput from "./FormulaInput";
import "../styles/VariablesDialog.css";

const VariablesDialog = () => {
  const open = useStore((s) => s.variablesDialogOpen);
  const setOpen = useStore((s) => s.setVariablesDialogOpen);
  const variables = useStore((s) => s.variables);
  const setVariables = useStore((s) => s.setVariables);

  // Local draft so the user can edit several rows before committing on close.
  const [draft, setDraft] = useState(variables);
  useEffect(() => {
    if (open) setDraft(variables);
  }, [open, variables]);

  if (!open) return null;

  const map = variablesToMap(draft);
  const computed = draft.map((v) => evaluateFormula(v.formula, map));
  // Names collide when two rows share a non-empty name.
  const nameCounts = draft.reduce((acc, v) => {
    if (v.name) acc[v.name] = (acc[v.name] || 0) + 1;
    return acc;
  }, {});

  const updateRow = (idx, patch) => {
    setDraft((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };
  const addRow = () => setDraft((rows) => [...rows, { name: "", formula: "" }]);
  const removeRow = (idx) =>
    setDraft((rows) => rows.filter((_, i) => i !== idx));

  const close = () => {
    // Drop rows with empty names; trim whitespace.
    const cleaned = draft
      .map((r) => ({ name: r.name.trim(), formula: String(r.formula).trim() }))
      .filter((r) => r.name);
    setVariables(cleaned);
    setOpen(false);
  };

  const cancel = () => setOpen(false);

  return (
    <div className="variables-dialog-backdrop" onClick={cancel}>
      <div className="variables-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="variables-dialog-header">
          <h2>Variables</h2>
          <button
            className="variables-dialog-close"
            onClick={cancel}
            title="Close without saving"
          >
            ×
          </button>
        </div>
        <table className="variables-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Formula</th>
              <th>Value</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.map((row, i) => {
              const dup = row.name && nameCounts[row.name] > 1;
              const value = computed[i];
              const valueText = Number.isFinite(value) ? value.toString() : "—";
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      value={row.name}
                      placeholder="name"
                      className={dup ? "invalid" : ""}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td>
                    <FormulaInput
                      type="text"
                      // Hide the row itself from suggestions — referencing
                      // your own row is a cycle and useless to suggest.
                      variables={draft.filter((_, j) => j !== i)}
                      value={row.formula}
                      placeholder="e.g. width * 2"
                      onChange={(e) =>
                        updateRow(i, { formula: e.target.value })
                      }
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td
                    className={`variables-value${
                      Number.isFinite(value) ? "" : " invalid"
                    }`}
                  >
                    {valueText}
                  </td>
                  <td>
                    <button
                      className="variables-row-remove"
                      title="Remove row"
                      onClick={() => removeRow(i)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="variables-dialog-footer">
          <button className="variables-add-row" onClick={addRow}>
            + Add variable
          </button>
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={cancel}>
              Cancel
            </button>
            <button className="variables-btn primary" onClick={close}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VariablesDialog;
