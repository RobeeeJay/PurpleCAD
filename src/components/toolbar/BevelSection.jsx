import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import {
  buildBrushTransform,
  extrudeWithLivePolygon,
  withLivePolygons,
  withLiveDepth,
} from "../../three/csgUtils.js";
import { chamferOrFilletItem } from "../../three/occClient.js";

const BevelSection = ({ bare = false }) => {
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const modifyItem = useStore((s) => s.modifyItem);
  const retargetChamferEntry = useStore((s) => s.retargetChamferEntry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const curveResolution = useStore((s) => s.curveResolution);
  const showNotification = useStore((s) => s.showNotification);
  const chamferRetargetTarget = useStore((s) => s.chamferRetargetTarget);
  const setChamferRetargetTarget = useStore((s) => s.setChamferRetargetTarget);

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

  const selectedItem = items.find((i) => i.id === selectedSubGeometry?.itemId);
  const canRetarget = !!(
    hasSelection && selectedItem?.regenerator?.kind === "chamfer"
  );

  // The newly-clicked face/edge selection is in the rendered (bbox-centred)
  // mesh's frame; prior.subGeo lives in the source's frame, offset by
  // -centerOffset.  Shift the new picks back into the source frame so they
  // line up with the geometry chamferOrFilletItem will search.
  const shiftSelectionToSource = (sel, centerOffset) => {
    const off = centerOffset || { cx: 0, cy: 0, cz: 0 };
    const shiftFace = (f) =>
      f.cx == null
        ? f
        : { ...f, cx: f.cx + off.cx, cy: f.cy + off.cy, cz: f.cz + off.cz };
    const shiftEdge = (ed) => ({
      ...ed,
      ax: ed.ax + off.cx,
      ay: ed.ay + off.cy,
      az: ed.az + off.cz,
      bx: ed.bx + off.cx,
      by: ed.by + off.cy,
      bz: ed.bz + off.cz,
    });
    return {
      edges: (sel.edges || []).map(shiftEdge),
      faces: (sel.faces || []).map(shiftFace),
    };
  };

  // Shared tail for apply()/retarget(): turn a chamferOrFilletItem result into
  // the item's new position + regenerator and commit it.
  const commitChamferResult = (
    item,
    source,
    result,
    subGeo,
    regenBase,
    label,
    entryId,
  ) => {
    const { geometryData, centerOffset } = result;
    const { cx, cy, cz } = centerOffset;
    // Store the topologically-resolved selection (edges carry their adjacent
    // face normals) so the chamfer re-matches its edges after a sketch /
    // variable resize moves their coordinates.
    const storedSubGeo = result.resolvedSubGeo || subGeo;

    const brushPos = buildBrushTransform(source).position;
    const rot = source.rotation || { x: 0, y: 0, z: 0 };
    const local = new THREE.Vector3(cx, cy, cz);
    local.applyEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));

    const patches = {
      type: "csg",
      position: {
        x: brushPos.x + local.x,
        y: brushPos.y + local.y,
        z: brushPos.z + local.z,
      },
      regenerator: {
        ...regenBase,
        source,
        subGeo: storedSubGeo,
        // bbox-centre offset in the source's LOCAL frame.
        centerOffset: { cx, cy, cz },
      },
      geometryData,
    };

    // Retargeting an existing chamfer/fillet updates that step's patches
    // in place; a first-time apply() inserts a new "Chamfered"/"Filleted"
    // history entry.
    if (entryId) retargetChamferEntry(entryId, patches);
    else modifyItem(item.id, patches, label);
    clearSelectedSubGeometry();
  };

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
        // prior.source is the extrude snapshot captured at the FIRST chamfer.
        // After a sketch / variable / depth edit it's stale, so re-derive its
        // live polygon and pull the current depth off the item — otherwise the
        // appended chamfer is built (and positioned via buildBrushTransform)
        // at the old size and the object jumps in height.
        source = extrudeWithLivePolygon(
          { ...prior.source, depth: item.depth ?? prior.source.depth },
          items,
          printPrecision,
        );
        // The newly-clicked face/edge was picked on THIS item's rendered mesh,
        // whose geometry is bbox-centred (the prior chamfer subtracted its
        // centerOffset).  prior.subGeo lives in the original source's frame, and
        // we re-run the chamfer on that source — so shift the new selection back
        // into the source frame by +centerOffset before merging, or it lands in
        // the wrong place and matches no face (the second chamfer silently does
        // nothing).  The centring is a pure translation, so normals are
        // unchanged.
        const shifted = shiftSelectionToSource(
          selectedSubGeometry,
          prior.centerOffset,
        );
        subGeo = {
          edges: [...(prior.subGeo?.edges || []), ...shifted.edges],
          faces: [...(prior.subGeo?.faces || []), ...shifted.faces],
        };
      } else {
        // KEEP the source's existing regenerator: buildItemShapeLocal
        // needs it to rebuild a CSG source's OCC shape from its
        // boolean / prior-chamfer recipe.  Stripping it left the source
        // with only `geometryData`, which isn't enough to construct a
        // TopoDS_Shape — chamferOrFilletItem then returned null and the
        // chamfer / bevel silently did nothing on any object that had a
        // boolean operation applied.
        // Re-derive the extrude's profile from its CURRENT sketch so the
        // chamfer is built (and positioned via buildBrushTransform) from the
        // live polygon — not the stale one captured when the extrude was made.
        // Otherwise a sketch-variable resize leaves the chamfer using the old
        // size/centroid and the object jumps in position and size.
        // withLivePolygons recurses: when `item` is already a CSG (chaining a
        // bevel onto a chamfer), it refreshes the NESTED extrude too, so the
        // Electron bridge — which can't re-derive — doesn't build the chained
        // source from a stale nested polygon and shift the object.
        source = withLivePolygons(
          withLiveDepth({ ...item }, item.depth),
          items,
          printPrecision,
        );
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
      if (!result) {
        showNotification(
          "Could not apply — the distance may be too large for the selected geometry.",
        );
        return;
      }
      commitChamferResult(
        item,
        source,
        result,
        subGeo,
        {
          kind: "chamfer",
          amount,
          segments,
          angleRad,
          regeneratedAt: printPrecision,
        },
        segments === 1 ? "Chamfered" : "Filleted",
      );
    } catch (err) {
      console.error("Chamfer operation failed:", err);
      showNotification(err.message);
    }
  };

  // Re-run an existing chamfer/fillet against a NEWLY-picked face/edge
  // selection — same amount/segments/angle, but the OLD subGeo is replaced
  // entirely (not appended to), so the result tracks the new geometry instead
  // of growing to cover both.
  const retarget = async () => {
    if (!canRetarget) return;
    const item = selectedItem;
    const prior = item.regenerator;
    // The history entry whose patches describe this item's current
    // chamfer/fillet — found via chamferRetargetTarget when the Timeline's
    // Retarget button armed this, or by scanning for the latest "modify"
    // entry on this item when retargeting via the toolbar button directly.
    const entryId =
      chamferRetargetTarget?.itemId === item.id
        ? chamferRetargetTarget.entryId
        : [...history]
            .reverse()
            .find(
              (h) =>
                h.instruction?.type === "modify" &&
                h.instruction.itemId === item.id &&
                h.instruction.patches?.regenerator?.kind === "chamfer",
            )?.id;
    if (!entryId) return;
    try {
      const printPrecision = curveResolution === "print" ? 0.01 : null;
      const source = withLivePolygons(
        withLiveDepth({ ...prior.source }, item.depth ?? prior.source.depth),
        items,
        printPrecision,
      );
      const subGeo = shiftSelectionToSource(
        selectedSubGeometry,
        prior.centerOffset,
      );
      if (subGeo.edges.length === 0 && subGeo.faces.length === 0) return;

      const result = await chamferOrFilletItem({
        source,
        subGeo,
        amount: prior.amount,
        angleRad: prior.angleRad ?? null,
        segments: prior.segments,
        allItems: items,
        printPrecision,
      });
      if (!result) {
        showNotification(
          "Could not retarget — the distance may be too large for the selected geometry.",
        );
        return;
      }
      commitChamferResult(
        item,
        source,
        result,
        subGeo,
        {
          kind: "chamfer",
          amount: prior.amount,
          segments: prior.segments,
          angleRad: prior.angleRad ?? null,
          regeneratedAt: printPrecision,
        },
        prior.segments === 1 ? "Chamfered" : "Filleted",
        entryId,
      );
    } catch (err) {
      console.error("Chamfer retarget failed:", err);
      showNotification(err.message);
    }
  };

  // The Timeline's "Retarget" button arms chamferRetargetTarget; the next
  // face/edge picked on that same item re-applies the chamfer/fillet there
  // automatically — picking new geometry IS the confirmation, no second
  // button click needed.
  useEffect(() => {
    if (!chamferRetargetTarget || !hasSelection) return;
    if (selectedSubGeometry.itemId !== chamferRetargetTarget.itemId) return;
    setChamferRetargetTarget(null);
    retarget();
  }, [selectedSubGeometry, chamferRetargetTarget]);

  const body = (
    <>
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
      <button
        className="toolbar-btn"
        title="Retarget — rebuild the selected chamfer/fillet from the newly picked face(s)/edge(s)"
        disabled={!canRetarget}
        onClick={retarget}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            x="3"
            y="14"
            width="12"
            height="7"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polygon
            points="3,14 6,9 18,9 18,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.6"
          />
          <circle
            cx="19"
            cy="5"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="19" cy="5" r="1" fill="currentColor" />
        </svg>
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default BevelSection;
