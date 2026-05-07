import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const SKETCH_TOOLS = [
  {
    id: "rect",
    label: "Rectangle",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <rect
          x="3"
          y="6"
          width="18"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          x1="4"
          y1="20"
          x2="20"
          y2="4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "arc",
    label: "Arc",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          d="M4 20 Q12 2 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "bezier",
    label: "Bezier",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          d="M3 20 C6 4 18 4 21 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="3" cy="20" r="2" fill="currentColor" />
        <circle cx="6" cy="4" r="1.5" fill="currentColor" opacity="0.6" />
        <circle cx="18" cy="4" r="1.5" fill="currentColor" opacity="0.6" />
        <circle cx="21" cy="20" r="2" fill="currentColor" />
      </svg>
    ),
  },
];

const SketchDrawSection = () => {
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const setActiveSketchTool = useStore((s) => s.setActiveSketchTool);

  return (
    <ToolbarSection label="Draw">
      {SKETCH_TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`toolbar-btn ${activeSketchTool === tool.id ? "active" : ""}`}
          title={tool.label}
          onClick={() =>
            setActiveSketchTool(activeSketchTool === tool.id ? null : tool.id)
          }
        >
          {tool.icon}
        </button>
      ))}
    </ToolbarSection>
  );
};

export default SketchDrawSection;
