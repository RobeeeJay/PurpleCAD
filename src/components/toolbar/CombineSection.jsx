import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { performCsg } from "../../three/occClient.js";

const CombineSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const addItem = useStore((s) => s.addItem);
  const consumeItems = useStore((s) => s.consumeItems);
  const curveResolution = useStore((s) => s.curveResolution);

  // Non-sketch items from the current selection.
  const selectedEligible = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((item) => item && item.type !== "sketch");

  // Require 2+ selected non-sketch items.
  const canCsg = selectedEligible.length >= 2;

  const handleCsg = async (operation) => {
    if (!canCsg) return;
    const selectedItems = selectedEligible;

    try {
      // Tessellate primitives at the high-resolution setting so the CSG
      // result inherits the chord-deviation precision the user selected.
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const result = await performCsg({
        selectedItems,
        operation,
        printPrecision,
        allItems: items,
      });
      if (!result) {
        // Fewer than two items produced usable geometry (e.g. all were sketches
        // or extrudes without a valid profile).  Nothing to combine.
        return;
      }

      let maxId = 0;
      history.forEach((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item.id > maxId
        )
          maxId = entry.instruction.item.id;
      });
      const id = maxId + 1;
      const opLabel = operation.charAt(0).toUpperCase() + operation.slice(1);

      addItem({
        id,
        name: `${opLabel} ${id}`,
        type: "csg",
        children: [],
        position: result.position,
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
        // Recipe for re-running this boolean at a different resolution so
        // toggling the preview/print setting updates the result.  Records
        // input item ids + the operation; the regenerate pass looks them
        // up in the current items state.
        regenerator: {
          kind: "boolean",
          op: operation,
          inputIds: selectedItems.map((i) => i.id),
          originalCenter: result.position,
          regeneratedAt: printPrecision,
        },
      });
      // Hide the boolean's inputs from this step onward so a timeline
      // replay doesn't resurrect both the inputs and the result, leaving
      // overlapping geometry.
      consumeItems(selectedItems.map((i) => i.id));
    } catch (err) {
      console.error("CSG operation failed:", err);
      alert("Boolean operation failed: " + err.message);
    }
  };

  const body = (
    <>
      <button
        className="toolbar-btn"
        title="Union"
        disabled={!canCsg}
        onClick={() => handleCsg("union")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x="3"
            y="3"
            width="12"
            height="12"
          />
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x="9"
            y="9"
            width="12"
            height="12"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M3 9 L9 9 L9 3 L15 3 L15 9 L21 9 L21 21 L9 21 L9 15 L3 15 Z"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Difference"
        disabled={!canCsg}
        onClick={() => handleCsg("difference")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            x="3"
            y="3"
            width="12"
            height="12"
          />
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x="9"
            y="9"
            width="12"
            height="12"
          />
          <rect
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.15)"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="3"
            y="3"
            width="6"
            height="6"
          />
          <rect
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.15)"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="9"
            y="3"
            width="6"
            height="6"
          />
          <rect
            stroke="#6C3FD4"
            fill="rgba(108,63,212,0.15)"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="3"
            y="9"
            width="6"
            height="6"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Intersection"
        disabled={!canCsg}
        onClick={() => handleCsg("intersection")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x="3"
            y="3"
            width="12"
            height="12"
          />
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x="9"
            y="9"
            width="12"
            height="12"
          />
          <rect
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="9"
            y="9"
            width="6"
            height="6"
          />
        </svg>
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Boolean">{body}</ToolbarSection>;
};

export default CombineSection;
