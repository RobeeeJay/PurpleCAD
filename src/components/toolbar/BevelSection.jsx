import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import {
  beginChamferRetarget,
  findChamferEntryId,
} from "../../three/cameraControls/chamferCommit.js";

const BevelSection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);

  const canRetarget =
    items.find((i) => i.id === selectedId)?.regenerator?.kind === "chamfer";

  const toggleMode = (mode) => {
    if (chamferSelectMode === mode) {
      setChamferSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setChamferSelectMode(mode);
    }
  };

  // Pre-select the faces/edges the existing chamfer/fillet on the selected
  // item used, and open the confirmation overlay in the matching mode —
  // same flow as the Timeline's per-step Retarget button.
  const retarget = () => {
    if (!canRetarget) return;
    const entryId = findChamferEntryId(history, selectedId);
    if (entryId) beginChamferRetarget(selectedId, entryId);
  };

  const body = (
    <>
      <button
        className={`toolbar-btn ${chamferSelectMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — select faces/edges, then confirm a distance"
        onClick={() => toggleMode("chamfer")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 4 L14 4 L20 10 L20 20 L4 20 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line
            x1="14"
            y1="4"
            x2="20"
            y2="10"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${chamferSelectMode === "fillet" ? "active" : ""}`}
        title="Bevel — select faces/edges, then confirm a radius"
        onClick={() => toggleMode("fillet")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 4 L13 4 Q20 4 20 11 L20 20 L4 20 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Retarget — adjust the selected chamfer/fillet's face(s)/edge(s) and confirm"
        disabled={!canRetarget}
        onClick={retarget}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            x="3"
            y="14"
            width="12"
            height="7"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polygon
            points="3,14 6,9 18,9 18,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.6"
          />
          <circle
            cx="19"
            cy="5"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="19" cy="5" r="1" fill="currentColor" />
        </svg>
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default BevelSection;
