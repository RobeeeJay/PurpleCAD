import React, { useMemo } from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { countGeometryComponents } from "../../three/geometryComponents.js";

const ModifySection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const splitObject = useStore((s) => s.splitObject);
  const originToolActive = useStore((s) => s.originToolActive);
  const setOriginToolActive = useStore((s) => s.setOriginToolActive);

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

  // Change-origin: arm the tool, then click an object to pick its rotation/scale
  // pivot (centre of mass / centre of object / a vertex).
  const handleOrigin = () => setOriginToolActive(!originToolActive);

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

  const originButton = (
    <button
      className={`toolbar-btn ${originToolActive ? "active" : ""}`}
      title="Change origin — click an object, then pick its rotation/scale pivot (centre of mass, centre of object, or a vertex)"
      onClick={handleOrigin}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        {/* crosshair pivot over a small cube */}
        <polygon
          stroke="#c4c2b8"
          fill="none"
          strokeWidth="1.3"
          strokeLinejoin="miter"
          points="13,9 18,11 18,17 13,19 8,17 8,11"
        />
        <line
          stroke="#c4c2b8"
          fill="none"
          strokeWidth="1.3"
          x1="8"
          y1="11"
          x2="13"
          y2="13"
        />
        <line
          stroke="#c4c2b8"
          fill="none"
          strokeWidth="1.3"
          x1="18"
          y1="11"
          x2="13"
          y2="13"
        />
        <line
          stroke="#c4c2b8"
          fill="none"
          strokeWidth="1.3"
          x1="13"
          y1="13"
          x2="13"
          y2="19"
        />
        <circle fill="#6C3FD4" stroke="#6C3FD4" r="2" cx="8" cy="8" />
        <line stroke="#D4A33F" strokeWidth="1.3" x1="2" y1="8" x2="14" y2="8" />
        <line stroke="#D4A33F" strokeWidth="1.3" x1="8" y1="2" x2="8" y2="14" />
      </svg>
    </button>
  );

  return bare ? (
    <>
      {splitButton}
      {originButton}
    </>
  ) : (
    <ToolbarSection label="Modify">
      {splitButton}
      {originButton}
    </ToolbarSection>
  );
};

export default ModifySection;
