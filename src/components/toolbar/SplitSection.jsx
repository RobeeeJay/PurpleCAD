import React from "react";
import { useStore } from "../../store";
import { splitItem } from "../../three/occClient.js";
import { activePrecision } from "../../three/resolution.js";
import { maxItemId } from "../../store/internals.js";
import ToolbarSection from "./ToolbarSection";

const SOLID_TYPES = ["cube", "sphere", "cylinder", "torus", "extrude", "csg"];
const PLANE_TYPES = ["plane", "sketch"];

// Split object: slice the selected solid along a selected plane / sketch plane
// into two separate objects.  Select one solid + one plane (or sketch), then
// click — the original is hidden and replaced by the two halves.
const SplitSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const addItem = useStore((s) => s.addItem);
  const consumeItems = useStore((s) => s.consumeItems);
  const printPrecision = useStore(activePrecision);

  const sel = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean);
  const solid = sel.find((i) => SOLID_TYPES.includes(i.type));
  const planeItem = sel.find((i) => PLANE_TYPES.includes(i.type));
  const canSplit = !!solid && !!planeItem && solid.id !== planeItem.id;

  const handleSplit = async () => {
    if (!canSplit) {
      alert("Select one object and one plane (or sketch) to split it.");
      return;
    }
    try {
      const result = await splitItem({
        target: solid,
        plane: { position: planeItem.position, rotation: planeItem.rotation },
        allItems: items,
        printPrecision,
      });
      if (!result || (!result.partA && !result.partB)) {
        alert("Split produced nothing — does the plane cross the object?");
        return;
      }
      const add = (part, suffix) => {
        if (!part) return;
        const id = maxItemId(useStore.getState().history) + 1;
        addItem({
          id,
          name: `${solid.name} ${suffix}`,
          type: "csg",
          children: [],
          position: part.position,
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          geometryData: part.geometryData,
        });
      };
      add(result.partA, "(1)");
      add(result.partB, "(2)");
      consumeItems([solid.id]);
    } catch (err) {
      console.error("Split failed:", err);
      alert("Split failed: " + err.message);
    }
  };

  const body = (
    <button
      className={`toolbar-btn ${canSplit ? "" : ""}`}
      title="Split object — slice the selected object along a selected plane/sketch into two"
      onClick={handleSplit}
      style={canSplit ? undefined : { opacity: 0.45 }}
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
