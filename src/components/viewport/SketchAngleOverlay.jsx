// The field for an angle dimension: opened by the toolbar on two selected lines,
// or by double-clicking the dimension's marker.  It shares the distance field's
// place and look.

import FormulaInput from "../FormulaInput";
import { useStore } from "../../store";

export default function SketchAngleOverlay({
  selectedId,
  variables,
  cameraControlsRef,
}) {
  const input = useStore((s) => s.sketchAngleInput);
  if (!input) return null;

  const hint =
    "Angle between the two lines, in degrees. Changing it turns the first line picked if it can, otherwise as little of the sketch as it takes.";
  return (
    <div className="sketch-distance-input-overlay" title={hint}>
      <span>
        {input.constraintIdx != null ? "Edit angle (°):" : "Angle (°):"}
      </span>
      <FormulaInput
        key={`${input.shapeAIdx}-${input.shapeBIdx}-${input.constraintIdx ?? "new"}`}
        type="text"
        autoFocus
        title={hint}
        variables={variables}
        defaultValue={String(input.defaultAngle)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const s = useStore.getState();
          if (e.key === "Enter") {
            s.applySketchAngle(selectedId, e.target.value.trim());
            cameraControlsRef.current?.refreshSketchSelectionOverlay?.();
          } else if (e.key === "Escape") {
            s.setSketchAngleInput(null);
          }
        }}
      />
    </div>
  );
}
