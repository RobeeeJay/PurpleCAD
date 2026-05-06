import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { performCsg } from "../../three/csgUtils.js";

const CombineSection = () => {
  const selectedIds   = useStore((s) => s.selectedIds);
  const items         = useStore((s) => s.items);
  const history       = useStore((s) => s.history);
  const addItem       = useStore((s) => s.addItem);
  const setItemsHidden = useStore((s) => s.setItemsHidden);

  // All visible non-sketch items that can participate in a boolean operation.
  const allEligible = items.filter(i => i.type !== "sketch" && i.visible !== false);

  // Items the user explicitly multi-selected (Shift+click).
  const selectedEligible = selectedIds
    .map(id => items.find(i => i.id === id))
    .filter(item => item && item.type !== "sketch");

  // Buttons are active whenever 2+ eligible items exist in the scene.
  // The operation targets the explicit selection when ≥2 are selected;
  // otherwise it targets all visible eligible items so users don't need
  // to Shift+click just to combine the only two objects in the scene.
  const canCsg = allEligible.length >= 2;

  const handleCsg = (operation) => {
    if (!canCsg) return;
    const selectedItems = selectedEligible.length >= 2 ? selectedEligible : allEligible;

    try {
      const result = performCsg(selectedItems, operation);
      if (!result) {
        // Fewer than two items produced usable geometry (e.g. all were sketches
        // or extrudes without a valid profile).  Nothing to combine.
        return;
      }

      let maxId = 0;
      history.forEach((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item.id > maxId)
          maxId = entry.instruction.item.id;
      });
      const id = maxId + 1;
      const opLabel = operation.charAt(0).toUpperCase() + operation.slice(1);

      addItem({
        id,
        name: `${opLabel} ${id}`,
        type: "csg",
        children: [],
        position:     result.position,
        scale:        { x: 1, y: 1, z: 1 },
        rotation:     { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
      });
      setItemsHidden(selectedItems.map((i) => i.id));
    } catch (err) {
      console.error("CSG operation failed:", err);
      alert("Boolean operation failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Combine">
      <button className="toolbar-btn" title="Union" disabled={!canCsg} onClick={() => handleCsg("union")}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle cx="8"  cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button className="toolbar-btn" title="Difference" disabled={!canCsg} onClick={() => handleCsg("difference")}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle cx="8"  cy="12" r="5" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button className="toolbar-btn" title="Intersection" disabled={!canCsg} onClick={() => handleCsg("intersection")}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle cx="8"  cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M 11 9 Q 13 12 11 15" fill="currentColor" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default CombineSection;
