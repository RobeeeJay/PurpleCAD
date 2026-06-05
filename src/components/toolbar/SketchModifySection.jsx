import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const SketchModifySection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const sketchModifyMode = useStore((s) => s.sketchModifyMode);
  const setSketchModifyMode = useStore((s) => s.setSketchModifyMode);
  const sketchMultiSelectedIndices = useStore(
    (s) => s.sketchMultiSelectedIndices,
  );
  const toggleSketchShapesDashed = useStore((s) => s.toggleSketchShapesDashed);
  const selectedSketchElement = useStore((s) => s.selectedSketchElement);
  const offsetSketchGeometry = useStore((s) => s.offsetSketchGeometry);
  const setSketchDistanceInput = useStore((s) => s.setSketchDistanceInput);
  const setSketchConstraintMode = useStore((s) => s.setSketchConstraintMode);

  const selectedIndices =
    sketchMultiSelectedIndices.length > 0
      ? sketchMultiSelectedIndices
      : selectedSketchElement?.type === "line"
        ? [selectedSketchElement.shapeIdx]
        : [];

  const handleToggleDashed = () => {
    if (selectedIndices.length > 0)
      toggleSketchShapesDashed(selectedId, selectedIndices);
  };

  // Offset creates a parallel copy linked to each source line; hold Shift to
  // offset to the other (negative) side.  We seed it at 5 mm, then immediately
  // open the dimension editor so the user is prompted for the real distance
  // (window.prompt isn't usable inside Electron).
  const handleOffset = (e) => {
    if (selectedIndices.length === 0) return;
    offsetSketchGeometry(selectedId, selectedIndices, e.shiftKey ? "-5" : "5");
    const item = useStore.getState().items.find((i) => i.id === selectedId);
    const constraints = item?.constraints || [];
    let lastIdx = -1;
    let lastGroup = -1;
    constraints.forEach((c, i) => {
      if (c.type === "offset" && (c.offsetGroup ?? 0) >= lastGroup) {
        lastGroup = c.offsetGroup ?? 0;
        lastIdx = i;
      }
    });
    if (lastIdx >= 0) {
      setSketchDistanceInput({
        offsetConstraintIdx: lastIdx,
        offsetGroup: constraints[lastIdx].offsetGroup,
        defaultDistance: constraints[lastIdx].distance,
      });
      setSketchConstraintMode("distance");
    }
  };

  return (
    <ToolbarSection label="Modify">
      <button
        className={`toolbar-btn ${sketchModifyMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — trim two connected lines and join with a straight edge"
        onClick={() =>
          setSketchModifyMode(sketchModifyMode === "chamfer" ? null : "chamfer")
        }
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polyline
            points="4,20 4,8 14,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line
            x1="4"
            y1="8"
            x2="14"
            y2="20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="4" cy="8" r="2" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${sketchModifyMode === "bevel" ? "active" : ""}`}
        title="Bevel — trim two connected lines and join with a smooth arc"
        onClick={() =>
          setSketchModifyMode(sketchModifyMode === "bevel" ? null : "bevel")
        }
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4,20 L4,10 Q4,8 6,8 L14,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <line
            x1="14"
            y1="8"
            x2="20"
            y2="8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="4" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Toggle Dashed — dashed lines constrain geometry but don't form closed regions or extrusions"
        disabled={
          sketchMultiSelectedIndices.length === 0 &&
          selectedSketchElement?.type !== "line"
        }
        onClick={handleToggleDashed}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 3"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Offset — parallel copy of the selected lines, linked by a distance constraint (hold Shift for the other side)"
        disabled={selectedIndices.length === 0}
        onClick={handleOffset}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 18 L8 6 L16 6 L20 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 20.5 L11 10 L13 10 L16.5 20.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity="0.55"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default SketchModifySection;
