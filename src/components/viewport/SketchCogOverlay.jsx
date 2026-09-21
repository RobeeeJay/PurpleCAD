// Cog dialog: pick the centre (the button is live as the dialog opens), set
// the gear, Confirm.  The cog is previewed under the cursor while picking and
// at its centre afterwards (three/cameraControls/sketchCogTool.js).  Re-opened
// on an existing cog by double-clicking its marker, where Confirm updates it in
// place.  "Break into vectors" commits plain lines instead of an editable cog.

import React from "react";
import { useStore } from "../../store";
import { cogToolProblem } from "../../store/sketchCogSlice.js";
import { DebouncedNumberField, useEscapeKey } from "../inputs.jsx";
import { BAR_STYLE, Field, barBtn, pickBtn } from "./overlayBar.js";

const fieldStyle = {
  width: 52,
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 3,
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
};

// Each value: its label, what changing it does, and what a field accepts on
// its own (the gear as a whole is checked by cogToolProblem).
const FIELDS = [
  {
    key: "pitchDiameter",
    label: "Pitch Ø (mm)",
    hint: "Diameter of the pitch circle, where teeth of meshing gears roll on each other. With the tooth count it sets the tooth size (module = pitch diameter ÷ teeth); the teeth reach one module beyond it.",
    ok: (v) => v > 0,
  },
  {
    key: "teeth",
    label: "Teeth",
    hint: "Number of teeth. Gears mesh when their tooth size (pitch diameter ÷ teeth) matches.",
    ok: (v) => Number.isInteger(v) && v > 0,
    step: 1,
  },
  {
    key: "holeDiameter",
    label: "Hole Ø (mm)",
    hint: "Diameter of the hole at the centre, for a shaft. 0 leaves no hole.",
    ok: (v) => v >= 0,
  },
  {
    key: "backlash",
    label: "Backlash (mm)",
    hint: "Play between meshing teeth at the pitch circle. Each tooth is thinned by half of it, so two gears made this way leave this much free movement between them.",
    ok: (v) => v >= 0,
  },
  {
    key: "rootFillet",
    label: "Root fillet (mm)",
    hint: "Radius rounding the corner where each tooth meets the root circle. Too big to fit the gap is drawn as the largest that does.",
    ok: (v) => v >= 0,
  },
];

export default function SketchCogOverlay({ sketchMode, selectedId }) {
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const tool = useStore((s) => s.sketchCogState);
  const open = sketchMode && activeSketchTool === "cog" && !!tool;
  useEscapeKey(open, () => useStore.getState().cancelCogTool());

  // A blank or unparseable field blocks Confirm until it is fixed.
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

  const store = () => useStore.getState();
  const editing = tool.editIdx != null;
  // Missing the centre is what the hint and the live button already say; only
  // a gear that can't be made needs spelling out.
  const problem = Object.keys(invalid).length
    ? "Fix the highlighted value."
    : cogToolProblem(tool);
  const gearProblem = tool.centre ? problem : null;
  const ready = !problem;

  const hint = tool.picking
    ? "Click the cog's centre — an existing point snaps · Esc to cancel"
    : editing
      ? "Change the cog, then Update · Esc to cancel"
      : "Set the cog, then Confirm · Esc to cancel";

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div
        className="sketch-distance-input-overlay sketch-cog-overlay"
        style={BAR_STYLE}
      >
        <Field
          label="Cog"
          hint="The point the gear is centred on. Click the button, then a point in the sketch."
        >
          <button
            type="button"
            style={pickBtn(tool.picking)}
            onClick={() => store().setCogPicking(true)}
            title="Pick the centre point"
          >
            {tool.centre && !tool.picking ? "Centre ✓" : "Centre"}
          </button>
        </Field>
        {FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.hint}
            style={{ marginLeft: 8 }}
          >
            <DebouncedNumberField
              step={f.step ?? "any"}
              storeValue={tool.params[f.key]}
              validate={(v) => Number.isFinite(v) && f.ok(v)}
              onValidChange={reportValid(f.key)}
              commit={(v) => store().setCogParam(f.key, v)}
              style={fieldStyle}
              aria-label={f.label}
            />
          </Field>
        ))}
        <label
          style={{
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: 8,
          }}
          title="Make the cog out of plain lines instead. They can be edited one by one, but it is no longer a cog: it can't be re-opened here."
        >
          <input
            type="checkbox"
            checked={tool.explode}
            onChange={(e) => store().setCogExplode(e.target.checked)}
            aria-label="Break into vectors"
          />
          Break into vectors
        </label>
        {gearProblem && (
          <span
            className="sketch-cog-problem"
            style={{ fontSize: 11, color: "#e87575", marginLeft: 8 }}
          >
            {gearProblem}
          </span>
        )}
        <button
          type="button"
          onClick={() => store().cancelCogTool()}
          title="Cancel"
          style={barBtn()}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => store().confirmCog(selectedId)}
          disabled={!ready}
          title={
            ready ? (editing ? "Update this cog" : "Add the cog") : problem
          }
          style={barBtn(true, !ready)}
        >
          {editing ? "Update" : "Confirm"}
        </button>
      </div>
    </>
  );
}
