import React, { useMemo } from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { countGeometryComponents } from "../../three/geometryComponents.js";

const ModifySection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const splitObject = useStore((s) => s.splitObject);

  const eligible = (selectedIds.length > 0 ? selectedIds : [selectedId])
    .map((id) => items.find((i) => i.id === id))
    .filter((it) => it && it.type !== "sketch");
  const canDrop = eligible.length > 0;

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

  const handleDrop = () => {
    if (!canDrop) return;
    const ctrl = useStore.getState()._cameraControls;
    ctrl?.dropSelectedToGround?.();
  };

  const handleSplit = () => {
    if (!canSplit) return;
    splitObject(selectedId);
  };

  const body = (
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
  );

  const splitButton = (
    <button
      className="toolbar-btn"
      title="Split — separate a union back into its original objects"
      disabled={!canSplit}
      onClick={handleSplit}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        {/* Two separate objects, pulled apart */}
        <rect
          x="2"
          y="9"
          width="7"
          height="7"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="18.5"
          cy="12.5"
          r="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Arrows showing the separation */}
        <path
          d="M10 8 L13 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M11.5 6.5 L13 8 L11.5 9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 17 L11 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M12.5 15.5 L11 17 L12.5 18.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  return bare ? (
    <>
      {body}
      {splitButton}
    </>
  ) : (
    <ToolbarSection label="Modify">
      {body}
      {splitButton}
    </ToolbarSection>
  );
};

export default ModifySection;
