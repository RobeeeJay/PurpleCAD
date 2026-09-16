// Centre constraint dialog: pick Shape A and Shape B, set an optional X/Y
// offset, Confirm.  The shape under the cursor is previewed while a pick
// button is live, and once both are picked a ghost shows where A will land
// (three/cameraControls/sketchCentreTool.js).  Re-opened on an existing centre
// constraint by double-clicking its icon, where Confirm updates it in place.

import React from "react";
import { useStore } from "../../store";
import { DebouncedNumberField, useEscapeKey } from "../inputs.jsx";
import { BAR_STYLE, Field, barBtn, pickBtn } from "./overlayBar.js";

const offsetStyle = {
  width: 56,
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 3,
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
};

export default function SketchCentreOverlay({
  sketchMode,
  selectedId,
  variables,
}) {
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const tool = useStore((s) => s.sketchCentreState);
  const open = sketchMode && activeSketchTool === "centre" && !!tool;
  useEscapeKey(open, () => useStore.getState().cancelCentreTool());

  // A blank or unparseable offset blocks Confirm until it is fixed.
  const [invalid, setInvalid] = React.useState({});
  const reportValid = React.useCallback(
    (key) => (valid) =>
      setInvalid((prev) =>
        valid === !prev[key]
          ? prev
          : valid
            ? Object.fromEntries(
                Object.entries(prev).filter(([k]) => k !== key),
              )
            : { ...prev, [key]: true },
      ),
    [],
  );

  if (!open) return null;

  const hasA = tool.shapesA.length > 0;
  const hasB = tool.shapesB.length > 0;
  const ready = hasA && hasB && Object.keys(invalid).length === 0;
  const editing = tool.editIdx != null;
  const store = () => useStore.getState();

  const hint =
    tool.picking === "A"
      ? "Click the shape to move (Shape A) · Esc to cancel"
      : tool.picking === "B"
        ? "Click the shape to centre it on (Shape B) · Esc to cancel"
        : "Shape A's centre goes on Shape B's, plus the offset · Esc to cancel";

  const offsetField = (axis, label) => (
    <Field
      label={label}
      style={{ marginLeft: 8 }}
      hint={`How far Shape A's centre sits from Shape B's along the sketch ${axis.toUpperCase()} axis, in mm. A variable or formula works too.`}
    >
      <DebouncedNumberField
        step="any"
        variables={variables}
        storeValue={axis === "x" ? tool.offsetX : tool.offsetY}
        validate={(v) => Number.isFinite(v)}
        onValidChange={reportValid(axis)}
        commit={(v, raw) => store().setCentreOffset(axis, raw ?? v)}
        style={offsetStyle}
        aria-label={`Offset ${axis.toUpperCase()} (mm)`}
      />
    </Field>
  );

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div
        className="sketch-distance-input-overlay sketch-centre-overlay"
        style={BAR_STYLE}
      >
        <Field
          label="Centre"
          hint="A shape is a connected run of lines, arcs, curves or a circle — the same set a double-click selects."
        >
          <button
            type="button"
            style={pickBtn(tool.picking === "A")}
            onClick={() => store().setCentrePicking("A")}
            title="Pick the shape to move"
          >
            {hasA ? "Shape A ✓" : "Shape A"}
          </button>
          <button
            type="button"
            style={{ ...pickBtn(tool.picking === "B"), marginLeft: 6 }}
            onClick={() => store().setCentrePicking("B")}
            title="Pick the shape to centre it on"
          >
            {hasB ? "Shape B ✓" : "Shape B"}
          </button>
        </Field>
        {offsetField("x", "Offset X (mm)")}
        {offsetField("y", "Offset Y (mm)")}
        <button
          type="button"
          onClick={() => store().cancelCentreTool()}
          title="Cancel"
          style={barBtn()}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => store().confirmCentre(selectedId)}
          disabled={!ready}
          title={
            ready
              ? editing
                ? "Update this centre constraint"
                : "Centre Shape A on Shape B"
              : "Pick both shapes first"
          }
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
