// Select-mode + confirmation overlay for chamfer/fillet, mirroring the
// extrude profile/depth overlay in SketchOverlays.jsx.  Toggled by
// BevelSection's Chamfer/Bevel toolbar buttons via chamferSelectMode.  The
// selectedSubGeometry highlight shows which faces/edges are picked; a
// debounced call into chamferPreview.js additionally swaps in a translucent
// preview of the actual chamfer/fillet result as the selection or
// distance/angle changes.

import React, { useEffect, useState } from "react";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import { chamferOrFilletItem } from "../../three/occClient.js";
import {
  buildChamferSourceAndSubGeo,
  commitChamferResult,
} from "../../three/cameraControls/chamferCommit.js";

// Debounce live-preview recomputation: each call re-runs OCC's chamfer/
// fillet, so don't fire on every keystroke / pick.
const PREVIEW_DEBOUNCE_MS = 250;

export default function ChamferOverlay() {
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const items = useStore((s) => s.items);
  const curveResolution = useStore((s) => s.curveResolution);
  const showNotification = useStore((s) => s.showNotification);
  const chamferRetargetTarget = useStore((s) => s.chamferRetargetTarget);
  const setChamferRetargetTarget = useStore((s) => s.setChamferRetargetTarget);

  // Same defaults/units as the old toolbar inputs: distance in mm
  // (converted to scene units by MM_PER_UNIT), angle in degrees (chamfer
  // only — fillet's radius alone determines the curve).
  const [distanceMm, setDistanceMm] = useState(0.5);
  const [angleDeg, setAngleDeg] = useState(45);

  const hasSelection =
    selectedSubGeometry &&
    ((selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0);

  // beginChamferRetarget pre-selects the prior subGeo and arms
  // chamferRetargetTarget — seed the inputs from that operation's recipe so
  // Confirm reproduces it by default (the user can still tweak before
  // confirming).
  useEffect(() => {
    if (!chamferRetargetTarget) return;
    const item = items.find((i) => i.id === chamferRetargetTarget.itemId);
    const prior = item?.regenerator;
    if (!prior || prior.kind !== "chamfer") return;
    setDistanceMm(prior.amount * MM_PER_UNIT);
    setAngleDeg(prior.angleRad != null ? (prior.angleRad * 180) / Math.PI : 45);
  }, [chamferRetargetTarget]);

  // Live preview: debounced re-run of the chamfer/fillet recipe against the
  // current selection + distance/angle, swapping a translucent result mesh
  // in for the source item.
  useEffect(() => {
    const cameraControls = useStore.getState()._cameraControls;
    if (!chamferSelectMode || !hasSelection) {
      cameraControls?.clearChamferPreview?.();
      return;
    }
    const timer = setTimeout(() => {
      cameraControls?.updateChamferPreview?.(distanceMm, angleDeg);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    chamferSelectMode,
    selectedSubGeometry,
    distanceMm,
    angleDeg,
    hasSelection,
  ]);

  // Clear any preview mesh on unmount (mode toggled off, item deselected).
  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearChamferPreview?.();
  }, []);

  if (!chamferSelectMode) return null;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearChamferPreview?.();
    clearSelectedSubGeometry();
    setChamferSelectMode(null);
    setChamferRetargetTarget(null);
  };

  // `segments` here is preserved from the old (custom-mesh) chamfer API:
  // segments=1 → chamfer (flat); segments>1 → bevel (rounded).  OCC
  // expresses these as BRepFilletAPI_MakeChamfer (constant distance) and
  // BRepFilletAPI_MakeFillet (radius); we map directly.
  const applyChamfer = async () => {
    const segments = chamferSelectMode === "chamfer" ? 1 : 3;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;
    const retargetEntryId =
      chamferRetargetTarget?.itemId === item.id
        ? chamferRetargetTarget.entryId
        : null;

    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const amount = distanceMm / MM_PER_UNIT;
      // Only chamfer (segments=1) uses the angle; fillet is purely
      // radius-driven.  Treat angle ≈ 45° as "symmetric" and skip the
      // AddDA path (cheaper, and BRepFilletAPI_MakeChamfer's Add_2 also
      // handles convex/concave cases more robustly).
      const angleRad =
        segments === 1 && Math.abs(angleDeg - 45) > 0.1
          ? (angleDeg * Math.PI) / 180
          : null;

      const { source, subGeo } = buildChamferSourceAndSubGeo({
        item,
        items,
        selectedSubGeometry,
        amount,
        segments,
        printPrecision,
        retargeting: !!retargetEntryId,
      });
      if (subGeo.edges.length === 0 && subGeo.faces.length === 0) return;

      // Delegated to occClient — handles building the source shape,
      // applying chamfer (segments=1) or fillet (segments>1), tessellating,
      // and centring the result around its bbox.  The "By" variants used
      // inside handle both explicit edge endpoints and face-normal
      // selections.  Returns null when nothing matched.
      const result = await chamferOrFilletItem({
        source,
        subGeo,
        amount,
        angleRad,
        segments,
        allItems: items,
        printPrecision,
      });
      if (!result) {
        showNotification(
          "Could not apply — the distance may be too large for the selected geometry.",
        );
        return;
      }
      useStore.getState()._cameraControls?.clearChamferPreview?.();
      commitChamferResult(
        item,
        source,
        result,
        subGeo,
        {
          kind: "chamfer",
          amount,
          segments,
          angleRad,
          regeneratedAt: printPrecision,
        },
        segments === 1 ? "Chamfered" : "Filleted",
        retargetEntryId,
      );
      setChamferSelectMode(null);
      if (retargetEntryId) setChamferRetargetTarget(null);
    } catch (err) {
      console.error("Chamfer operation failed:", err);
      showNotification(err.message);
    }
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") applyChamfer();
    else if (e.key === "Escape") cancel();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        {hasSelection
          ? "Set the distance below, then Confirm · Esc to cancel"
          : "Alt+click faces or Ctrl+click edges to select geometry to chamfer/fillet · Esc to cancel"}
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
            min="0.05"
            value={distanceMm}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) setDistanceMm(v);
            }}
            onKeyDown={handleKeyDown}
            style={{ width: 56, marginRight: 8 }}
          />
          {chamferSelectMode === "chamfer" && (
            <>
              <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
                Angle (°):
              </span>
              <input
                type="number"
                step="1"
                min="1"
                max="89"
                value={angleDeg}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0 && v < 90) setAngleDeg(v);
                }}
                onKeyDown={handleKeyDown}
                style={{ width: 48, marginRight: 8 }}
              />
            </>
          )}
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
            onClick={applyChamfer}
            title={`Confirm — apply the ${
              chamferSelectMode === "chamfer" ? "chamfer" : "fillet"
            }`}
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
