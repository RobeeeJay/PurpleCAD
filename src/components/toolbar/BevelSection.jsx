import React, { useState } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import { buildBrushTransform } from "../../three/csgUtils.js";
import { chamferOrFilletItem } from "../../three/occClient.js";

const BevelSection = () => {
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const items = useStore((s) => s.items);
  const modifyItem = useStore((s) => s.modifyItem);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const curveResolution = useStore((s) => s.curveResolution);

  // User-controllable chamfer parameters.  Distance is in millimetres
  // (converted to scene units by MM_PER_UNIT before passing to OCC).
  // Angle is in degrees and only affects the Chamfer button (fillet has
  // no angle parameter — its radius alone determines the curve).  45° is
  // the symmetric default that matches a plain Add(dist, edge) call.
  const [distanceMm, setDistanceMm] = useState(0.5); // 0.5 mm = 0.05 scene units
  const [angleDeg, setAngleDeg] = useState(45);

  const hasSelection =
    selectedSubGeometry &&
    ((selectedSubGeometry.edges?.length ?? 0) > 0 ||
      (selectedSubGeometry.faces?.length ?? 0) > 0);

  // `segments` here is preserved from the old (custom-mesh) chamfer API:
  // segments=1 → chamfer (flat); segments>1 → bevel (rounded).  OCC
  // expresses these as BRepFilletAPI_MakeChamfer (constant distance) and
  // BRepFilletAPI_MakeFillet (radius); we map directly.
  const apply = async (segments) => {
    if (!hasSelection) return;
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;

    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const amount = distanceMm / MM_PER_UNIT;
      // Only chamfer (segments=1) uses the angle; fillet is purely
      // radius-driven.  Treat angle ≈ 45° as "symmetric" and skip the
      // AddDA path (cheaper, and BRepFilletAPI_MakeChamfer's Add_2 also
      // handles convex/concave cases more robustly).
      const angleRad =
        segments === 1 && Math.abs(angleDeg - 45) > 0.1
          ? (angleDeg * Math.PI) / 180
          : null;

      // If the item already has a prior bevel/chamfer recipe with the same
      // amount/segments, append the new edges + faces to it and re-run
      // the whole operation on the original source.  Otherwise snapshot
      // the current item as the source.
      const prior = item.regenerator;
      let source, subGeo;
      if (
        prior?.kind === "chamfer" &&
        prior.amount === amount &&
        prior.segments === segments
      ) {
        source = prior.source;
        subGeo = {
          edges: [
            ...(prior.subGeo?.edges || []),
            ...(selectedSubGeometry.edges || []),
          ],
          faces: [
            ...(prior.subGeo?.faces || []),
            ...(selectedSubGeometry.faces || []),
          ],
        };
      } else {
        // KEEP the source's existing regenerator: buildItemShapeLocal
        // needs it to rebuild a CSG source's OCC shape from its
        // boolean / prior-chamfer recipe.  Stripping it left the source
        // with only `geometryData`, which isn't enough to construct a
        // TopoDS_Shape — chamferOrFilletItem then returned null and the
        // chamfer / bevel silently did nothing on any object that had a
        // boolean operation applied.
        source = { ...item };
        subGeo = {
          edges: selectedSubGeometry.edges || [],
          faces: selectedSubGeometry.faces || [],
        };
      }
      if (subGeo.edges.length === 0 && subGeo.faces.length === 0) return;

      // Delegated to occClient — handles building the source shape,
      // applying chamfer (segments=1) or fillet (segments>1), tessellating,
      // and centring the result around its bbox.  The "By" variants used
      // inside handle both explicit edge endpoints and face-normal
      // selections.  Returns null when nothing matched.
      const result = await chamferOrFilletItem({
        source,
        subGeo,
        amount,
        angleRad,
        segments,
        allItems: items,
        printPrecision,
      });
      if (!result) return;
      const { geometryData, centerOffset } = result;
      const { cx, cy, cz } = centerOffset;

      const brushPos = buildBrushTransform(source).position;
      const rot = source.rotation || { x: 0, y: 0, z: 0 };
      const local = new THREE.Vector3(cx, cy, cz);
      local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));

      modifyItem(
        item.id,
        {
          type: "csg",
          position: {
            x: brushPos.x + local.x,
            y: brushPos.y + local.y,
            z: brushPos.z + local.z,
          },
          regenerator: {
            kind: "chamfer",
            source,
            subGeo,
            amount,
            segments,
            angleRad,
            // bbox-centre offset in the source's LOCAL frame.
            // buildItemShapeLocal uses this to translate the rebuilt
            // chamfer OCC shape into the same frame as the visible
            // mesh — without it, a later cut on this chamfer lands
            // R*centerOffset away from where the mesh is rendered.
            centerOffset: { cx, cy, cz },
            regeneratedAt: printPrecision,
          },
          geometryData,
        },
        segments === 1 ? "Chamfered" : "Filleted",
      );
      clearSelectedSubGeometry();
    } catch (err) {
      console.error("Chamfer operation failed:", err);
      alert("Chamfer operation failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Modify">
      <label
        title="Chamfer/Bevel distance in mm"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "#aaa",
        }}
      >
        <span>D</span>
        <input
          type="number"
          step="0.1"
          min="0.05"
          value={distanceMm}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) setDistanceMm(v);
          }}
          style={{ width: 48 }}
        />
      </label>
      <label
        title="Chamfer angle (degrees; 45° = symmetric)"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "#aaa",
        }}
      >
        <span>θ</span>
        <input
          type="number"
          step="1"
          min="1"
          max="89"
          value={angleDeg}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0 && v < 90) setAngleDeg(v);
          }}
          style={{ width: 44 }}
        />
      </label>
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
