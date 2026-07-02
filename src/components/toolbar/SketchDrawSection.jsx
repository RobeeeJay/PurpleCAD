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
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
          x="3"
          y="5"
          width="18"
          height="14"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="5" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="5" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="19" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="19" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          cx="12"
          cy="12"
          r="9"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="12"
          y1="3"
          x2="12"
          y2="5"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="12"
          y1="19"
          x2="12"
          y2="21"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="3"
          y1="12"
          x2="5"
          y2="12"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="19"
          y1="12"
          x2="21"
          y2="12"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="12" />
      </svg>
    ),
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <ellipse
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          cx="12"
          cy="12"
          rx="9"
          ry="5.5"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="12"
          y1="6.5"
          x2="12"
          y2="17.5"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="3"
          y1="12"
          x2="21"
          y2="12"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="12" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="3"
          y1="21"
          x2="21"
          y2="3"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="21" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="3" />
      </svg>
    ),
  },
  {
    id: "arc",
    label: "Arc",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          d="M4 18 A10 10 0 0 1 20 18"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="18" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="20" cy="18" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="8" />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="4"
          y1="18"
          x2="12"
          y2="8"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="20"
          y1="18"
          x2="12"
          y2="8"
        />
      </svg>
    ),
  },
  {
    id: "point",
    label: "Point — click to place a point; on a line it's constrained to it",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="12"
          y1="3"
          x2="12"
          y2="9"
        />
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="12"
          y1="15"
          x2="12"
          y2="21"
        />
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="3"
          y1="12"
          x2="9"
          y2="12"
        />
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="15"
          y1="12"
          x2="21"
          y2="12"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="2.5" cx="12" cy="12" />
      </svg>
    ),
  },
  {
    id: "bezier",
    label: "Bezier — click start then end; select it to drag the handles",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          d="M3 18 C6 6, 18 6, 21 18"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="18" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="18" />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="3"
          y1="18"
          x2="6"
          y2="10"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 2"
          x1="21"
          y1="18"
          x2="18"
          y2="10"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.2" cx="6" cy="10" />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.2" cx="18" cy="10" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text — click a start point, then type in the dialog",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="5"
          y1="5"
          x2="19"
          y2="5"
        />
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="square"
          x1="12"
          y1="5"
          x2="12"
          y2="19"
        />
        <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="5" cy="5" />
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
