import React from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { buildBrushTransform } from "../../three/csgUtils.js";
import { makePrimitiveShape } from "../../three/occ/primitives.js";
import { chamferShape, filletShape } from "../../three/occ/operations.js";
import { tessellateToData } from "../../three/occ/tessellate.js";

const BevelSection = () => {
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const items = useStore((s) => s.items);
  const modifyItem = useStore((s) => s.modifyItem);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const curveResolution = useStore((s) => s.curveResolution);

  const hasSelection =
    selectedSubGeometry &&
    ((selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0);

  // `segments` here is preserved from the old (custom-mesh) chamfer API:
  // segments=1 → chamfer (flat); segments>1 → bevel (rounded).  OCC
  // expresses these as BRepFilletAPI_MakeChamfer (constant distance) and
  // BRepFilletAPI_MakeFillet (radius); we map directly.
  const apply = (segments) => {
    if (!hasSelection) return;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const amount = 0.05;

      // If the item already has a prior bevel/chamfer recipe with the same
      // amount/segments, append the new edges to it and re-run the whole
      // operation on the original source.  Otherwise snapshot the current
      // item as the source.
      const prior = item.regenerator;
      let source, edges;
      if (
        prior?.kind === "chamfer" &&
        prior.amount === amount &&
        prior.segments === segments
      ) {
        source = prior.source;
        edges = [
          ...(prior.subGeo?.edges || []),
          ...(selectedSubGeometry.edges || []),
        ];
      } else {
        const sourceSnapshot = { ...item };
        delete sourceSnapshot.regenerator;
        source = sourceSnapshot;
        edges = selectedSubGeometry.edges || [];
      }
      if (edges.length === 0) return;

      // Build the source OCC shape, apply chamfer (segments=1) or fillet
      // (segments>1), tessellate.
      const sourceShape = makePrimitiveShape(source);
      if (!sourceShape) return;
      const op = segments === 1 ? chamferShape : filletShape;
      const result = op(sourceShape, edges, amount);
      if (!result) return;
      const data = tessellateToData(result, printPrecision);
      if (!data) return;

      // Centre and compute world position from source's brushPos.
      const arr = data.positions;
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity,
        maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < arr.length; i += 3) {
        if (arr[i] < minX) minX = arr[i];
        if (arr[i] > maxX) maxX = arr[i];
        if (arr[i + 1] < minY) minY = arr[i + 1];
        if (arr[i + 1] > maxY) maxY = arr[i + 1];
        if (arr[i + 2] < minZ) minZ = arr[i + 2];
        if (arr[i + 2] > maxZ) maxZ = arr[i + 2];
      }
      const cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2,
        cz = (minZ + maxZ) / 2;
      const centered = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) {
        centered[i] = arr[i] - cx;
        centered[i + 1] = arr[i + 1] - cy;
        centered[i + 2] = arr[i + 2] - cz;
      }

      const brushPos = buildBrushTransform(source).position;
      const rot = source.rotation || { x: 0, y: 0, z: 0 };
      const local = new THREE.Vector3(cx, cy, cz);
      local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));

      modifyItem(item.id, {
        type: "csg",
        position: {
          x: brushPos.x + local.x,
          y: brushPos.y + local.y,
          z: brushPos.z + local.z,
        },
        regenerator: {
          kind: "chamfer",
          source,
          subGeo: { edges, faces: [] },
          amount,
          segments,
          regeneratedAt: printPrecision,
        },
        geometryData: {
          positions: Array.from(centered),
          normals: data.normals,
          indices: data.indices,
        },
      });
      clearSelectedSubGeometry();
    } catch (err) {
      console.error("Chamfer operation failed:", err);
      alert("Chamfer operation failed: " + err.message);
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
          <line
            x1="14"
            y1="4"
            x2="20"
            y2="10"
            stroke="currentColor"
            strokeWidth="2"
          />
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
