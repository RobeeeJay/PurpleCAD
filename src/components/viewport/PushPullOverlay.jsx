// Select-mode + confirmation overlay for push/pull, mirroring ChamferOverlay.
// Toggled by the Modify toolbar's Push/Pull button via pushPullSelectMode.
// The selectedSubGeometry highlight shows which faces are picked; a debounced
// call into pushPull.js swaps in a translucent preview of the moved result as
// the selection or distance changes.  A positive distance pulls each face
// outward (growing the solid); a negative distance pushes it inward.

import React, { useEffect, useState } from "react";
import { useStore } from "../../store";
import { commitPushPull } from "../../three/cameraControls/pushPull.js";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";

const PREVIEW_DEBOUNCE_MS = 250;

export default function PushPullOverlay() {
  const pushPullSelectMode = useStore((s) => s.pushPullSelectMode);
  const setPushPullSelectMode = useStore((s) => s.setPushPullSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const items = useStore((s) => s.items);
  const curveResolution = useStore((s) => s.curveResolution);
  const showNotification = useStore((s) => s.showNotification);
  const pushPullRetargetTarget = useStore((s) => s.pushPullRetargetTarget);
  const setPushPullRetargetTarget = useStore(
    (s) => s.setPushPullRetargetTarget,
  );

  const [distanceMm, setDistanceMm] = useState(1);

  // Retarget pre-selects the prior faces and arms pushPullRetargetTarget —
  // seed the distance from that op's recipe so Confirm reproduces it by default
  // (the user can still tweak it before confirming).
  useEffect(() => {
    if (!pushPullRetargetTarget) return;
    const item = items.find((i) => i.id === pushPullRetargetTarget.itemId);
    const prior = item?.regenerator;
    if (prior?.kind !== "pushpull") return;
    setDistanceMm((prior.distance ?? 0.1) * MM_PER_UNIT);
  }, [pushPullRetargetTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSelection = (selectedSubGeometry?.faces?.length ?? 0) > 0;

  // Live preview: debounced re-run of the push/pull recipe against the current
  // face selection + distance.
  useEffect(() => {
    const cameraControls = useStore.getState()._cameraControls;
    if (!pushPullSelectMode || !hasSelection) {
      cameraControls?.clearPushPullPreview?.();
      return;
    }
    const timer = setTimeout(() => {
      cameraControls?.updatePushPullPreview?.(distanceMm);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pushPullSelectMode, selectedSubGeometry, distanceMm, hasSelection]);

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
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;
    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const ok = await commitPushPull({
        item,
        items,
        selectedSubGeometry,
        distanceMm,
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
    if (e.key === "Enter") applyPushPull();
    else if (e.key === "Escape") cancel();
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
          <input
            type="number"
            autoFocus
            step="0.1"
            value={distanceMm}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) setDistanceMm(v);
            }}
            onKeyDown={handleKeyDown}
            style={{ width: 64, marginRight: 8 }}
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
            title="Confirm — apply the push/pull"
            style={{
              fontSize: 11,
              padding: "3px 10px",
              marginLeft: 8,
              borderRadius: 3,
              border: "1px solid var(--accent, #4488ff)",
              background: "var(--accent, #4488ff)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Confirm
          </button>
        </div>
      )}
    </>
  );
}
