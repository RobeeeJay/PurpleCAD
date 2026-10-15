import { useMemo } from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { countGeometryComponents } from "../../three/geometryComponents.js";

const ModifySection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const splitObject = useStore((s) => s.splitObject);

  const selectedItem = items.find((i) => i.id === selectedId);
  // Splittable when the single selected solid is geometrically more than one
  // disconnected lump — covers unions of non-touching parts, a difference
  // that severed a body, an imported multi-solid, etc.  A welded single body
  // (or a lone primitive) is one component and stays disabled.
  const componentCount = useMemo(
    () => countGeometryComponents(selectedItem?.geometryData),
    [selectedItem?.geometryData],
  );
  const canSplit = selectedIds.length <= 1 && componentCount >= 2;

  const handleSplit = () => {
    if (!canSplit) return;
    splitObject(selectedId);
  };

  const splitButton = (
    <button
      className="toolbar-btn"
      title="Split — separate a union back into its original objects"
      disabled={!canSplit}
      onClick={handleSplit}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle
          stroke="#6C3FD4"
          fill="rgba(108,63,212,0.35)"
          strokeWidth="1.5"
          cx="6"
          cy="12"
          r="4.5"
        />
        <ellipse
          stroke="#D4A33F"
          fill="none"
          strokeWidth="0.75"
          cx="6"
          cy="12"
          rx="4.5"
          ry="1.6"
        />
        <rect
          stroke="#6C3FD4"
          fill="rgba(108,63,212,0.2)"
          strokeWidth="1.5"
          strokeLinejoin="miter"
          x="14"
          y="9"
          width="7"
          height="7"
        />
        <polyline
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          strokeLinejoin="miter"
          points="14,9 16,7 21,7"
        />
        <line
          stroke="#6C3FD4"
          fill="none"
          strokeWidth="1.5"
          x1="21"
          y1="7"
          x2="21"
          y2="16"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
          x1="16"
          y1="7"
          x2="16"
          y2="14"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
          x1="21"
          y1="7"
          x2="16"
          y2="7"
        />
        <line
          stroke="#D4A33F"
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="2 2"
          strokeLinecap="square"
          x1="12"
          y1="4"
          x2="12"
          y2="20"
        />
      </svg>
    </button>
  );

  return bare ? (
    <>{splitButton}</>
  ) : (
    <ToolbarSection label="Modify">{splitButton}</ToolbarSection>
  );
};

export default ModifySection;
