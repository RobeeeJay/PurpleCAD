// Select-mode + confirmation overlay for chamfer/fillet, mirroring the
// extrude profile/depth overlay in SketchOverlays.jsx.  Toggled by
// BevelSection's Chamfer/Bevel toolbar buttons via chamferSelectMode.  The
// selectedSubGeometry highlight shows which faces/edges are picked; a
// debounced call into chamferPreview.js additionally swaps in a translucent
// preview of the actual chamfer/fillet result as the selection or
// distance/angle changes.
//
// Inputs accept variable formulas, may be cleared to blank while typing, and
// gate the live preview + Confirm on a valid value (see ../inputs.js).

import React, { useEffect, useState } from "react";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import { chamferOrFilletItem } from "../../three/occClient.js";
import { activePrecision } from "../../three/resolution.js";
import {
  buildChamferSourceAndSubGeo,
  commitChamferResult,
} from "../../three/cameraControls/chamferCommit.js";
import FormulaInput from "../FormulaInput";
import { evalValue, useDebouncedPreview } from "../inputs.jsx";
import { pickBtn } from "./overlayBar.js";

const fieldStyle = (ok) => ({
  width: 64,
  marginRight: 8,
  border: `1px solid ${ok ? "var(--border-color)" : "#e87575"}`,
});

export default function ChamferOverlay() {
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const printPrecision = useStore(activePrecision);
  const showNotification = useStore((s) => s.showNotification);
  const chamferRetargetTarget = useStore((s) => s.chamferRetargetTarget);
  const setChamferRetargetTarget = useStore((s) => s.setChamferRetargetTarget);

  // Raw strings so the field can be cleared while typing and so variable
  // formulas (resolved against `variables`) are accepted.
  const [distanceMm, setDistanceMm] = useState("0.5");
  const [angleDeg, setAngleDeg] = useState("45");

  const isChamfer = chamferSelectMode === "chamfer";
  const hasSelection =
    selectedSubGeometry &&
    ((selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0);

  const distVal = evalValue(distanceMm, variables); // mm
  const angVal = evalValue(angleDeg, variables); // degrees
  const distValid = Number.isFinite(distVal) && distVal > 0;
  const angValid =
    !isChamfer || (Number.isFinite(angVal) && angVal > 0 && angVal < 90);
  const valid = distValid && angValid;

  // beginChamferRetarget pre-selects the prior subGeo and arms
  // chamferRetargetTarget — seed the inputs from that operation's recipe so
  // Confirm reproduces it by default (the user can still tweak before
  // confirming).
  useEffect(() => {
    if (!chamferRetargetTarget) return;
    const item = items.find((i) => i.id === chamferRetargetTarget.itemId);
    const prior = item?.regenerator;
    if (!prior || prior.kind !== "chamfer") return;
    setDistanceMm(String(prior.amount * MM_PER_UNIT));
    setAngleDeg(
      prior.angleRad != null ? String((prior.angleRad * 180) / Math.PI) : "45",
    );
  }, [chamferRetargetTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview: debounced re-run while a valid distance/angle and a selection
  // exist; cleared the moment the value goes blank/invalid.
  useDebouncedPreview(
    !!chamferSelectMode && !!hasSelection && valid,
    () =>
      useStore
        .getState()
        ._cameraControls?.updateChamferPreview?.(
          distVal,
          isChamfer ? angVal : 45,
        ),
    () => useStore.getState()._cameraControls?.clearChamferPreview?.(),
    [distVal, angVal, isChamfer, selectedSubGeometry],
  );

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
  // segments=1 → chamfer (flat); segments>1 → bevel (rounded).
  const applyChamfer = async () => {
    if (!valid || !hasSelection) return;
    const segments = isChamfer ? 1 : 3;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;
    const retargetEntryId =
      chamferRetargetTarget?.itemId === item.id
        ? chamferRetargetTarget.entryId
        : null;

    try {
      const amount = distVal / MM_PER_UNIT;
      // Only chamfer (segments=1) uses the angle; fillet is purely
      // radius-driven.  Treat angle ≈ 45° as "symmetric" and skip the AddDA
      // path.
      const angleRad =
        segments === 1 && Math.abs(angVal - 45) > 0.1
          ? (angVal * Math.PI) / 180
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
    if (e.key === "Enter") {
      if (valid && hasSelection) applyChamfer();
    } else if (e.key === "Escape") cancel();
  };

  const selCount =
    (selectedSubGeometry?.faces?.length ?? 0) +
    (selectedSubGeometry?.edges?.length ?? 0);

  const confirmOk = valid && hasSelection;

  return (
    <>
      <div className="sketch-placement-hint">
        {hasSelection
          ? "Set the distance below, then Confirm · Esc to cancel"
          : "Alt+click faces (chained) or Ctrl+click edges to select geometry to chamfer/fillet · Esc to cancel"}
      </div>
      <div className="sketch-distance-input-overlay">
        <button
          type="button"
          onClick={() => clearSelectedSubGeometry()}
          title="Pick geometry — Alt+click faces, Ctrl+click edges (click to clear + re-pick)"
          style={{ ...pickBtn(!hasSelection), marginRight: 8 }}
        >
          {hasSelection ? `Geometry: ${selCount}` : "Select geometry"}
        </button>
        <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
          Distance (mm):
        </span>
        <FormulaInput
          variables={variables}
          autoFocus
          value={distanceMm}
          onChange={(e) => setDistanceMm(e.target.value)}
          onKeyDown={handleKeyDown}
          style={fieldStyle(distValid)}
        />
        {isChamfer && (
          <>
            <span style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}>
              Angle (°):
            </span>
            <FormulaInput
              variables={variables}
              value={angleDeg}
              onChange={(e) => setAngleDeg(e.target.value)}
              onKeyDown={handleKeyDown}
              style={fieldStyle(angValid)}
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
          disabled={!confirmOk}
          title={
            confirmOk
              ? `Confirm — apply the ${isChamfer ? "chamfer" : "fillet"}`
              : hasSelection
                ? "Enter a valid value to confirm"
                : "Select geometry first"
          }
          style={{
            fontSize: 11,
            padding: "3px 10px",
            marginLeft: 8,
            borderRadius: 3,
            border: "1px solid var(--accent, #4488ff)",
            background: "var(--accent, #4488ff)",
            color: "#fff",
            cursor: confirmOk ? "pointer" : "not-allowed",
            opacity: confirmOk ? 1 : 0.5,
          }}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
