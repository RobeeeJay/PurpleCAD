import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const OptionsSection = () => {
  const axisVisible = useStore((s) => s.axisVisible);
  const toggleAxisVisibility = useStore((s) => s.toggleAxisVisibility);
  const constraintsVisible = useStore((s) => s.constraintsVisible);
  const toggleConstraintsVisible = useStore((s) => s.toggleConstraintsVisible);
  const dimensionsVisible = useStore((s) => s.dimensionsVisible);
  const toggleDimensionsVisible = useStore((s) => s.toggleDimensionsVisible);
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);

  return (
    <ToolbarSection label="Misc">
      <button
        className="toolbar-btn"
        title="Settings — field of view and snap"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            strokeLinecap="square"
            d="M 12.0,4.5 L 14.334,2.276 L 17.225,3.474 L 17.303,6.697
       L 20.526,6.775 L 21.724,9.666 L 19.5,12.0
       L 21.724,14.334 L 20.526,17.225 L 17.303,17.303
       L 17.225,20.526 L 14.334,21.724 L 12.0,19.5
       L 9.666,21.724 L 6.775,20.526 L 6.697,17.303
       L 3.474,17.225 L 2.276,14.334 L 4.5,12.0
       L 2.276,9.666 L 3.474,6.775 L 6.697,6.697
       L 6.775,3.474 L 9.666,2.276 Z"
          />
          <circle
            cx="12"
            cy="12"
            r="5.5"
            stroke="#D4A33F"
            fill="none"
            strokeWidth="0.75"
            strokeDasharray="2 1.5"
            opacity="0.7"
          />
          <circle
            cx="12"
            cy="12"
            r="3.5"
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="1.2" fill="#D4A33F" />
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
