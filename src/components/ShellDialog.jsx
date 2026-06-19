import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import { activePrecision } from "../three/resolution.js";
import { commitShell } from "../three/cameraControls/shell.js";
import FormulaInput from "./FormulaInput";
import { evalValue } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

// Shell tool dialog: hollow the selected body to a wall of `thickness`.  Opens
// fresh from the Modify toolbar ({ itemId }) or to edit a committed shell's
// thickness from its timeline step ({ itemId, entryId }).  The field accepts
// variable formulas and may be cleared while typing.
const DEFAULT_THICKNESS_MM = 2;

const ShellDialog = () => {
  const target = useStore((s) => s.shellTarget);
  const setTarget = useStore((s) => s.setShellTarget);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const printPrecision = useStore(activePrecision);
  const updateShellParams = useStore((s) => s.updateShellParams);

  const isEdit = target?.entryId != null;
  const entry = isEdit ? history.find((h) => h.id === target.entryId) : null;
  const regenerator = entry?.instruction?.patches?.regenerator;

  const [thicknessMm, setThicknessMm] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    if (regenerator)
      setThicknessMm(((regenerator.thickness ?? 0) * MM_PER_UNIT).toString());
    else setThicknessMm(String(DEFAULT_THICKNESS_MM));
  }, [target, regenerator]);

  if (!target) return null;
  if (isEdit && !regenerator) return null;

  const thickVal = evalValue(thicknessMm, variables);
  const valid = Number.isFinite(thickVal) && thickVal > 0;

  const close = () => setTarget(null);

  const confirm = async () => {
    if (!valid || busy) return;
    if (isEdit) {
      updateShellParams(entry.id, { thickness: thickVal / MM_PER_UNIT });
      close();
      return;
    }
    const item = items.find((i) => i.id === target.itemId);
    if (!item) return close();
    setBusy(true);
    const ok = await commitShell({
      item,
      items,
      thicknessMm: thickVal,
      printPrecision,
    });
    setBusy(false);
    if (!ok) {
      useStore
        .getState()
        .showNotification?.(
          "Shell failed — the wall thickness is too large for this body.",
        );
      return;
    }
    close();
  };

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
        style={{ minWidth: 400, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>{isEdit ? "Edit shell" : "Shell"}</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Close without applying"
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
            <span>Wall thickness (mm)</span>
            <FormulaInput
              variables={variables}
              autoFocus
              value={thicknessMm}
              onChange={(e) => setThicknessMm(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") confirm();
                else if (e.key === "Escape") close();
              }}
              style={{
                background: "var(--bg-tertiary)",
                border: `1px solid ${valid ? "var(--border-color)" : "#e87575"}`,
                color: "var(--text-primary)",
                padding: "6px 8px",
                borderRadius: 3,
                fontFamily: "monospace",
                fontSize: 13,
              }}
            />
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
              disabled={!valid || busy}
              onClick={confirm}
            >
              {busy ? "Working…" : isEdit ? "Save" : "Shell"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShellDialog;
