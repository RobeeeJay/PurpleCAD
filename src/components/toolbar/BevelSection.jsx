import React from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import {
  buildItemGeometry,
  buildBrushTransform,
} from "../../three/csgUtils.js";
import {
  applyBevelToSubGeometry,
  combineBevelSubGeoOnSource,
} from "../../three/bevelUtils.js";

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

  const apply = (segments) => {
    if (!hasSelection) return;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    try {
      // Honour the global high-resolution / print-mode setting so primitives
      // (sphere / cylinder / torus) are tessellated at the appropriate
      // chord-deviation precision before the bevel runs.
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const amount = 0.05;

      // If this item already has a bevel regenerator with the same
      // amount/segments, COMBINE the new selection with the prior one and
      // re-run the bevel on the ORIGINAL source.  Sequential application
      // would leave a hole at corners shared between successive chamfers
      // because Phase 3 (corner-fill + diagonal-bridge) only fires within a
      // single applyBevel call.  Combining lets Phase 3 close those corners.
      const prior = item.regenerator;
      let source, subGeo;
      if (
        prior?.kind === "bevel" &&
        prior.amount === amount &&
        prior.segments === segments
      ) {
        source = prior.source;
        const sourceGeo = buildItemGeometry(source, { printPrecision });
        subGeo = combineBevelSubGeoOnSource(
          prior.subGeo,
          selectedSubGeometry,
          sourceGeo,
          amount,
        );
      } else {
        // First bevel on this item — snapshot the current (pre-bevel) state
        // as the source for future re-runs.  Strip any prior regenerator
        // (e.g. a boolean) so the source can be cleanly rebuilt.
        const sourceSnapshot = { ...item };
        delete sourceSnapshot.regenerator;
        source = sourceSnapshot;
        subGeo = selectedSubGeometry;
      }

      const geo = buildItemGeometry(source, { printPrecision });
      if (!geo) return;

      const result = applyBevelToSubGeometry(geo, subGeo, amount, segments);
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
      // Use the SOURCE's brush transform so combined re-bevels land at the
      // same world position as the first bevel did.
      const brushPos = buildBrushTransform(source).position;
      const rot = source.rotation || { x: 0, y: 0, z: 0 };
      localCentre.applyEuler(
        new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
      );

      modifyItem(item.id, {
        type: "csg",
        position: {
          x: brushPos.x + localCentre.x,
          y: brushPos.y + localCentre.y,
          z: brushPos.z + localCentre.z,
        },
        regenerator: {
          kind: "bevel",
          source,
          subGeo,
          amount,
          segments,
          regeneratedAt: printPrecision,
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
