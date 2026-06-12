import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const BevelSection = ({ bare = false }) => {
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);

  const toggleMode = (mode) => {
    if (chamferSelectMode === mode) {
      setChamferSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setChamferSelectMode(mode);
    }
  };

  const body = (
    <>
      <button
        className={`toolbar-btn ${chamferSelectMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — select faces/edges, then confirm a distance"
        onClick={() => toggleMode("chamfer")}
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
        className={`toolbar-btn ${chamferSelectMode === "fillet" ? "active" : ""}`}
        title="Bevel — select faces/edges, then confirm a radius"
        onClick={() => toggleMode("fillet")}
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
    </>
  );
  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default BevelSection;
