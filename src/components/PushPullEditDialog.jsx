import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

// Edit just the distance of a committed push/pull, from its timeline step.
// Mirrors ChamferEditDialog: a non-blocking floating panel with a live preview
// that re-runs the stored recipe at the typed distance before Save.  Distance
// is signed — positive pulls the faces outward, negative pushes them in.  The
// field accepts variable formulas and may be cleared while typing.
const PushPullEditDialog = () => {
  const target = useStore((s) => s.pushPullEditTarget);
  const setTarget = useStore((s) => s.setPushPullEditTarget);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const updatePushPullParams = useStore((s) => s.updatePushPullParams);

  const entry =
    target?.entryId != null
      ? history.find((h) => h.id === target.entryId)
      : null;
  const regenerator = entry?.instruction?.patches?.regenerator;

  const [distanceMm, setDistanceMm] = useState("");
  useEffect(() => {
    if (regenerator)
      setDistanceMm(((regenerator.distance ?? 0.1) * MM_PER_UNIT).toString());
  }, [regenerator]);

  const distVal = evalValue(distanceMm, variables);
  const valid = Number.isFinite(distVal) && distVal !== 0;

  // Live preview: debounced re-run of the push/pull at the typed distance,
  // cleared the moment it goes blank/invalid.
  useDebouncedPreview(
    !!regenerator && valid,
    () =>
      useStore
        .getState()
        ._cameraControls?.updatePushPullEditPreview?.(
          regenerator,
          distVal,
          entry?.itemId,
        ),
    () => useStore.getState()._cameraControls?.clearPushPullPreview?.(),
    [distVal, regenerator, entry?.itemId],
  );

  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearPushPullPreview?.();
  }, [target]);

  if (!target || !entry || !regenerator) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearPushPullPreview?.();
    setTarget(null);
  };
  const commit = () => {
    if (!valid) return;
    updatePushPullParams(entry.id, { distance: distVal / MM_PER_UNIT });
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
          <h2>Edit push/pull</h2>
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
            <span>Distance (mm · positive pulls out, negative pushes in)</span>
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

export default PushPullEditDialog;
