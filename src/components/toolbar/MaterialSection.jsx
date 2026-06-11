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
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
      </svg>
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Material">{body}</ToolbarSection>;
};

export default MaterialSection;
