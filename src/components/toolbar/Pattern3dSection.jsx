import React from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import { pattern3dItem } from "../../three/occClient.js";
import { maxItemId } from "../../store/internals.js";
import ToolbarSection from "./ToolbarSection";

const SOLID_TYPES = ["cube", "sphere", "cylinder", "torus", "extrude", "csg"];
const PLANE_TYPES = ["plane", "sketch"];

// 3D Mirror: clone the selected object across the selected plane.  The clone is
// a regenerator item that rebuilds from the live source, so it tracks changes to
// the original and can't be edited on its own.
const Pattern3dSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const addItem = useStore((s) => s.addItem);
  const curveResolution = useStore((s) => s.curveResolution);

  const sel = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean);
  const source = sel.find((i) => SOLID_TYPES.includes(i.type));
  const plane = sel.find((i) => PLANE_TYPES.includes(i.type));
  const ready = !!source && !!plane;

  const handleMirror = async () => {
    if (!ready) {
      alert("Select an object and a mirror plane (a Plane or a sketch).");
      return;
    }
    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const rot = plane.rotation || { x: 0, y: 0, z: 0 };
      const nv = new THREE.Vector3(0, 0, 1).applyEuler(
        new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
      );
      const result = await pattern3dItem({
        patternType: "mirror",
        sourceId: source.id,
        params: {
          origin: plane.position,
          normal: { x: nv.x, y: nv.y, z: nv.z },
        },
        allItems: items,
        printPrecision,
      });
      if (!result) {
        alert("Mirror produced nothing.");
        return;
      }
      const id = maxItemId(useStore.getState().history) + 1;
      addItem({
        id,
        name: `Mirror of ${source.name}`,
        type: "csg",
        children: [],
        position: result.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: result.geometryData,
        regenerator: {
          kind: "pattern3d",
          patternType: "mirror",
          sourceId: source.id,
          planeId: plane.id,
          centerOffset: result.centerOffset,
          regeneratedAt: printPrecision,
        },
      });
      useStore.getState().selectItem?.(id);
    } catch (err) {
      console.error("Mirror failed:", err);
      alert("Mirror failed: " + err.message);
    }
  };

  const body = (
    <button
      className="toolbar-btn"
      title="Mirror (3D) — clone the selected object across the selected plane; the clone tracks the original"
      onClick={handleMirror}
      style={ready ? undefined : { opacity: 0.45 }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          x1="12"
          y1="2"
          x2="12"
          y2="22"
          stroke="#D4A33F"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
        <polygon
          points="4,7 10,5 10,17 4,19"
          fill="rgba(108,63,212,0.3)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <polygon
          points="20,7 14,5 14,17 20,19"
          fill="rgba(108,63,212,0.12)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default Pattern3dSection;
