// Select-mode + confirmation overlay for push/pull, mirroring ChamferOverlay.
// Toggled by the Modify toolbar's Push/Pull button via pushPullSelectMode.
// The selectedSubGeometry highlight shows which faces are picked; a debounced
// call into pushPull.js swaps in a translucent preview of the moved result as
// the selection or distance changes.  A positive distance pulls each face
// outward (growing the solid); a negative distance pushes it inward.
//
// The distance accepts variable formulas, may be cleared to blank while typing,
// and gates the live preview + Confirm on a valid (non-zero) value.

import React, { useEffect, useState } from "react";
import { useStore } from "../../store";
import { commitPushPull } from "../../three/cameraControls/pushPull.js";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import FormulaInput from "../FormulaInput";
import { evalValue, useDebouncedPreview } from "../inputs.jsx";

export default function PushPullOverlay() {
  const pushPullSelectMode = useStore((s) => s.pushPullSelectMode);
  const setPushPullSelectMode = useStore((s) => s.setPushPullSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const curveResolution = useStore((s) => s.curveResolution);
  const showNotification = useStore((s) => s.showNotification);
  const pushPullRetargetTarget = useStore((s) => s.pushPullRetargetTarget);
  const setPushPullRetargetTarget = useStore(
    (s) => s.setPushPullRetargetTarget,
  );

  const [distanceMm, setDistanceMm] = useState("1");

  // Retarget pre-selects the prior faces and arms pushPullRetargetTarget —
  // seed the distance from that op's recipe so Confirm reproduces it by default.
  useEffect(() => {
    if (!pushPullRetargetTarget) return;
    const item = items.find((i) => i.id === pushPullRetargetTarget.itemId);
    const prior = item?.regenerator;
    if (prior?.kind !== "pushpull") return;
    setDistanceMm(String((prior.distance ?? 0.1) * MM_PER_UNIT));
  }, [pushPullRetargetTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSelection = (selectedSubGeometry?.faces?.length ?? 0) > 0;
  const distVal = evalValue(distanceMm, variables); // mm (signed)
  const valid = Number.isFinite(distVal) && distVal !== 0;

  // Live preview: debounced re-run while a valid distance and a face selection
  // exist; cleared the moment the value goes blank/invalid.
  useDebouncedPreview(
    !!pushPullSelectMode && hasSelection && valid,
    () => useStore.getState()._cameraControls?.updatePushPullPreview?.(distVal),
    () => useStore.getState()._cameraControls?.clearPushPullPreview?.(),
    [distVal, selectedSubGeometry],
  );

  // Clear any preview mesh on unmount (mode toggled off, item deselected).
  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearPushPullPreview?.();
  }, []);

  if (!pushPullSelectMode) return null;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearPushPullPreview?.();
    clearSelectedSubGeometry();
    setPushPullSelectMode(null);
    setPushPullRetargetTarget(null);
  };

  const applyPushPull = async () => {
    if (!valid) return;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;
    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const ok = await commitPushPull({
        item,
        items,
        selectedSubGeometry,
        distanceMm: distVal,
        printPrecision,
      });
      if (!ok) {
        showNotification(
          "Could not push/pull — the distance may be too large for the selected face.",
        );
        return;
      }
      setPushPullSelectMode(null);
    } catch (err) {
      console.error("Push/pull operation failed:", err);
      showNotification(err.message);
    }
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      if (valid) applyPushPull();
    } else if (e.key === "Escape") cancel();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        {hasSelection
          ? "Set the distance below, then Confirm (positive pulls out, negative pushes in) · Esc to cancel"
          : "Alt+click faces to select geometry to push/pull · Esc to cancel"}
      </div>
      {hasSelection && (
        <div className="sketch-distance-input-overlay">
          <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
            Distance (mm):
          </span>
          <FormulaInput
            variables={variables}
            autoFocus
            value={distanceMm}
            onChange={(e) => setDistanceMm(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: 64,
              marginRight: 8,
              border: `1px solid ${valid ? "var(--border-color)" : "#e87575"}`,
            }}
          />
          <button
            type="button"
            onClick={cancel}
            title="Cancel"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              marginLeft: 8,
              borderRadius: 3,
              border: "1px solid var(--border-color)",
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={applyPushPull}
            disabled={!valid}
            title={
              valid ? "Confirm — apply the push/pull" : "Enter a valid value"
            }
            style={{
              fontSize: 11,
              padding: "3px 10px",
              marginLeft: 8,
              borderRadius: 3,
              border: "1px solid var(--accent, #4488ff)",
              background: "var(--accent, #4488ff)",
              color: "#fff",
              cursor: valid ? "pointer" : "not-allowed",
              opacity: valid ? 1 : 0.5,
            }}
          >
            Confirm
          </button>
        </div>
      )}
    </>
  );
}
