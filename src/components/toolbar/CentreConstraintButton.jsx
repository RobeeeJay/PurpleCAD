import React from "react";
import { useStore } from "../../store";

// Toolbar entry for the sketch Centre constraint.  Its own file because
// ConstrainSection is already past the size ceiling.
export default function CentreConstraintButton() {
  const active = useStore((s) => s.activeSketchTool === "centre");
  const toggle = () => {
    const s = useStore.getState();
    if (active) {
      s.cancelCentreTool();
      return;
    }
    // One sketch mode at a time: leave any half-finished constraint pick.
    s.setSketchConstraintMode(null);
    s.setSketchConstraintFirstPoint(null);
    s.startCentreTool();
  };
  return (
    <button
      className={`toolbar-btn ${active ? "active" : ""}`}
      title="Centre — put the centre of one shape on the centre of another, with an optional X/Y offset"
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="1"
          stroke="#c4c2b8"
          strokeWidth="1.5"
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r="4.5"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          fill="none"
        />
        <line
          x1="12"
          y1="8.5"
          x2="12"
          y2="15.5"
          stroke="#D4A33F"
          strokeWidth="1.5"
        />
        <line
          x1="8.5"
          y1="12"
          x2="15.5"
          y2="12"
          stroke="#D4A33F"
          strokeWidth="1.5"
        />
      </svg>
    </button>
  );
}
