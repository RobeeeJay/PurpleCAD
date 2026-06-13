import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { offsetSelectedSketchGeometry } from "../../three/sketchModifyActions.js";

const SketchModifySection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const sketchModifyMode = useStore((s) => s.sketchModifyMode);
  const setSketchModifyMode = useStore((s) => s.setSketchModifyMode);
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const startMirrorTool = useStore((s) => s.startMirrorTool);
  const cancelMirrorTool = useStore((s) => s.cancelMirrorTool);
  const sketchMultiSelectedIndices = useStore(
    (s) => s.sketchMultiSelectedIndices,
  );
  const toggleSketchShapesDashed = useStore((s) => s.toggleSketchShapesDashed);
  const selectedSketchElement = useStore((s) => s.selectedSketchElement);

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
  // offset to the other (negative) side.
  const handleOffset = (e) => {
    offsetSelectedSketchGeometry(selectedId, selectedIndices, e.shiftKey);
  };

  // Mirror: pick a mirror line, then click geometry to preview/toggle its
  // reflection; Confirm creates copies linked by a mirror constraint.
  const handleMirror = () => {
    if (activeSketchTool === "mirror") cancelMirrorTool();
    else startMirrorTool();
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
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="4,20 4,13 9,8 16,8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="13" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="9" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="9"
            y2="8"
          />
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
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            d="M4 20 L4 14 Q4 8 10 8 L16 8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="14" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="10" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="14"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="10"
            y2="8"
          />
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
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeDasharray="3 2.5"
            x1="3"
            y1="21"
            x2="21"
            y2="3"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="21" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="3" />
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
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M5 17 L5 8 L14 8"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M8 20 L8 11 L17 11"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="5"
            y1="8"
            x2="8"
            y2="11"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="5"
            y1="17"
            x2="8"
            y2="20"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="14"
            y1="8"
            x2="17"
            y2="11"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "mirror" ? "active" : ""}`}
        title="Mirror — pick a mirror line, then click geometry to reflect across it"
        onClick={handleMirror}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 2"
            x1="12"
            y1="2"
            x2="12"
            y2="22"
          />
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M11 4 L11 10 L4 17"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M13 4 L13 10 L20 17"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default SketchModifySection;
