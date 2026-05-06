import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const ExtrudeSection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const setExtrudeRetargetId = useStore((s) => s.setExtrudeRetargetId);

  return (
    <ToolbarSection label="Extrude">
      <button
        className={`toolbar-btn ${extrudeSelectMode === "profile" ? "active" : ""}`}
        title="Retarget Profile — pick a new face or sketch region to extrude from"
        onClick={() => {
          setExtrudeRetargetId(selectedId);
          setExtrudeSelectMode("profile");
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            x="3"
            y="14"
            width="12"
            height="7"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polygon
            points="3,14 6,9 18,9 18,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.6"
          />
          <circle
            cx="19"
            cy="5"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line
            x1="19"
            y1="2"
            x2="19"
            y2="1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="19"
            y1="8"
            x2="19"
            y2="9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="16"
            y1="5"
            x2="15"
            y2="5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="22"
            y1="5"
            x2="23"
            y2="5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="19" cy="5" r="1" fill="currentColor" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default ExtrudeSection;
