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

  return (
    <ToolbarSection label="Render">
      <button
        className={`toolbar-btn ${renderMode === "wireframe" ? "active" : ""}`}
        title="Wireframe"
        onClick={() => setRenderMode("wireframe")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M3 5v14h18V5m0 7h-18m9-7v14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "shaded" ? "active" : ""}`}
        title="Shaded"
        onClick={() => setRenderMode("shaded")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M3 5v14h18V5z"
            fill="currentColor"
            opacity="0.3"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${renderMode === "transparent" ? "active" : ""}`}
        title="Transparent (50%)"
        onClick={() => setRenderMode("transparent")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M3 5v14h18V5z"
            fill="currentColor"
            opacity="0.3"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="3 2"
          />
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
          <path
            d="M3 5v14h18V5z"
            fill="url(#grad)"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${shadowsEnabled ? "active" : ""}`}
        title={
          shadowsEnabled
            ? "Shadows on — click to disable"
            : "Shadows off — click to enable ground-plane shadows"
        }
        onClick={() => setShadowsEnabled(!shadowsEnabled)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* Object */}
          <rect
            x="6"
            y="5"
            width="8"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* Ground plane line */}
          <line
            x1="3"
            y1="18"
            x2="21"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Skewed shadow projection */}
          <path
            d="M 6 15 L 18 15 L 20 18 L 8 18 Z"
            fill="currentColor"
            opacity="0.45"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${curveResolution === "print" ? "active" : ""}`}
        title={
          curveResolution === "print"
            ? "High resolution (3D print) — click for preview"
            : "Preview resolution — click for high (3D print)"
        }
        onClick={toggleCurveResolution}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            cx="12"
            cy="12"
            r="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {curveResolution === "print" ? (
            <>
              <circle cx="12" cy="5" r="1.2" fill="currentColor" />
              <circle cx="16.95" cy="6.4" r="1.2" fill="currentColor" />
              <circle cx="19.6" cy="11" r="1.2" fill="currentColor" />
              <circle cx="18.7" cy="16.3" r="1.2" fill="currentColor" />
              <circle cx="14.7" cy="19.6" r="1.2" fill="currentColor" />
              <circle cx="9.3" cy="19.6" r="1.2" fill="currentColor" />
              <circle cx="5.3" cy="16.3" r="1.2" fill="currentColor" />
              <circle cx="4.4" cy="11" r="1.2" fill="currentColor" />
              <circle cx="7.05" cy="6.4" r="1.2" fill="currentColor" />
            </>
          ) : (
            <>
              <circle cx="12" cy="5" r="1.5" fill="currentColor" />
              <circle cx="18.7" cy="8.5" r="1.5" fill="currentColor" />
              <circle cx="18.7" cy="15.5" r="1.5" fill="currentColor" />
              <circle cx="12" cy="19" r="1.5" fill="currentColor" />
              <circle cx="5.3" cy="15.5" r="1.5" fill="currentColor" />
              <circle cx="5.3" cy="8.5" r="1.5" fill="currentColor" />
            </>
          )}
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default RenderSection;
