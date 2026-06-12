import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const MaterialSection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const setMaterialDialogTarget = useStore((s) => s.setMaterialDialogTarget);

  const selectedItem = items.find((i) => i.id === selectedId);
  const target =
    selectedItem && selectedItem.type !== "sketch" ? selectedId : "default";

  const body = (
    <button
      className="toolbar-btn"
      title={
        target === "default"
          ? "Material — edit the default material used by new objects"
          : `Material — edit the material for ${selectedItem.name}`
      }
      onClick={() => setMaterialDialogTarget(target)}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle
          stroke="#6C3FD4"
          fill="rgba(108,63,212,0.18)"
          strokeWidth="1.5"
          cx="12"
          cy="12"
          r="9"
        />
        <ellipse
          stroke="#D4A33F"
          fill="rgba(212,163,63,0.35)"
          strokeWidth="0"
          cx="9"
          cy="8.5"
          rx="3"
          ry="2"
          transform="rotate(-20 9 8.5)"
        />
        <ellipse
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1"
          cx="12"
          cy="12"
          rx="9"
          ry="3.5"
        />
        <ellipse
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="0.75"
          strokeDasharray="2 2"
          cx="12"
          cy="12"
          rx="4.5"
          ry="9"
        />
      </svg>
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Material">{body}</ToolbarSection>;
};

export default MaterialSection;
