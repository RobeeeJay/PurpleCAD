import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const ModifySection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);

  const eligible = (selectedIds.length > 0 ? selectedIds : [selectedId])
    .map((id) => items.find((i) => i.id === id))
    .filter((it) => it && it.type !== "sketch");
  const canDrop = eligible.length > 0;

  const handleDrop = () => {
    if (!canDrop) return;
    const ctrl = useStore.getState()._cameraControls;
    ctrl?.dropSelectedToGround?.();
  };

  return (
    <ToolbarSection label="Modify">
      <button
        className="toolbar-btn"
        title="Drop to ground — moves the selection so its lowest point sits on Y=0"
        disabled={!canDrop}
        onClick={handleDrop}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* The object */}
          <rect
            x="7"
            y="4"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            rx="1"
          />
          {/* Downward arrow showing the drop */}
          <line
            x1="12"
            y1="14"
            x2="12"
            y2="19"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polyline
            points="9,16 12,19 15,16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Ground plane */}
          <line
            x1="3"
            y1="21"
            x2="21"
            y2="21"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default ModifySection;
