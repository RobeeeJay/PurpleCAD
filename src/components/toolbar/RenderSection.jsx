import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const RenderSection = () => {
  const renderMode = useStore((s) => s.renderMode);
  const setRenderMode = useStore((s) => s.setRenderMode);

  return (
    <ToolbarSection label="Render">
      <button
        className={`toolbar-btn ${renderMode === "wireframe" ? "active" : ""}`}
        title="Wireframe"
        onClick={() => setRenderMode("wireframe")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M3 5v14h18V5m0 7h-18m9-7v14" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "shaded" ? "active" : ""}`}
        title="Shaded"
        onClick={() => setRenderMode("shaded")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M3 5v14h18V5z" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "smooth" ? "active" : ""}`}
        title="Smooth"
        onClick={() => setRenderMode("smooth")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="currentColor" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <path d="M3 5v14h18V5z" fill="url(#grad)" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default RenderSection;
