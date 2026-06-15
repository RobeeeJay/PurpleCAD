import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const RenderSection = () => {
  const renderMode = useStore((s) => s.renderMode);
  const setRenderMode = useStore((s) => s.setRenderMode);
  const curveResolution = useStore((s) => s.curveResolution);
  const toggleCurveResolution = useStore((s) => s.toggleCurveResolution);
  const shadowsEnabled = useStore((s) => s.shadowsEnabled);
  const setShadowsEnabled = useStore((s) => s.setShadowsEnabled);
  const crossSectionView = useStore((s) => s.crossSectionView);
  const toggleCrossSectionView = useStore((s) => s.toggleCrossSectionView);
  const pathTraceView = useStore((s) => s.pathTraceView);
  const togglePathTraceView = useStore((s) => s.togglePathTraceView);

  return (
    <ToolbarSection label="Render">
      <button
        className={`toolbar-btn ${renderMode === "wireframe" ? "active" : ""}`}
        title="Wireframe (1)"
        onClick={() => setRenderMode("wireframe")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="3"
            y="7"
            width="14"
            height="14"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,7 7,3 21,3 21,17 17,21"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="17"
            y1="7"
            x2="17"
            y2="21"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="7"
            x2="17"
            y2="7"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="7"
            y1="3"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="21"
            y1="3"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="3"
            y1="21"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="7"
            y1="17"
            x2="17"
            y2="17"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "shaded" ? "active" : ""}`}
        title="Shaded (2)"
        onClick={() => setRenderMode("shaded")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.55)"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,8 17,8 17,21 3,21"
          />
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.25)"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,8 7,4 21,4 17,8"
          />
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.38)"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="17,8 21,4 21,17 17,21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="7"
            y1="4"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="21"
            y1="4"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="7"
            y1="17"
            x2="17"
            y2="17"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "transparent" ? "active" : ""}`}
        title="Transparent (50%) (3)"
        onClick={() => setRenderMode("transparent")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="3"
            y1="21"
            x2="3"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="3"
            y1="8"
            x2="17"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="7"
            y1="4"
            x2="3"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="7"
            y1="17"
            x2="3"
            y2="21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="7"
            y1="17"
            x2="17"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 1.5"
            x1="7"
            y1="17"
            x2="7"
            y2="4"
          />
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.07)"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,8 17,8 17,21 3,21"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,8 7,4 21,4 21,17 17,21"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="17"
            y1="8"
            x2="17"
            y2="21"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="8"
            x2="17"
            y2="8"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="7"
            y1="4"
            x2="21"
            y2="4"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${pathTraceView ? "active" : ""}`}
        title={
          pathTraceView
            ? "Path-traced render on — click to return to the raster view (4)"
            : "Path-traced render (prototype) — progressive GPU ray tracing (4)"
        }
        onClick={togglePathTraceView}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.55)"
            strokeWidth="1.5"
            cx="12"
            cy="12"
            r="9"
          />
          <circle
            stroke="#6C3FD4"
            fill="rgba(30,10,80,0.25)"
            strokeWidth="0"
            cx="12"
            cy="12"
            r="9"
          />
          <circle
            stroke="none"
            fill="rgba(108,63,212,0.3)"
            strokeWidth="0"
            cx="12"
            cy="13"
            r="7"
          />
          <ellipse
            stroke="none"
            fill="rgba(212,163,63,0.9)"
            cx="8.5"
            cy="8"
            rx="2.5"
            ry="1.8"
            transform="rotate(-25 8.5 8)"
          />
          <ellipse
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="0.75"
            strokeDasharray="2 2"
            cx="12"
            cy="12"
            rx="9"
            ry="3"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${shadowsEnabled ? "active" : ""}`}
        title={
          shadowsEnabled
            ? "Shadows on — click to disable (5)"
            : "Shadows off — click to enable ground-plane shadows (5)"
        }
        onClick={() => setShadowsEnabled(!shadowsEnabled)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <ellipse
            stroke="#D4A33F"
            fill="rgba(212,163,63,0.2)"
            strokeWidth="1.5"
            cx="12"
            cy="20"
            rx="8"
            ry="2.5"
          />
          <rect
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.15)"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="7"
            y="5"
            width="10"
            height="10"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="7"
            y1="15"
            x2="5"
            y2="20"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="17"
            y1="15"
            x2="19"
            y2="20"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="3"
            x2="6"
            y2="6"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="3" />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${crossSectionView ? "active" : ""}`}
        title={
          crossSectionView
            ? "Cross section view on — click to disable (6)"
            : "Cross section view — hide everything in front of the section plane (tracks the camera) (6)"
        }
        onClick={toggleCrossSectionView}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,7 17,7 17,21 3,21"
          />
          <polyline
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,7 7,3 21,3 21,17 17,21"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="17"
            y1="7"
            x2="17"
            y2="21"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="7"
            x2="17"
            y2="7"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="7"
            y1="3"
            x2="7"
            y2="17"
          />
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.25)"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="3,7 10,7 10,21 3,21"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="10"
            y1="7"
            x2="10"
            y2="21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="3"
            y1="10"
            x2="10"
            y2="10"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="3"
            y1="13"
            x2="10"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="3"
            y1="16"
            x2="10"
            y2="16"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${curveResolution === "print" ? "active" : ""}`}
        title={
          curveResolution === "print"
            ? "High resolution (3D print) — click for preview (8)"
            : "Preview resolution — click for high (3D print) (8)"
        }
        onClick={toggleCurveResolution}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            cx="10"
            cy="10"
            r="7"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="3"
            y1="10"
            x2="17"
            y2="10"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="10"
            y1="3"
            x2="10"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="5"
            y1="7"
            x2="15"
            y2="7"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="5"
            y1="13"
            x2="15"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="7"
            y1="5"
            x2="7"
            y2="15"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
            x1="13"
            y1="5"
            x2="13"
            y2="15"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            x1="15"
            y1="15"
            x2="21"
            y2="21"
          />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.5" cx="21" cy="21" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default RenderSection;
