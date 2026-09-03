import React, { useState } from "react";
import { useStore } from "../store";
import { NumberInput } from "./inputs";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { lengthToScale, scaleToLength } from "../utils/transformMath.js";
import { DISPLAY_AXES } from "../utils/axisDisplay.js";
import "../styles/TransformDialog.css";

// Floating transform panel shown while a single non-sketch object is selected
// (the rotation gizmo is visible).  Live inputs for position (mm), per-axis
// length (mm) and rotation (deg) — an alternative to dragging the gizmo.  The
// lock scales the lengths proportionally across all axes; unlocked edits one
// axis.  Each edit applies live (setItemTransform) and merges into the
// timeline's Moved/Scaled/Rotated step (recordTransformHistory).
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
        s.textureTool ||
        s.draftTool ||
        s.planeTool ||
        s.sweepSelectMode ||
        s.chamferSelectMode ||
        s.pushPullSelectMode ||
        s.booleanTool ||
        s.pattern3dTool ||
        s.mirror3dTool
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

  // `a` is a DISPLAY_AXES entry — the UX shows the Z-up export frame, so the
  // "Y" column reads/writes internal −z, "Z" internal y (sign on the signed
  // quantities only; lengths have none).
  const applyPos = (a, mm) => {
    if (!Number.isFinite(mm)) return;
    setItemTransform(
      selectedId,
      { ...pos, [a.key]: (a.sign * mm) / MM_PER_UNIT },
      null,
      null,
    );
    recordTransformHistory(selectedId, "Moved");
  };

  const applyLength = (a, mm) => {
    const next = Number.isFinite(mm)
      ? lengthToScale(scale, local, a.key, mm, locked)
      : null;
    if (!next) return;
    setItemTransform(selectedId, null, next, null);
    recordTransformHistory(selectedId, "Scaled");
  };

  const applyRot = (a, deg) => {
    if (!Number.isFinite(deg)) return;
    setItemTransform(selectedId, null, null, {
      ...rot,
      [a.key]: a.sign * deg * DEG2RAD,
    });
    recordTransformHistory(selectedId, "Rotated");
  };

  const row = (label, render, extra, hint) => (
    <div className="tf-row">
      <span className="tf-label" title={hint}>
        {label}
      </span>
      <div className="tf-fields">
        {DISPLAY_AXES.map((a) => (
          <label
            key={a.label}
            title={hint}
            className={`tf-field tf-axis-${a.label.toLowerCase()}`}
          >
            <span>{a.label}</span>
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
      {row(
        "Position (mm)",
        (a) => (
          <NumberInput
            value={a.sign * pos[a.key] * MM_PER_UNIT}
            onCommit={(v) => applyPos(a, v)}
          />
        ),
        null,
        "Where the object sits in the world, per axis. Moving it does not resize or rotate it.",
      )}
      {row(
        "Length (mm)",
        (a) => (
          <NumberInput
            value={lengthMm(a.key) ?? 0}
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
        "Overall size of the object along each axis. It scales the existing geometry rather than rebuilding it, so features stretch with the body.",
      )}
      {row(
        "Rotation (°)",
        (a) => (
          <NumberInput
            value={a.sign * rot[a.key] * RAD2DEG}
            onCommit={(v) => applyRot(a, v)}
          />
        ),
        null,
        "Turns the object about its own centre, per axis. Single-axis edits are exact; combined ones apply in a fixed order, so large multi-axis changes are best made one at a time.",
      )}
    </div>
  );
};

export default TransformDialog;
