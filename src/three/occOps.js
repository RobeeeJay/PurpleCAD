// OCC operation bodies — native C++ addon implementation.
//
// Each op takes a plain-JS args object and returns a Promise resolving to
// a plain-JS result (or null for no-ops).  Shape IDs never escape these
// functions: every ID created is released before the function returns.

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const occ = _require("../../native/occ-addon/build/Release/occ_addon.node");

import {
  buildBrushTransform,
  chamferCenterOffset,
  extrudeWithLivePolygon,
} from "./csgUtils.js";
import { polyCentroid } from "./sceneObjects.js";
import { MM_PER_UNIT } from "./sceneObjects.js";
import { withWinding } from "./sceneObjects/closedLoops.js";
import { resolveItemDepth } from "./geometryParams.js";

const EXPORTABLE_TYPES = new Set([
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "extrude",
  "csg",
]);

function bboxOf(positions) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Resolve a revolve axis ({ sketchId, shapeIdx }) to its live 2D endpoints by
// reading the referenced line from the current sketch, so editing the sketch
// moves the axis too.  Returns null if the line is gone.
function resolveAxisEndpoints(axis, allItems) {
  if (!axis) return null;
  const sketch = (allItems || []).find(
    (i) => i.id === axis.sketchId && i.type === "sketch",
  );
  const line = sketch?.shapes?.[axis.shapeIdx];
  if (!line || line.type !== "line") return null;
  return { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
}

// Build the makeRevolve arguments from a revolve recipe's source profile (live
// polygon) + axis.  Returns null when the profile/axis can't be resolved.
function revolveArgs(source, axis, allItems, precision) {
  const live = extrudeWithLivePolygon(source, allItems, precision);
  const poly = live.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const ax = resolveAxisEndpoints(axis, allItems);
  if (!ax) return null;
  const holes = (live.profile?.holes || []).filter((h) => h && h.length >= 3);
  const c = polyCentroid(poly);
  const outerFlat = new Float64Array(
    withWinding(poly, true).flatMap((p) => [p.x, p.y]),
  );
  const holesFlat = holes.map(
    (h) => new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
  );
  return { outerFlat, holesFlat, cx: c.x, cy: c.y, ax };
}

// ── Pipe sweep helpers ────────────────────────────────────────────────────

// XYZ-Euler rotation of a vector (matches THREE.applyEuler('XYZ') and the
// Electron bridge), used to map a sketch's 2D points onto its world plane.
function applyEulerXYZ(vx, vy, vz, rx, ry, rz) {
  const a = Math.cos(rx),
    b = Math.sin(rx),
    c = Math.cos(ry),
    d = Math.sin(ry),
    e = Math.cos(rz),
    f = Math.sin(rz);
  const ae = a * e,
    af = a * f,
    be = b * e,
    bf = b * f;
  return {
    x: c * e * vx + -c * f * vy + d * vz,
    y: (af + be * d) * vx + (ae - bf * d) * vy + -b * c * vz,
    z: (bf - ae * d) * vx + (be + af * d) * vy + a * c * vz,
  };
}

function sketchPointToWorld(sketch, x, y) {
  const r = sketch.rotation || { x: 0, y: 0, z: 0 };
  const p = sketch.position || { x: 0, y: 0, z: 0 };
  const w = applyEulerXYZ(x, y, 0, r.x || 0, r.y || 0, r.z || 0);
  return { x: w.x + (p.x || 0), y: w.y + (p.y || 0), z: w.z + (p.z || 0) };
}

// Sample a cubic bezier (p0..p3) into n+1 ordered 2D points.
function sampleCubic(p0, p1, p2, p3, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      u = 1 - t;
    out.push({
      x:
        u * u * u * p0.x +
        3 * u * u * t * p1.x +
        3 * u * t * t * p2.x +
        t * t * t * p3.x,
      y:
        u * u * u * p0.y +
        3 * u * u * t * p1.y +
        3 * u * t * t * p2.y +
        t * t * t * p3.y,
    });
  }
  return out;
}

// A path-eligible shape as { a, b, sample(reverse) } — its endpoints plus an
// ordered point list (a→b, or reversed) used to thread it into the polyline.
function pathSegment(shape, i) {
  if (shape?.type === "line") {
    const a = { x: shape.x1, y: shape.y1 };
    const b = { x: shape.x2, y: shape.y2 };
    return { i, a, b, sample: (rev) => (rev ? [b, a] : [a, b]) };
  }
  if (shape?.type === "bezier") {
    const a = { x: shape.p0.x, y: shape.p0.y };
    const b = { x: shape.p3.x, y: shape.p3.y };
    const pts = sampleCubic(shape.p0, shape.p1, shape.p2, shape.p3, 24);
    return {
      i,
      a,
      b,
      sample: (rev) => (rev ? pts.slice().reverse() : pts.slice()),
    };
  }
  return null;
}

// Order the path: starting from the picked shape, greedily walk endpoint-
// connected lines/beziers in the sketch (both directions) into one 2D polyline,
// sampling curves along the way.  Geometry-based so it works whether or not
// coincident constraints exist.
export function orderPathPoints(sketch, startShapeIdx) {
  const shapes = sketch?.shapes || [];
  const segs = [];
  shapes.forEach((s, i) => {
    const seg = pathSegment(s, i);
    if (seg) segs.push(seg);
  });
  const startSeg = segs.find((s) => s.i === startShapeIdx);
  if (!startSeg) return null;
  const eps = 1e-4;
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < eps;
  const used = new Set([startShapeIdx]);
  let pts = startSeg.sample(false);
  const extend = (atEnd) => {
    let changed = true;
    while (changed) {
      changed = false;
      const tip = atEnd ? pts[pts.length - 1] : pts[0];
      for (const seg of segs) {
        if (used.has(seg.i)) continue;
        // Sample so the new segment's points START at the shared tip.
        const segPts = near(seg.a, tip)
          ? seg.sample(false)
          : near(seg.b, tip)
            ? seg.sample(true)
            : null;
        if (segPts) {
          used.add(seg.i);
          if (atEnd) pts = pts.concat(segPts.slice(1));
          else pts = segPts.slice(1).reverse().concat(pts);
          changed = true;
          break;
        }
      }
    }
  };
  extend(true);
  extend(false);
  return pts;
}

// Resolve a pipe path ({ sketchId, shapeIdx }) to its live world polyline.
function pipePathWorld(pathRef, allItems) {
  const sketch = (allItems || []).find(
    (i) => i.id === pathRef?.sketchId && i.type === "sketch",
  );
  if (!sketch) return null;
  const pts2d = orderPathPoints(sketch, pathRef.shapeIdx);
  if (!pts2d || pts2d.length < 2) return null;
  return pts2d.map((p) => sketchPointToWorld(sketch, p.x, p.y));
}

// Build makePipe args: 2D profile (live from sketch A) + the path's world
// polyline (live from sketch B).  Returns null if either can't be resolved.
function pipeArgs(profileSource, pathRef, allItems, precision) {
  const live = extrudeWithLivePolygon(profileSource, allItems, precision);
  const poly = live.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const pathWorld = pipePathWorld(pathRef, allItems);
  if (!pathWorld) return null;
  const holes = (live.profile?.holes || []).filter((h) => h && h.length >= 3);
  const c = polyCentroid(poly);
  const outerFlat = new Float64Array(
    withWinding(poly, true).flatMap((p) => [p.x, p.y]),
  );
  const holesFlat = holes.map(
    (h) => new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
  );
  const pathFlat = new Float64Array(pathWorld.flatMap((p) => [p.x, p.y, p.z]));
  return { outerFlat, holesFlat, cx: c.x, cy: c.y, pathFlat };
}

// ── Loft helpers ──────────────────────────────────────────────────────────

// Map a 2D sketch polygon onto its world plane (position + XYZ-euler rotation).
function polyToWorld(poly, position, rotation) {
  const r = rotation || { x: 0, y: 0, z: 0 };
  const p = position || { x: 0, y: 0, z: 0 };
  return poly.map((pt) => {
    const w = applyEulerXYZ(pt.x, pt.y, 0, r.x || 0, r.y || 0, r.z || 0);
    return { x: w.x + (p.x || 0), y: w.y + (p.y || 0), z: w.z + (p.z || 0) };
  });
}

// Build makeLoft args: both profiles' live outer loops, wound CCW and mapped to
// their world planes.  Returns null if either can't be resolved.  (Holes aren't
// lofted — outer boundaries only.)
function loftArgs(profileSource, secondSource, allItems, precision) {
  const liveA = extrudeWithLivePolygon(profileSource, allItems, precision);
  const liveB = extrudeWithLivePolygon(secondSource, allItems, precision);
  const pa = liveA.profile?.polygon2D;
  const pb = liveB.profile?.polygon2D;
  if (!pa || pa.length < 3 || !pb || pb.length < 3) return null;
  const worldA = polyToWorld(
    withWinding(pa, true),
    liveA.profile.position,
    liveA.profile.rotation,
  );
  const worldB = polyToWorld(
    withWinding(pb, true),
    liveB.profile.position,
    liveB.profile.rotation,
  );
  return {
    aFlat: new Float64Array(worldA.flatMap((p) => [p.x, p.y, p.z])),
    bFlat: new Float64Array(worldB.flatMap((p) => [p.x, p.y, p.z])),
  };
}

// Build the native OCC shape for an item in its LOCAL frame (matching the
// frame of the rendered geometryData so edge endpoints from the viewport
// mesh align with the OCC shape's edges).
//
// Returns a shape ID (integer >= 1) on success, or null on failure.
// Caller MUST release the returned ID via occ.releaseShape().
export function buildItemShapeLocal(item, allItems = [], precision = null) {
  if (item.type === "cube") return occ.makeBox(-1, -1, -1, 1, 1, 1);
  if (item.type === "sphere") return occ.makeSphere(1.5);
  if (item.type === "cylinder") return occ.makeCylinder(-1, 1, 2);
  if (item.type === "torus") return occ.makeTorus(1.0, 0.4);

  if (item.type === "extrude") {
    const live = extrudeWithLivePolygon(item, allItems, precision);
    const poly = live.profile?.polygon2D;
    if (!poly || poly.length < 3) return null;
    const holes = live.profile?.holes || [];
    const depth = resolveItemDepth(live);
    const c = polyCentroid(poly);
    const outerFlat = new Float64Array(
      withWinding(poly, true).flatMap((p) => [p.x, p.y]),
    );
    const holesFlat = holes
      .filter((h) => h && h.length >= 3)
      .map(
        (h) =>
          new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
      );
    const prismId = occ.makeExtrude(outerFlat, holesFlat, c.x, c.y, depth);
    // startOffset slides the prism base along the extrude normal (local +Z),
    // matching the rendered mesh's translate, so the OCC shape used for CSG
    // lands where the user sees the preview.
    const startOffset = live.startOffset || 0;
    if (prismId != null && startOffset) {
      const shifted = occ.transformShape(prismId, 0, 0, startOffset, 0, 0, 0);
      occ.releaseShape(prismId);
      return shifted;
    }
    return prismId;
  }

  if (item.type === "csg" && item.regenerator) {
    const r = item.regenerator;

    if (r.kind === "chamfer") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      const subGeo = r.subGeo || { edges: [], faces: [] };
      const amount = r.amount ?? 0.05;
      let resultId;
      try {
        resultId =
          r.segments === 1
            ? occ.chamferShape(sourceId, subGeo, amount, r.angleRad ?? null)
            : occ.filletShape(sourceId, subGeo, amount);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const offset = chamferCenterOffset(r, item);
      if (
        offset &&
        (Math.abs(offset.x) > 1e-9 ||
          Math.abs(offset.y) > 1e-9 ||
          Math.abs(offset.z) > 1e-9)
      ) {
        const corrected = occ.transformShape(
          resultId,
          -offset.x,
          -offset.y,
          -offset.z,
          0,
          0,
          0,
        );
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (r.kind === "pushpull") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      const subGeo = r.subGeo || { faces: [] };
      let resultId;
      try {
        resultId = occ.pushPullFaces(sourceId, subGeo, r.distance ?? 0);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const offset = chamferCenterOffset(r, item);
      if (
        offset &&
        (Math.abs(offset.x) > 1e-9 ||
          Math.abs(offset.y) > 1e-9 ||
          Math.abs(offset.z) > 1e-9)
      ) {
        const corrected = occ.transformShape(
          resultId,
          -offset.x,
          -offset.y,
          -offset.z,
          0,
          0,
          0,
        );
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (r.kind === "revolve") {
      const args = revolveArgs(r.source, r.axis, allItems, precision);
      if (!args) return null;
      const resultId = occ.makeRevolve(
        args.outerFlat,
        args.holesFlat,
        args.cx,
        args.cy,
        args.ax.x1,
        args.ax.y1,
        args.ax.x2,
        args.ax.y2,
        r.angleRad ?? 2 * Math.PI,
        r.prismSides ?? 0,
      );
      if (!resultId) return null;
      const offset = chamferCenterOffset(r, item);
      if (
        offset &&
        (Math.abs(offset.x) > 1e-9 ||
          Math.abs(offset.y) > 1e-9 ||
          Math.abs(offset.z) > 1e-9)
      ) {
        const corrected = occ.transformShape(
          resultId,
          -offset.x,
          -offset.y,
          -offset.z,
          0,
          0,
          0,
        );
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (r.kind === "pipe") {
      const args = pipeArgs(r.profileSource, r.pathRef, allItems, precision);
      if (!args) return null;
      const resultId = occ.makePipe(
        args.outerFlat,
        args.holesFlat,
        args.cx,
        args.cy,
        args.pathFlat,
      );
      if (!resultId) return null;
      // Built in WORLD; centerOffset (the world bbox centre) is also the item
      // position, so subtract it to centre the local shape like the others.
      const offset = chamferCenterOffset(r, item);
      if (
        offset &&
        (Math.abs(offset.x) > 1e-9 ||
          Math.abs(offset.y) > 1e-9 ||
          Math.abs(offset.z) > 1e-9)
      ) {
        const corrected = occ.transformShape(
          resultId,
          -offset.x,
          -offset.y,
          -offset.z,
          0,
          0,
          0,
        );
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (r.kind === "loft") {
      const args = loftArgs(
        r.profileSource,
        r.secondProfileSource,
        allItems,
        precision,
      );
      if (!args) return null;
      const resultId = occ.makeLoft(args.aFlat, args.bFlat);
      if (!resultId) return null;
      // Built in WORLD; centerOffset (bbox centre) is also the item position.
      const offset = chamferCenterOffset(r, item);
      if (
        offset &&
        (Math.abs(offset.x) > 1e-9 ||
          Math.abs(offset.y) > 1e-9 ||
          Math.abs(offset.z) > 1e-9)
      ) {
        const corrected = occ.transformShape(
          resultId,
          -offset.x,
          -offset.y,
          -offset.z,
          0,
          0,
          0,
        );
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (r.kind === "boolean") {
      const inputShapeIds = (r.inputIds || [])
        .map((id) => allItems.find((i) => i.id === id))
        .filter(Boolean)
        .map((inp) => {
          const localId = buildItemShapeLocal(inp, allItems, precision);
          if (localId == null) return null;
          const t = buildBrushTransform(inp);
          let scaledId = localId;
          if (Math.abs(t.scale - 1) > 1e-9) {
            scaledId = occ.scaleShape(localId, t.scale);
            occ.releaseShape(localId);
          }
          const worldId = occ.transformShape(
            scaledId,
            t.position.x,
            t.position.y,
            t.position.z,
            t.rotation.x || 0,
            t.rotation.y || 0,
            t.rotation.z || 0,
          );
          if (scaledId !== localId) occ.releaseShape(scaledId);
          else occ.releaseShape(localId);
          return worldId;
        })
        .filter((id) => id != null);

      if (inputShapeIds.length === 0) return null;
      let worldId;
      if (inputShapeIds.length === 1) {
        // A single remaining input fuses to just that shape (re-localised
        // below); don't release it — it's the result.
        worldId = inputShapeIds[0];
      } else {
        try {
          worldId = occ.booleanOp(inputShapeIds, r.op || "difference");
        } finally {
          inputShapeIds.forEach((id) => occ.releaseShape(id));
        }
      }
      if (!worldId) return null;
      const center = r.originalCenter || item.position;
      if (center) {
        const localId = occ.transformShape(
          worldId,
          -center.x,
          -center.y,
          -center.z,
          0,
          0,
          0,
        );
        occ.releaseShape(worldId);
        return localId;
      }
      return worldId;
    }
  }

  return null;
}

// Build all visible exportable items in world space, scaled to mm and
// rotated +π/2 around X (viewport Y-up → export Z-up).
// Returns an array of shape IDs; caller must release each.
function buildExportShapes(items) {
  const out = [];
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    const localId = buildItemShapeLocal(item, items, 0.01);
    if (localId == null) continue;
    const t = buildBrushTransform(item);
    const finalScale = (t.scale != null ? t.scale : 1) * MM_PER_UNIT;
    let scaledId = localId;
    if (Math.abs(finalScale - 1) > 1e-9) {
      scaledId = occ.scaleShape(localId, finalScale);
      occ.releaseShape(localId);
    }
    const worldId = occ.transformShape(
      scaledId,
      t.position.x * MM_PER_UNIT,
      t.position.y * MM_PER_UNIT,
      t.position.z * MM_PER_UNIT,
      t.rotation.x || 0,
      t.rotation.y || 0,
      t.rotation.z || 0,
    );
    if (scaledId !== localId) occ.releaseShape(scaledId);
    else occ.releaseShape(localId);
    if (worldId == null) continue;
    const orientedId = occ.transformShape(worldId, 0, 0, 0, Math.PI / 2, 0, 0);
    occ.releaseShape(worldId);
    if (orientedId != null) out.push(orientedId);
  }
  return out;
}

async function chamferOrFilletItem({
  source,
  subGeo,
  amount,
  angleRad,
  segments,
  allItems,
  printPrecision,
}) {
  const sourceId = buildItemShapeLocal(source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer) is missing or references deleted inputs.",
    );
  }

  const kind = segments === 1 ? "Chamfer" : "Fillet";
  let resultId;
  // Resolve each selected edge's adjacent-face normals on the current source
  // so the selection can be re-matched after a parametric resize moves the
  // endpoint coordinates.  The caller persists resolvedSubGeo on the
  // regenerator; on later regens it already carries normals and enrichSubGeo
  // is a no-op.
  let resolvedSubGeo = subGeo;
  try {
    try {
      resolvedSubGeo = occ.enrichSubGeo(sourceId, subGeo) || subGeo;
    } catch {
      resolvedSubGeo = subGeo;
    }
    resultId =
      segments === 1
        ? occ.chamferShape(sourceId, resolvedSubGeo, amount, angleRad ?? null)
        : occ.filletShape(sourceId, resolvedSubGeo, amount);
  } finally {
    occ.releaseShape(sourceId);
  }

  if (!resultId) {
    const hasEdges = (subGeo?.edges || []).length > 0;
    const hasFaces = (subGeo?.faces || []).length > 0;
    const what =
      hasEdges && hasFaces ? "edge / face" : hasEdges ? "edge" : "face";
    throw new Error(
      `${kind} couldn't find a matching ${what} on the source shape. ` +
        `Try re-selecting the ${what} on the current object.`,
    );
  }

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx;
    centered[i + 1] -= cy;
    centered[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo,
  };
}

// Move the selected faces of an item along their normals by `distance`
// (signed: +pull / -push).  Mirrors chamferOrFilletItem's structure: rebuild
// the source shape, run the native push/pull, tessellate, and centre the
// result on its bbox so the rendered mesh stays origin-centred.
async function pushPullFaces({
  source,
  subGeo,
  distance,
  allItems,
  printPrecision,
}) {
  const sourceId = buildItemShapeLocal(source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer / push-pull) is missing or references deleted inputs.",
    );
  }

  let resultId;
  try {
    resultId = occ.pushPullFaces(sourceId, subGeo, distance);
  } finally {
    occ.releaseShape(sourceId);
  }

  if (!resultId) {
    throw new Error(
      "Push/pull couldn't find a matching face on the source shape. " +
        "Try re-selecting the face on the current object.",
    );
  }

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx;
    centered[i + 1] -= cy;
    centered[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo: subGeo,
  };
}

// Revolve a sketch profile around an axis line.  Mirrors pushPullFaces: build
// the profile from the source's live polygon + the axis from its live sketch
// line, revolve, tessellate, and bbox-centre.  prismSides >= 3 yields a faceted
// "prism" sweep instead of a smooth surface of revolution.
async function revolveItem({
  source,
  axis,
  angleRad,
  prismSides,
  allItems,
  printPrecision,
}) {
  const args = revolveArgs(source, axis, allItems, printPrecision);
  if (!args) {
    throw new Error(
      "Revolve needs a closed profile loop and an axis line on the same sketch.",
    );
  }
  const resultId = occ.makeRevolve(
    args.outerFlat,
    args.holesFlat,
    args.cx,
    args.cy,
    args.ax.x1,
    args.ax.y1,
    args.ax.x2,
    args.ax.y2,
    angleRad ?? 2 * Math.PI,
    prismSides ?? 0,
  );
  if (!resultId) throw new Error("Revolve produced no geometry.");

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx;
    centered[i + 1] -= cy;
    centered[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo: { axis },
  };
}

// Pipe sweep: build the profile (live, sketch A) + world path polyline (live,
// sketch B), sweep, tessellate, and bbox-centre.  Built in WORLD, so the bbox
// centre is both the centerOffset and the item position (rotation identity).
async function pipeItem({ profileSource, pathRef, allItems, printPrecision }) {
  const args = pipeArgs(profileSource, pathRef, allItems, printPrecision);
  if (!args) {
    throw new Error(
      "Pipe needs a closed profile loop and a path line on another sketch.",
    );
  }
  const resultId = occ.makePipe(
    args.outerFlat,
    args.holesFlat,
    args.cx,
    args.cy,
    args.pathFlat,
  );
  if (!resultId) throw new Error("Pipe produced no geometry.");

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx;
    centered[i + 1] -= cy;
    centered[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: { pathRef },
  };
}

// Loft a smooth solid between two profile loops (live, on parallel sketch
// planes), tessellate, and bbox-centre.  Built in WORLD like pipe, so the bbox
// centre is both the centerOffset and the item position (rotation identity).
async function loftItem({
  profileSource,
  secondProfileSource,
  allItems,
  printPrecision,
}) {
  const args = loftArgs(
    profileSource,
    secondProfileSource,
    allItems,
    printPrecision,
  );
  if (!args) throw new Error("Loft needs two closed profile loops.");
  const resultId = occ.makeLoft(args.aFlat, args.bFlat);
  if (!resultId) throw new Error("Loft produced no geometry.");

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx;
    centered[i + 1] -= cy;
    centered[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: {},
  };
}

async function performCsg({
  selectedItems,
  allItems,
  operation,
  printPrecision,
}) {
  const sources = allItems || selectedItems;
  const shapeIds = [];
  const worldAnchors = [];

  for (const item of selectedItems) {
    const localId = buildItemShapeLocal(item, sources, printPrecision);
    if (localId == null) continue;
    const t = buildBrushTransform(item);
    let scaledId = localId;
    if (Math.abs(t.scale - 1) > 1e-9) {
      scaledId = occ.scaleShape(localId, t.scale);
      occ.releaseShape(localId);
    }
    const worldId = occ.transformShape(
      scaledId,
      t.position.x,
      t.position.y,
      t.position.z,
      t.rotation.x || 0,
      t.rotation.y || 0,
      t.rotation.z || 0,
    );
    if (scaledId !== localId) occ.releaseShape(scaledId);
    else occ.releaseShape(localId);
    shapeIds.push(worldId);
    worldAnchors.push(t.position);
  }

  if (shapeIds.length === 0) return null;

  let resultId;
  if (shapeIds.length === 1) {
    // A boolean with a single remaining input is just that input — e.g. a
    // multi-area union after all but one region was removed.  Without this the
    // op returns nothing and the item keeps its stale (larger) geometry.
    resultId = shapeIds[0];
  } else {
    try {
      resultId = occ.booleanOp(shapeIds, operation);
    } finally {
      shapeIds.forEach((id) => occ.releaseShape(id));
    }
  }
  if (!resultId) return null;

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const positions = Array.from(tess.positions);
  let ax, ay, az;
  if (worldAnchors.length > 0) {
    ax = worldAnchors[0].x;
    ay = worldAnchors[0].y;
    az = worldAnchors[0].z;
  } else {
    const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
    ax = (minX + maxX) / 2;
    ay = (minY + maxY) / 2;
    az = (minZ + maxZ) / 2;
  }
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= ax;
    positions[i + 1] -= ay;
    positions[i + 2] -= az;
  }
  return {
    position: { x: ax, y: ay, z: az },
    geometryData: {
      positions,
      normals: null,
      indices: Array.from(tess.indices),
    },
  };
}

async function exportSTL({ items }) {
  const shapeIds = buildExportShapes(items);
  if (shapeIds.length === 0) return null;

  const tessellations = [];
  let triCount = 0;
  for (const id of shapeIds) {
    const tess = occ.tessellate(id, 0.01);
    occ.releaseShape(id);
    if (!tess) continue;
    const n = tess.indices.length / 3;
    tessellations.push({ pos: tess.positions, idx: tess.indices, n });
    triCount += n;
  }
  if (triCount === 0) return null;

  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triCount, true);
  let offset = 84;

  for (const { pos, idx, n } of tessellations) {
    for (let t = 0; t < n; t++) {
      const a = idx[t * 3],
        b = idx[t * 3 + 1],
        c = idx[t * 3 + 2];
      const ax = pos[a * 3],
        ay = pos[a * 3 + 1],
        az = pos[a * 3 + 2];
      const bx = pos[b * 3],
        by = pos[b * 3 + 1],
        bz = pos[b * 3 + 2];
      const cx = pos[c * 3],
        cy = pos[c * 3 + 1],
        cz = pos[c * 3 + 2];
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);
      view.setFloat32(offset + 12, ax, true);
      view.setFloat32(offset + 16, ay, true);
      view.setFloat32(offset + 20, az, true);
      view.setFloat32(offset + 24, bx, true);
      view.setFloat32(offset + 28, by, true);
      view.setFloat32(offset + 32, bz, true);
      view.setFloat32(offset + 36, cx, true);
      view.setFloat32(offset + 40, cy, true);
      view.setFloat32(offset + 44, cz, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }
  return buf;
}

async function exportSTEP({ items }) {
  const shapeIds = buildExportShapes(items);
  if (shapeIds.length === 0) return null;
  try {
    return occ.exportSTEP(shapeIds);
  } finally {
    shapeIds.forEach((id) => occ.releaseShape(id));
  }
}

export const ops = {
  chamferOrFilletItem,
  pushPullFaces,
  revolveItem,
  pipeItem,
  loftItem,
  performCsg,
  exportSTL,
  exportSTEP,
};
