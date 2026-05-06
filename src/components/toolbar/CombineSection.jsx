import React from "react";
import * as THREE from "three";
import {
  Evaluator,
  Brush,
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
} from "three-bvh-csg";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const buildItemGeometry = (item) => {
  switch (item.type) {
    case "cube":
      return new THREE.BoxGeometry(2, 2, 2);
    case "sphere":
      return new THREE.SphereGeometry(1.5, 32, 32);
    case "cylinder":
      return new THREE.CylinderGeometry(1, 1, 2, 32);
    case "torus":
      return new THREE.TorusGeometry(1.0, 0.4, 16, 32);
    case "csg": {
      if (!item.geometryData) return null;
      const { positions, normals, indices } = item.geometryData;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(positions), 3),
      );
      if (normals)
        geo.setAttribute(
          "normal",
          new THREE.BufferAttribute(new Float32Array(normals), 3),
        );
      if (indices)
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      if (!normals) geo.computeVertexNormals();
      return geo;
    }
    default:
      return null;
  }
};

const CombineSection = () => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const addItem = useStore((s) => s.addItem);
  const setItemsHidden = useStore((s) => s.setItemsHidden);

  const csgEligible = selectedIds.filter((id) => {
    const item = items.find((i) => i.id === id);
    return item && item.type !== "sketch";
  });
  const canCsg = csgEligible.length >= 2;

  const handleCsg = (operation) => {
    if (!canCsg) return;
    const selectedItems = csgEligible.map((id) =>
      items.find((i) => i.id === id),
    );

    try {
      const evaluator = new Evaluator();
      const sharedMat = new THREE.MeshStandardMaterial();
      let result = null;

      for (const item of selectedItems) {
        const geo = buildItemGeometry(item);
        if (!geo) continue;
        if (!geo.getAttribute("uv")) {
          const count = geo.getAttribute("position").count;
          geo.setAttribute(
            "uv",
            new THREE.BufferAttribute(new Float32Array(count * 2), 2),
          );
        }
        const brush = new Brush(geo, sharedMat);
        const p = item.position || { x: 0, y: 2, z: 0 };
        const s = item.scale ? item.scale.x : 1;
        const r = item.rotation || { x: 0, y: 0, z: 0 };
        brush.position.set(p.x, p.y, p.z);
        brush.scale.setScalar(s);
        brush.rotation.set(r.x || 0, r.y || 0, r.z || 0);
        brush.updateMatrixWorld();
        const op =
          operation === "union"
            ? ADDITION
            : operation === "difference"
              ? SUBTRACTION
              : INTERSECTION;
        result =
          result === null ? brush : evaluator.evaluate(result, brush, op);
      }

      if (!result) return;

      const posAttr = result.geometry.getAttribute("position");
      const normAttr = result.geometry.getAttribute("normal");
      const idxAttr = result.geometry.index;

      const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
      const centre = new THREE.Vector3();
      bbox.getCenter(centre);
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(
          i,
          posAttr.getX(i) - centre.x,
          posAttr.getY(i) - centre.y,
          posAttr.getZ(i) - centre.z,
        );
      }
      posAttr.needsUpdate = true;

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
        position: { x: centre.x, y: centre.y, z: centre.z },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: {
          positions: Array.from(posAttr.array),
          normals: normAttr ? Array.from(normAttr.array) : null,
          indices: idxAttr ? Array.from(idxAttr.array) : null,
        },
      });
      setItemsHidden(selectedItems.map((i) => i.id));
      sharedMat.dispose();
    } catch (err) {
      console.error("CSG operation failed:", err);
      alert("Boolean operation failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Combine">
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
    </ToolbarSection>
  );
};

export default CombineSection;
