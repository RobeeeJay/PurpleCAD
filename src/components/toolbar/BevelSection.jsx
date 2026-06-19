import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const BevelSection = ({ bare = false }) => {
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);
  const pushPullSelectMode = useStore((s) => s.pushPullSelectMode);
  const setPushPullSelectMode = useStore((s) => s.setPushPullSelectMode);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const setShellTarget = useStore((s) => s.setShellTarget);

  // Shell hollows the whole selected body, so it only needs a solid selected
  // (no face/edge pick).  Sketches and the empty selection are ineligible.
  const selectedBody = items.find((i) => i.id === selectedId);
  const canShell = !!selectedBody && selectedBody.type !== "sketch";
  const openShell = () => {
    if (canShell) setShellTarget({ itemId: selectedId });
  };

  const toggleMode = (mode) => {
    if (chamferSelectMode === mode) {
      setChamferSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setChamferSelectMode(mode);
    }
  };

  // Push/Pull shares the face-selection UX with chamfer/fillet; its store
  // setter clears chamferSelectMode so only one pick/confirm overlay is live.
  const togglePushPull = () => {
    if (pushPullSelectMode) {
      setPushPullSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setPushPullSelectMode("pushpull");
    }
  };

  const body = (
    <>
      <button
        className={`toolbar-btn ${chamferSelectMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — select faces/edges, then confirm a distance"
        onClick={() => toggleMode("chamfer")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="4,20 4,13 9,8 16,8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="13" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="9" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="9"
            y2="8"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${chamferSelectMode === "fillet" ? "active" : ""}`}
        title="Bevel — select faces/edges, then confirm a radius"
        onClick={() => toggleMode("fillet")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            d="M4 20 L4 14 Q4 8 10 8 L16 8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="14" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="10" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="14"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="10"
            y2="8"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${pushPullSelectMode ? "active" : ""}`}
        title="Push/Pull — select faces, then confirm a distance to move them along their normal"
        onClick={togglePushPull}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.25)"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="4,9 10,6 16,9 10,12"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="4"
            y1="9"
            x2="4"
            y2="16"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="10"
            y1="12"
            x2="10"
            y2="19"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="16"
            y1="9"
            x2="16"
            y2="16"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="20"
            y1="13"
            x2="20"
            y2="3"
          />
          <polyline
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="17.5,5.5 20,3 22.5,5.5"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Shell — hollow the selected body to a wall thickness"
        disabled={!canShell}
        onClick={openShell}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* Outer open box */}
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="4,8 12,4 20,8 12,12"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="4"
            y1="8"
            x2="4"
            y2="16"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="20"
            y1="8"
            x2="20"
            y2="16"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            x1="12"
            y1="12"
            x2="12"
            y2="20"
          />
          <polyline
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="4,16 12,20 20,16"
          />
          {/* Inner wall, showing the hollow */}
          <polygon
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.25)"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="7,8.5 12,6 17,8.5 12,11"
          />
        </svg>
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default BevelSection;
