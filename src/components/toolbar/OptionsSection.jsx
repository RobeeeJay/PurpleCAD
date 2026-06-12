import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const OptionsSection = () => {
  const projectionMode = useStore((s) => s.projectionMode);
  const toggleProjectionMode = useStore((s) => s.toggleProjectionMode);
  const axisVisible = useStore((s) => s.axisVisible);
  const toggleAxisVisibility = useStore((s) => s.toggleAxisVisibility);
  const constraintsVisible = useStore((s) => s.constraintsVisible);
  const toggleConstraintsVisible = useStore((s) => s.toggleConstraintsVisible);
  const dimensionsVisible = useStore((s) => s.dimensionsVisible);
  const toggleDimensionsVisible = useStore((s) => s.toggleDimensionsVisible);
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);
  const setAboutDialogOpen = useStore((s) => s.setAboutDialogOpen);

  return (
    <ToolbarSection label="Options">
      <button
        className="toolbar-btn"
        title="Settings — field of view and snap"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2.5"
            cx="12"
            cy="12"
            r="3"
          />
          <path
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            d="M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12 M4.93 4.93 L7.05 7.05 M16.95 16.95 L19.07 19.07 M19.07 4.93 L16.95 7.05 M7.05 16.95 L4.93 19.07"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="About PurpleCAD"
        onClick={() => setAboutDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2.5"
            cx="12"
            cy="12"
            r="9"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.4" cx="12" cy="7.5" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            x1="12"
            y1="11"
            x2="12"
            y2="17"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${projectionMode === "isometric" ? "active" : ""}`}
        title={`Switch to ${projectionMode === "perspective" ? "isometric" : "perspective"} projection`}
        onClick={toggleProjectionMode}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="12"
            x2="12"
            y2="3"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="12"
            x2="4"
            y2="17"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="12"
            x2="20"
            y2="17"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="12,3 10.5,6 13.5,6"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="4,17 7,16.5 5.5,19"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="20,17 18.5,19 21,16.5"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="2" cx="12" cy="12" />
          <text
            x="11"
            y="22"
            fontSize="6"
            fontFamily="monospace"
            fill="#D4A33F"
            fontWeight="600"
          >
            ISO
          </text>
        </svg>
      </button>
      <button
        className={`toolbar-btn ${constraintsVisible ? "active" : ""}`}
        title={`${constraintsVisible ? "Hide" : "Show"} constraint icons`}
        onClick={toggleConstraintsVisible}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            d="M2 12 C5 7, 10 5, 12 5 C14 5, 19 7, 22 12 C19 17, 14 19, 12 19 C10 19, 5 17, 2 12"
          />
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="12"
            r="3"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="9"
            x2="12"
            y2="5"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="9"
            y1="12"
            x2="3"
            y2="12"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="15"
            y1="12"
            x2="21"
            y2="12"
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
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            d="M2 10 C5 5, 10 3, 12 3 C14 3, 19 5, 22 10 C19 15, 14 17, 12 17 C10 17, 5 15, 2 10"
          />
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="10"
            r="2.5"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="5"
            y1="21"
            x2="19"
            y2="21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeLinecap="square"
            x1="5"
            y1="19"
            x2="5"
            y2="23"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeLinecap="square"
            x1="19"
            y1="19"
            x2="19"
            y2="23"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="5,21 8,19.5 8,22.5"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="19,21 16,19.5 16,22.5"
          />
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
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="19"
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
            x2="21"
            y2="22"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="19"
            x2="3"
            y2="22"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="12,5 10.5,8 13.5,8"
          />
          <polygon
            fill="#D4A33F"
            stroke="#D4A33F"
            strokeWidth="0.5"
            points="21,22 18.5,20 20,23"
          />
          <polygon
            fill="#c4c2b8"
            stroke="#c4c2b8"
            strokeWidth="0.5"
            points="3,22 4,19.5 5.5,22.5"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="19" />
          <text
            x="13"
            y="8"
            fontSize="5.5"
            fontFamily="monospace"
            fill="#6C3FD4"
            fontWeight="700"
          >
            Y
          </text>
          <text
            x="20"
            y="21"
            fontSize="5.5"
            fontFamily="monospace"
            fill="#D4A33F"
            fontWeight="700"
          >
            X
          </text>
          <text
            x="2"
            y="21"
            fontSize="5.5"
            fontFamily="monospace"
            fill="#c4c2b8"
            fontWeight="700"
          >
            Z
          </text>
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default OptionsSection;
