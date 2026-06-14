import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

// Edit just the distance of a committed push/pull, from its timeline step.
// Mirrors ChamferEditDialog: a non-blocking floating panel with a live preview
// that re-runs the stored recipe at the typed distance before Save.  Distance
// is signed — positive pulls the faces outward, negative pushes them in.
const PushPullEditDialog = () => {
  const target = useStore((s) => s.pushPullEditTarget);
  const setTarget = useStore((s) => s.setPushPullEditTarget);
  const history = useStore((s) => s.history);
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

  // Live preview: debounced re-run of the push/pull at the typed distance.
  useEffect(() => {
    if (!regenerator) return;
    const mm = parseFloat(distanceMm);
    if (!Number.isFinite(mm) || mm === 0) return;
    const ctrl = useStore.getState()._cameraControls;
    const timer = setTimeout(() => {
      ctrl?.updatePushPullEditPreview?.(regenerator, mm, entry.itemId);
    }, 250);
    return () => clearTimeout(timer);
  }, [distanceMm, regenerator, entry?.itemId]);

  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearPushPullPreview?.();
  }, [target]);

  if (!target || !entry || !regenerator) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearPushPullPreview?.();
    setTarget(null);
  };
  const valid = (() => {
    const mm = parseFloat(distanceMm);
    return Number.isFinite(mm) && mm !== 0;
  })();
  const commit = () => {
    const mm = parseFloat(distanceMm);
    if (!Number.isFinite(mm) || mm === 0) return;
    updatePushPullParams(entry.id, { distance: mm / MM_PER_UNIT });
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
            <input
              type="number"
              step="0.1"
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
