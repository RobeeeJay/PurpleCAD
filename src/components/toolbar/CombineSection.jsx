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
      // Bake the consumed flag into each input's CREATE history entry so
      // the boolean's inputs stay hidden across a timeline replay (a
      // plain `setItemsHidden` mutates state.items but doesn't touch
      // history, so a replay would resurrect both the inputs and the
      // result, leaving overlapping geometry).
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
          <circle
            cx="8"
            cy="12"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="12"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
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
          <circle
            cx="8"
            cy="12"
            r="5"
            fill="currentColor"
            opacity="0.3"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="12"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
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
          <circle
            cx="8"
            cy="12"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="12"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M 11 9 Q 13 12 11 15" fill="currentColor" />
        </svg>
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Boolean">{body}</ToolbarSection>;
};

export default CombineSection;
