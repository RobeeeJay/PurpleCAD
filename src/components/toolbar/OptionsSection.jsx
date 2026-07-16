import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const OptionsSection = () => {
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
    </ToolbarSection>
  );
};

export default OptionsSection;
