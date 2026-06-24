import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const SOLID_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "cone",
  "extrude",
  "csg",
];

// Split object: opens a guided dialog (no pre-selection needed) that prompts you
// to pick an object, then a face or plane to slice it along into two objects.
const SplitSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const startSplit3d = useStore((s) => s.startSplit3d);

  const handleSplit = () => {
    // Seed the object slot from a selected solid, if any (a convenience — the
    // dialog still lets you pick it in the view).
    const sel = selectedIds.find((id) => {
      const it = items.find((i) => i.id === id);
      return it && SOLID_TYPES.includes(it.type);
    });
    const item = sel != null ? items.find((i) => i.id === sel) : null;
    startSplit3d(
      item ? { objectId: item.id, objectName: item.name } : undefined,
    );
    // If we seeded an object, jump straight to picking the cut.
    if (item) useStore.getState().setSplitPick("cut");
  };

  const body = (
    <button
      className="toolbar-btn"
      title="Split object — pick an object, then a face or plane to slice it into two"
      onClick={handleSplit}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <polygon
          points="5,8 11,5 11,19 5,16"
          fill="rgba(108,63,212,0.3)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <polygon
          points="13,5 19,8 19,16 13,19"
          fill="rgba(108,63,212,0.18)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <line
          x1="12"
          y1="2"
          x2="12"
          y2="22"
          stroke="#D4A33F"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
      </svg>
    </button>
  );

  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default SplitSection;
