// Motion dialog for a component: rotation about an axis, or a slide along
// one.  The Reference button is live as it opens -- pick a flat face, a
// straight edge or a hole's rim on any part -- and the axis it defines is drawn
// in the view (three/cameraControls/componentMotionTool.js).  Opened from the
// component's motion button in the Objects list; Confirm stores the motion on
// the component, which its play button then runs.

import { useStore } from "../../store";
import { motionToolProblem } from "../../store/motionSlice.js";
import { DebouncedNumberField, useEscapeKey } from "../inputs.jsx";
import ToolErrorLine from "../ToolErrorLine.jsx";
import { BAR_STYLE, Field, barBtn, pickBtn, toggleBtn } from "./overlayBar.js";

const fieldStyle = {
  width: 52,
  fontSize: 11,
  padding: "2px 4px",
  borderRadius: 3,
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
};

const REFERENCE_LABEL = {
  face: "Face ✓",
  edge: "Edge ✓",
  circle: "Rim ✓",
};

export default function ComponentMotionOverlay() {
  const tool = useStore((s) => s.motionTool);
  const folderName = useStore(
    (s) => s.folders.find((f) => f.id === s.motionTool?.folderId)?.name,
  );
  useEscapeKey(!!tool, () => useStore.getState().cancelMotionTool());
  if (!tool) return null;

  const store = () => useStore.getState();
  const rotation = tool.type === "rotation";
  const unit = rotation ? "°" : "mm";
  const values = tool.values[tool.type];
  const problem = motionToolProblem(tool);

  const hint = tool.picking
    ? "Pick the reference on any part: Alt+click a flat face, or Ctrl+click a straight edge or a hole's rim · Esc to cancel"
    : rotation
      ? `${folderName} turns about the dashed axis · Esc to cancel`
      : `${folderName} slides along the dashed axis · Esc to cancel`;

  const number = (key, label, hintText) => (
    <Field label={label} hint={hintText} style={{ marginLeft: 8 }}>
      <DebouncedNumberField
        key={`${tool.type}-${key}`}
        step="any"
        storeValue={values[key]}
        validate={(v) => Number.isFinite(v) && v >= 0}
        commit={(v) => store().setMotionValue(key, v)}
        style={fieldStyle}
        aria-label={label}
      />
    </Field>
  );

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div
        className="sketch-distance-input-overlay component-motion-overlay"
        style={BAR_STYLE}
      >
        <button
          type="button"
          style={toggleBtn(rotation)}
          onClick={() => store().setMotionType("rotation")}
          title="Turn the component about the reference axis"
        >
          Rotation
        </button>
        <button
          type="button"
          style={{ ...toggleBtn(!rotation), marginLeft: 4 }}
          onClick={() => store().setMotionType("axis")}
          title="Slide the component along the reference axis"
        >
          Axis
        </button>
        <Field
          label="Reference"
          style={{ marginLeft: 10 }}
          hint="What the motion follows. A flat face: its centre and normal. A hole's rim: its centre and axis. A straight edge: along the edge."
        >
          <button
            type="button"
            style={pickBtn(tool.picking)}
            onClick={() => store().setMotionPicking(true)}
            title="Pick the reference on any part"
          >
            {!tool.picking && tool.reference
              ? (REFERENCE_LABEL[tool.reference.kind] ?? "Picked ✓")
              : "Pick"}
          </button>
        </Field>
        {number(
          "positive",
          `+ (${unit})`,
          rotation
            ? "How far it turns in the positive direction, in degrees."
            : "How far it slides in the positive direction, in mm.",
        )}
        {number(
          "negative",
          `− (${unit})`,
          rotation
            ? "How far it turns the other way, in degrees."
            : "How far it slides the other way, in mm.",
        )}
        {number(
          "speed",
          `Speed (${unit}/s)`,
          rotation
            ? "Degrees per second while it plays."
            : "Millimetres per second while it plays.",
        )}
        <label
          style={{
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: 8,
          }}
          title="While it plays, stop the moment it runs into anything, and ring the spot in red. Contact it already has at rest is not counted."
        >
          <input
            type="checkbox"
            checked={tool.detectCollisions}
            onChange={(e) =>
              store().setMotionDetectCollisions(e.target.checked)
            }
            aria-label="Detect collisions"
          />
          Detect collisions
        </label>
        <button
          type="button"
          onClick={() => store().cancelMotionTool()}
          title="Cancel"
          style={barBtn()}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => store().confirmMotion()}
          disabled={!!problem}
          title={problem ?? "Save this motion on the component"}
          style={barBtn(true, !!problem)}
        >
          Confirm
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
}
