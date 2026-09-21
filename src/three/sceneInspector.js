// Scene inspector: flattens the document into plain, printable rows for the
// debug browser.  Pure — no three.js, no DOM — so the whole shape of what the
// inspector reports is unit-testable.  Live mesh facts (real vertex/triangle
// counts, world bbox) can't come from the store, so the caller passes a
// `meshInfo(id)` lookup backed by cameraControls' getObjectStats /
// getItemLocalSizeMm; everything else is read straight off the item.

import { MM_PER_UNIT } from "./sceneObjects/dimensions.js";
import { DISPLAY_AXES, toDisplay } from "../utils/axisDisplay.js";

const num = (v, dp = 3) =>
  typeof v === "number" && Number.isFinite(v) ? +v.toFixed(dp) : null;

// A position/scale/rotation triple in BOTH frames: the user-facing Z-up one
// every other dialog shows (so a value here matches the transform panel), and
// the raw internal three.js Y-up components — a debug view has to expose the
// internal numbers, but must never mislabel them with the user's axis letters.
export function vectorDetail(vec, { signed = true, dp = 3 } = {}) {
  if (!vec) return null;
  return {
    display: DISPLAY_AXES.map((a) => ({
      label: a.label,
      value: num(signed ? toDisplay(vec, a) : (vec[a.key] ?? 0), dp),
    })),
    internal: { x: num(vec.x, dp), y: num(vec.y, dp), z: num(vec.z, dp) },
  };
}

const radToDeg = (v) => (typeof v === "number" ? (v * 180) / Math.PI : 0);

// Classify a line by ANGLE, not by an exact-zero delta.  A solver-converged
// horizontal line still carries float residue (a real document had one off by
// 2.5e-6 units — 0.0001° — which an exact test wrongly called "angled" and the
// inspector then reported as a mis-bound constraint).
const ORIENT_TOL_DEG = 0.5;
export function lineOrientation(s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  if (Math.hypot(dx, dy) < 1e-12) return "degenerate";
  // Angle to the X axis, folded into 0..90.
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  const fromH = Math.min(deg, Math.abs(180 - deg));
  const fromV = Math.abs(90 - deg);
  if (fromH <= ORIENT_TOL_DEG) return "horizontal";
  if (fromV <= ORIENT_TOL_DEG) return "vertical";
  return "angled";
}

// Constraint distances are usually authored as formula STRINGS; a plain
// numeric string still has a comparable value, anything else (a variable
// expression) can't be checked here.
const numericValue = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v))
    return Number(v);
  return null;
};

// Per-shape breakdown of a sketch: enough to identify a line/circle/arc and
// see the coordinates a constraint is bound to.
export function sketchShapeRows(item) {
  return (item.shapes || []).map((s, idx) => {
    const row = { idx, type: s.type, flags: [] };
    if (s.projection) row.flags.push(`projected:${s.projection.key}`);
    if (s.dashed) row.flags.push("dashed");
    if (s.construction) row.flags.push("construction");
    if (s.kind) row.flags.push(s.kind);
    if (s.group != null) row.flags.push(`group:${s.group}`);
    switch (s.type) {
      case "line":
        row.geometry = {
          start: { x: num(s.x1), y: num(s.y1) },
          end: { x: num(s.x2), y: num(s.y2) },
          lengthMm: num(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * MM_PER_UNIT, 2),
          orientation: lineOrientation(s),
        };
        break;
      case "circle":
        row.geometry = {
          center: { x: num(s.cx), y: num(s.cy) },
          radiusMm: num((s.r ?? 0) * MM_PER_UNIT, 2),
        };
        break;
      case "arc":
        row.geometry = {
          center: { x: num(s.cx), y: num(s.cy) },
          radiusMm: num((s.r ?? 0) * MM_PER_UNIT, 2),
          startAngleDeg: num(radToDeg(s.startAngle), 2),
          endAngleDeg: num(radToDeg(s.endAngle), 2),
        };
        break;
      case "ellipse":
        row.geometry = {
          center: { x: num(s.cx), y: num(s.cy) },
          rxMm: num((s.rx ?? 0) * MM_PER_UNIT, 2),
          ryMm: num((s.ry ?? 0) * MM_PER_UNIT, 2),
          rotationDeg: num(radToDeg(s.rotation || 0), 2),
        };
        break;
      case "bezier":
        row.geometry = {
          p0: { x: num(s.p0?.x), y: num(s.p0?.y) },
          p3: { x: num(s.p3?.x), y: num(s.p3?.y) },
        };
        break;
      case "point":
        row.geometry = { at: { x: num(s.x), y: num(s.y) } };
        break;
      case "cog":
        row.geometry = {
          centre: { x: num(s.x), y: num(s.y) },
          pitchDiameterMm: num(s.pitchDiameter * MM_PER_UNIT, 3),
          holeDiameterMm: num(s.holeDiameter * MM_PER_UNIT, 3),
          teeth: s.teeth,
          backlashMm: num(s.backlash * MM_PER_UNIT, 3),
          rootFilletMm: num(s.rootFillet * MM_PER_UNIT, 3),
          contours: (s.contours || []).length,
        };
        break;
      case "text":
        row.geometry = {
          text: s.text,
          heightMm: num((s.height ?? 0) * MM_PER_UNIT, 2),
          font: s.font,
          contours: (s.contours || []).length,
        };
        break;
      default:
        row.geometry = {};
    }
    return row;
  });
}

// Every shape index a constraint names, so the inspector can flag one that
// points outside the shape array (the corruption class where a structural
// edit renumbered shapes without remapping the constraints).
const CONSTRAINT_INDEX_FIELDS = [
  "shapeAIdx",
  "shapeBIdx",
  "shapeIdx",
  "pointShapeIdx",
  "lineShapeIdx",
  "origIdx",
  "lineIdx",
  "centerShapeIdx",
];

export function sketchConstraintRows(item) {
  const shapes = item.shapes || [];
  return (item.constraints || []).map((c, idx) => {
    const refs = [];
    for (const f of CONSTRAINT_INDEX_FIELDS)
      if (typeof c[f] === "number") refs.push({ field: f, idx: c[f] });
    // A centre constraint names each shape as a list of indices.
    for (const f of ["shapesA", "shapesB"])
      for (const i of Array.isArray(c[f]) ? c[f] : [])
        refs.push({ field: f, idx: i });
    const dangling = refs.filter((r) => r.idx < 0 || r.idx >= shapes.length);
    // A H/V constraint whose line isn't actually H/V, or a self-distance whose
    // measured length disagrees, is the visible symptom of a mis-bound index.
    // Only report a mismatch the geometry CONTRADICTS, so an under-constrained
    // or mid-solve sketch isn't painted as corrupt: an H constraint on a
    // demonstrably vertical line (and vice versa) is a real mis-binding, while
    // a merely "angled" line is normal for a sketch still being drawn.
    let mismatch = null;
    if (c.type === "horizontal" || c.type === "vertical") {
      const s = shapes[c.shapeIdx];
      if (s?.type === "line") {
        const actual = lineOrientation(s);
        const opposite = c.type === "horizontal" ? "vertical" : "horizontal";
        if (actual === opposite) mismatch = `line is ${actual}`;
      }
    }
    if (c.type === "distance" && c.shapeAIdx === c.shapeBIdx) {
      const s = shapes[c.shapeAIdx];
      const want = numericValue(c.distance);
      if (s?.type === "line" && want != null) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * MM_PER_UNIT;
        // Relative tolerance: a 1955 mm dimension shouldn't trip on rounding,
        // but a 30 mm line under a 145 mm dimension must.
        if (Math.abs(len - want) > Math.max(0.5, want * 0.01))
          mismatch = `measures ${len.toFixed(1)}mm`;
      }
    }
    return {
      idx,
      type: c.type,
      value: c.distance ?? c.angle ?? null,
      refs,
      dangling: dangling.length > 0 ? dangling : null,
      mismatch,
      raw: c,
    };
  });
}

// One inspector row per scene item.  `meshInfo` supplies what only the live
// three.js object knows; it may return null (an item with no built mesh).
export function buildInspectorRows(items, meshInfo = () => null) {
  return (items || []).map((item) => {
    const mesh = meshInfo(item.id) || {};
    const row = {
      id: item.id,
      name: item.name ?? null,
      type: item.type,
      parentId: item.parentId ?? null,
      visible: item.visible !== false,
      transform: {
        position: vectorDetail(item.position),
        // Rotation is stored in radians; show degrees (what the UI edits).
        rotationDeg: vectorDetail(
          item.rotation
            ? {
                x: radToDeg(item.rotation.x),
                y: radToDeg(item.rotation.y),
                z: radToDeg(item.rotation.z),
              }
            : null,
        ),
        // Scale is a magnitude, never sign-flipped by the display frame.
        scale: vectorDetail(item.scale, { signed: false }),
      },
      mesh: {
        vertices: mesh.points ?? null,
        triangles: mesh.faces ?? null,
        sizeMm: mesh.sizeMm ?? null,
        worldPosition: mesh.worldPosition
          ? vectorDetail(mesh.worldPosition)
          : null,
        // A store-baked mesh (csg/imported); extrudes/primitives build theirs
        // in the renderer, so this being null is normal, not a fault.
        bakedVertices: item.geometryData?.positions
          ? item.geometryData.positions.length / 3
          : null,
      },
      material: item.material
        ? { color: item.material.color, opacity: item.material.opacity }
        : null,
      warnings: [],
    };

    if (item.regenerator) {
      const r = item.regenerator;
      row.recipe = {
        kind: r.kind,
        op: r.op ?? null,
        inputIds: r.inputIds ?? null,
        regeneratedAt: r.regeneratedAt ?? null,
        extrudeDefs: Array.isArray(r.extrudeDefs) ? r.extrudeDefs.length : null,
        sourceId: r.source?.id ?? null,
        sourceType: r.source?.type ?? null,
      };
      if (r.regenFailed) row.warnings.push("regeneration failed");
    }

    if (item.type === "extrude" && item.profile) {
      const p = item.profile;
      row.extrude = {
        depth: item.depth ?? null,
        isCut: !!item.isCut,
        startOffset: num(item.startOffset ?? 0),
        profileType: p.type,
        sketchId: p.sketchId ?? null,
        sourceItemId: p.sourceItemId ?? null,
        polygonPoints: (p.polygon2D || []).length,
        holes: (p.holes || []).length,
        centroid: p.profileCentroid
          ? { x: num(p.profileCentroid.x), y: num(p.profileCentroid.y) }
          : null,
      };
    }

    if (item.type === "sketch") {
      const shapeRows = sketchShapeRows(item);
      const constraintRows = sketchConstraintRows(item);
      row.sketch = {
        hostSolidId: item.hostSolidId ?? null,
        shapeCount: shapeRows.length,
        constraintCount: constraintRows.length,
        projectedShapes: shapeRows.filter((s) =>
          s.flags.some((f) => f.startsWith("projected")),
        ).length,
        underlay: item.underlay
          ? {
              name: item.underlay.name,
              widthMm: item.underlay.widthMm,
              opacity: item.underlay.opacity,
            }
          : null,
        shapes: shapeRows,
        constraints: constraintRows,
      };
      const bad = constraintRows.filter((c) => c.dangling || c.mismatch);
      if (bad.length)
        row.warnings.push(
          `${bad.length} constraint(s) reference the wrong shape`,
        );
    }

    return row;
  });
}

// Flat text of the whole inspection — for pasting into a bug report.
export function inspectorReport(rows) {
  return JSON.stringify(rows, null, 2);
}
