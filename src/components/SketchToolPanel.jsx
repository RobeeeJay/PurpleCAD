import React from "react";
import { useStore } from "../store";
import "../styles/SketchToolPanel.css";

const TOOLS = [
  {
    id: "rect",
    label: "Rectangle",
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18">
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
      <svg viewBox="0 0 24 24" width="18" height="18">
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
      <svg viewBox="0 0 24 24" width="18" height="18">
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
      <svg viewBox="0 0 24 24" width="18" height="18">
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
      <svg viewBox="0 0 24 24" width="18" height="18">
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
];

const SHAPE_LABELS = {
  rect: "Rectangle",
  circle: "Circle",
  ellipse: "Ellipse",
  line: "Line",
  arc: "Arc",
};

const SketchToolPanel = ({ sketchItem }) => {
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const setActiveSketchTool = useStore((s) => s.setActiveSketchTool);

  const shapes = sketchItem?.shapes || [];

  const toggleTool = (toolId) => {
    setActiveSketchTool(activeSketchTool === toolId ? null : toolId);
  };

  return (
    <div className="sketch-tool-panel">
      <div className="sketch-tool-panel-header">
        <span className="sketch-tool-panel-icon">📋</span>
        <span className="sketch-tool-panel-name">
          {sketchItem?.name ?? "Sketch"}
        </span>
      </div>

      <div className="sketch-section-label">Draw</div>
      <div className="sketch-tool-grid">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`sketch-tool-btn ${activeSketchTool === tool.id ? "active" : ""}`}
            title={tool.label}
            onClick={() => toggleTool(tool.id)}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {shapes.length > 0 && (
        <>
          <div className="sketch-section-label">Shapes</div>
          <div className="sketch-shapes-list">
            {shapes.map((shape, i) => (
              <div key={i} className="sketch-shape-item">
                <span className="sketch-shape-index">{i + 1}</span>
                <span className="sketch-shape-type">
                  {SHAPE_LABELS[shape.type] ?? shape.type}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SketchToolPanel;
