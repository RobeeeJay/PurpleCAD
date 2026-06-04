import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const OptionsSection = () => {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const projectionMode = useStore((s) => s.projectionMode);
  const toggleProjectionMode = useStore((s) => s.toggleProjectionMode);
  const widgetVisible = useStore((s) => s.widgetVisible);
  const toggleWidgetVisibility = useStore((s) => s.toggleWidgetVisibility);
  const axisVisible = useStore((s) => s.axisVisible);
  const toggleAxisVisibility = useStore((s) => s.toggleAxisVisibility);
  const constraintsVisible = useStore((s) => s.constraintsVisible);
  const toggleConstraintsVisible = useStore((s) => s.toggleConstraintsVisible);
  const dimensionsVisible = useStore((s) => s.dimensionsVisible);
  const toggleDimensionsVisible = useStore((s) => s.toggleDimensionsVisible);
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);

  return (
    <ToolbarSection label="Options">
      <button
        className="toolbar-btn"
        title="Settings — field of view and snap"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        onClick={toggleTheme}
      >
        {theme === "light" ? (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <circle cx="12" cy="12" r="5" fill="currentColor" />
            <line
              x1="12"
              y1="1"
              x2="12"
              y2="3"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="12"
              y1="21"
              x2="12"
              y2="23"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="4.22"
              y1="4.22"
              x2="5.64"
              y2="5.64"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="18.36"
              y1="18.36"
              x2="19.78"
              y2="19.78"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="1"
              y1="12"
              x2="3"
              y2="12"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="21"
              y1="12"
              x2="23"
              y2="12"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="4.22"
              y1="19.78"
              x2="5.64"
              y2="18.36"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="18.36"
              y1="5.64"
              x2="19.78"
              y2="4.22"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0"
            />
          </svg>
        )}
      </button>
      <button
        className={`toolbar-btn ${projectionMode === "isometric" ? "active" : ""}`}
        title={`Switch to ${projectionMode === "perspective" ? "isometric" : "perspective"} projection`}
        onClick={toggleProjectionMode}
      >
        {projectionMode === "perspective" ? (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              d="M3 7l9-4 9 4v10l-9 4-9-4V7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M12 3v18"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
            <path
              d="M7 8l10 4.5M7 12l10-1"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
          </svg>
        )}
      </button>
      <button
        className={`toolbar-btn ${widgetVisible ? "active" : ""}`}
        title={`${widgetVisible ? "Hide" : "Show"} orientation widget`}
        onClick={toggleWidgetVisibility}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            fill={widgetVisible ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${constraintsVisible ? "active" : ""}`}
        title={`${constraintsVisible ? "Hide" : "Show"} constraint icons`}
        onClick={toggleConstraintsVisible}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 3L21 12L12 21L3 12Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {!constraintsVisible && (
            <line
              x1="4"
              y1="20"
              x2="20"
              y2="4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <button
        className={`toolbar-btn ${dimensionsVisible ? "active" : ""}`}
        title={`${dimensionsVisible ? "Hide" : "Show"} dimensions`}
        onClick={toggleDimensionsVisible}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="3"
            y1="9"
            x2="3"
            y2="15"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="21"
            y1="9"
            x2="21"
            y2="15"
            stroke="currentColor"
            strokeWidth="2"
          />
          <text
            x="12"
            y="8"
            textAnchor="middle"
            fontSize="6"
            fill="currentColor"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            mm
          </text>
          {!dimensionsVisible && (
            <line
              x1="4"
              y1="20"
              x2="20"
              y2="4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <button
        className={`toolbar-btn ${axisVisible ? "active" : ""}`}
        title={`${axisVisible ? "Hide" : "Show"} axis`}
        onClick={toggleAxisVisibility}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            x1="12"
            y1="12"
            x2="21"
            y2="12"
            stroke="#ff4444"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <polygon points="23,12 20,10.5 20,13.5" fill="#ff4444" />
          <line
            x1="12"
            y1="12"
            x2="12"
            y2="3"
            stroke="#4488ff"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <polygon points="12,1 10.5,4 13.5,4" fill="#4488ff" />
          <line
            x1="12"
            y1="12"
            x2="5"
            y2="18"
            stroke="#44ff44"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <polygon points="3.5,19.5 6.5,19 5,16.5" fill="#44ff44" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default OptionsSection;
