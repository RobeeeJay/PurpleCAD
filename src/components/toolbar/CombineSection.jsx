import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { performCsg } from "../../three/occClient.js";
import { activePrecision } from "../../three/resolution.js";

const CombineSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const addItem = useStore((s) => s.addItem);
  const consumeItems = useStore((s) => s.consumeItems);
  const printPrecision = useStore(activePrecision);

  // Non-sketch items from the current selection.
  const selectedEligible = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((item) => item && item.type !== "sketch");

  // Require 2+ selected non-sketch items.
  const canCsg = selectedEligible.length >= 2;

  // An imported solid is a csg item carrying only a mesh (no recipe).  OCC can't
  // boolean a dense one without freezing, so those go through a mesh boolean.
  const isImportedMesh = (item) =>
    item.type === "csg" && !item.regenerator && item.geometryData;

  const handleCsg = async (operation) => {
    if (!canCsg) return;
    const selectedItems = selectedEligible;
    // The result inherits the primary (first-selected) object's material — for a
    // difference that's the object being cut from; for union/intersection it's
    // the first picked.  Omitted when the primary uses the default material.
    const primaryMaterial = selectedItems[0]?.material;

    try {
      if (selectedItems.some(isImportedMesh)) {
        const cc = useStore.getState()._cameraControls;
        const result = cc?.meshBoolean?.(
          selectedItems.map((i) => i.id),
          operation,
        );
        if (!result) {
          alert("Couldn't combine the selected meshes.");
          return;
        }
        let maxMeshId = 0;
        history.forEach((entry) => {
          if (
            entry.instruction?.type === "create" &&
            entry.instruction.item.id > maxMeshId
          )
            maxMeshId = entry.instruction.item.id;
        });
        const meshId = maxMeshId + 1;
        const meshLabel =
          operation.charAt(0).toUpperCase() + operation.slice(1);
        // A baked mesh result — no OCC recipe to re-run, so no regenerator.
        addItem({
          id: meshId,
          name: `${meshLabel} ${meshId}`,
          type: "csg",
          children: [],
          position: result.position,
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
          geometryData: result.geometryData,
          ...(primaryMaterial && { material: primaryMaterial }),
        });
        consumeItems(selectedItems.map((i) => i.id));
        return;
      }

      // Tessellate primitives at the resolution the user selected so the CSG
      // result inherits that chord-deviation precision.
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
        ...(primaryMaterial && { material: primaryMaterial }),
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
