import React from "react";
import { useStore } from "../../store";
import { CentreArt } from "../icons/constraintIconArt.jsx";

// Toolbar entry for the sketch Centre constraint: a pick tool with its own
// store wiring, unlike the one-shot constraint buttons beside it.
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
      <CentreArt />
    </button>
  );
}
