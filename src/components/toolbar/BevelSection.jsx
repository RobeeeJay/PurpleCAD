import React from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { buildItemGeometry, buildBrushTransform } from "../../three/csgUtils.js";
import { applyBevelToSubGeometry } from "../../three/bevelUtils.js";

const BevelSection = () => {
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const items = useStore((s) => s.items);
  const modifyItem = useStore((s) => s.modifyItem);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);

  const hasSelection =
    selectedSubGeometry &&
    ((selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0);

  const apply = (segments) => {
    if (!hasSelection) return;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    try {
      const geo = buildItemGeometry(item);
      if (!geo) return;

      const result = applyBevelToSubGeometry(geo, selectedSubGeometry, 0.05, segments);
      if (!result) return;

      const posAttr = result.getAttribute("position");
      const normAttr = result.getAttribute("normal");
      const idxAttr = result.index;

      // Centre the result geometry and compute the world-space pivot.
      const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
      const localCentre = new THREE.Vector3();
      bbox.getCenter(localCentre);
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(
          i,
          posAttr.getX(i) - localCentre.x,
          posAttr.getY(i) - localCentre.y,
          posAttr.getZ(i) - localCentre.z,
        );
      }
      posAttr.needsUpdate = true;

      // Rotate the local-space offset into world space and add it to the
      // brush-transform position (which already accounts for extrude centroid).
      const brushPos = buildBrushTransform(item).position;
      const rot = item.rotation || { x: 0, y: 0, z: 0 };
      localCentre.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));

      modifyItem(item.id, {
        type: "csg",
        position: {
          x: brushPos.x + localCentre.x,
          y: brushPos.y + localCentre.y,
          z: brushPos.z + localCentre.z,
        },
        geometryData: {
          positions: Array.from(posAttr.array),
          normals: normAttr ? Array.from(normAttr.array) : null,
          indices: idxAttr ? Array.from(idxAttr.array) : null,
        },
      });
      clearSelectedSubGeometry();
    } catch (err) {
      console.error("Bevel operation failed:", err);
      alert("Bevel operation failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Modify">
      <button
        className="toolbar-btn"
        title="Chamfer"
        disabled={!hasSelection}
        onClick={() => apply(1)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 4 L14 4 L20 10 L20 20 L4 20 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line x1="14" y1="4" x2="20" y2="10" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Bevel"
        disabled={!hasSelection}
        onClick={() => apply(3)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M4 4 L13 4 Q20 4 20 11 L20 20 L4 20 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default BevelSection;
