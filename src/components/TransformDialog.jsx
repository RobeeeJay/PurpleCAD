import React, { useState } from "react";
import { useStore } from "../store";
import { NumberInput } from "./inputs";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { lengthToScale, scaleToLength } from "../utils/transformMath.js";
import "../styles/TransformDialog.css";

// Floating transform panel shown while a single non-sketch object is selected
// (the rotation gizmo is visible).  Live inputs for position (mm), per-axis
// length (mm) and rotation (deg) — an alternative to dragging the gizmo.  The
// lock scales the lengths proportionally across all axes; unlocked edits one
// axis.  Each edit applies live (setItemTransform) and merges into the
// timeline's Moved/Scaled/Rotated step (recordTransformHistory).
const AXES = ["x", "y", "z"];
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const TransformDialog = () => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const cameraControls = useStore((s) => s._cameraControls);
  const setItemTransform = useStore((s) => s.setItemTransform);
  const recordTransformHistory = useStore((s) => s.recordTransformHistory);
  // Tool overlays that own the bottom bar / gizmo — hide the panel then.
  const busy = useStore(
    (s) =>
      !!(
        s.measureTool ||
        s.boxDialog ||
        s.holeTool ||
        s.embossTool ||
        s.draftTool ||
        s.planeTool ||
        s.sweepSelectMode ||
        s.chamferSelectMode ||
        s.pushPullSelectMode ||
        s.booleanTool
      ),
  );
  const [locked, setLocked] = useState(true);

  const item = items.find((i) => i.id === selectedId);
  if (!item || item.type === "sketch" || selectedIds.length > 1 || busy)
    return null;

  const pos = item.position || { x: 0, y: 0, z: 0 };
  const scale = item.scale || { x: 1, y: 1, z: 1 };
  const rot = item.rotation || { x: 0, y: 0, z: 0 };
  const local = cameraControls?.getItemLocalSizeMm?.(selectedId) || null;
  const lengthMm = (a) => scaleToLength(scale, local, a);

  const applyPos = (a, mm) => {
    if (!Number.isFinite(mm)) return;
    setItemTransform(selectedId, { ...pos, [a]: mm / MM_PER_UNIT }, null, null);
    recordTransformHistory(selectedId, "Moved");
  };

  const applyLength = (a, mm) => {
    const next = Number.isFinite(mm)
      ? lengthToScale(scale, local, a, mm, locked)
      : null;
    if (!next) return;
    setItemTransform(selectedId, null, next, null);
    recordTransformHistory(selectedId, "Scaled");
  };

  const applyRot = (a, deg) => {
    if (!Number.isFinite(deg)) return;
    setItemTransform(selectedId, null, null, { ...rot, [a]: deg * DEG2RAD });
    recordTransformHistory(selectedId, "Rotated");
  };

  const row = (label, render, extra) => (
    <div className="tf-row">
      <span className="tf-label">{label}</span>
      <div className="tf-fields">
        {AXES.map((a) => (
          <label key={a} className={`tf-field tf-axis-${a}`}>
            <span>{a.toUpperCase()}</span>
            {render(a)}
          </label>
        ))}
      </div>
      {extra}
    </div>
  );

  return (
    <div className="transform-dialog">
      <div className="tf-title">{item.name || "Object"}</div>
      {row("Position (mm)", (a) => (
        <NumberInput
          value={pos[a] * MM_PER_UNIT}
          onCommit={(v) => applyPos(a, v)}
        />
      ))}
      {row(
        "Length (mm)",
        (a) => (
          <NumberInput
            value={lengthMm(a) ?? 0}
            disabled={!local}
            onCommit={(v) => applyLength(a, v)}
          />
        ),
        <button
          className={`tf-lock${locked ? " on" : ""}`}
          title={
            locked
              ? "Lengths scale proportionally — click to edit axes individually"
              : "Lengths scale individually — click to lock proportions"
          }
          onClick={() => setLocked((v) => !v)}
        >
          {locked ? "🔒" : "🔓"}
        </button>,
      )}
      {row("Rotation (°)", (a) => (
        <NumberInput
          value={rot[a] * RAD2DEG}
          onCommit={(v) => applyRot(a, v)}
        />
      ))}
    </div>
  );
};

export default TransformDialog;
