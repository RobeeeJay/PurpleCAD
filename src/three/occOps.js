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
import { polyCentroid, polyAreaCentroid } from "./sceneObjects.js";
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

// ── Cached-solid op helpers (JIT timeline) ─────────────────────────────────
// A source-based op (chamfer/emboss/shell/hole/draft/push-pull/…) can take the
// previous entry's CACHED solid instead of rebuilding the frozen `source`.
// resolveSourceSolid returns the input id and whether WE own it (built it, so
// we must release it); a cached id is owned by its entry and left alive.
function resolveSourceSolid(sourceShapeId, source, allItems, precision) {
  const owns = sourceShapeId == null;
  const id = owns
    ? buildItemShapeLocal(source, allItems, precision)
    : sourceShapeId;
  return { id, owns };
}

// Tessellate + bbox-centre an op's result solid, releasing it unless the caller
// wants to cache it (retainResult).  `extra` merges op-specific return fields
// (e.g. resolvedSubGeo, stamp).  Returns null when tessellation fails.
function finishSolidResult(resultId, precision, retainResult, extra) {
  let tess;
  try {
    tess = occ.tessellate(resultId, precision ?? 0.5);
  } finally {
    if (!retainResult) occ.releaseShape(resultId);
  }
  if (!tess) {
    if (retainResult) occ.releaseShape(resultId);
    return null;
  }
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
  // Cache the SOLID in the same bbox-centred frame buildItemShapeLocal rebuilds
  // it in (it re-centres by regenerator.centerOffset === this offset).  Without
  // this the retained shape is the op's uncentred result, so a downstream op
  // consuming it would be SHIFTED by (cx,cy,cz) versus the recipe path — a
  // centred profile hides it (offset ~0), an off-centre one does not.
  const shapeId = retainResult
    ? occ.transformShape(resultId, -cx, -cy, -cz, 0, 0, 0)
    : null;
  if (retainResult) occ.releaseShape(resultId);
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    ...(retainResult ? { shapeId } : null),
    ...extra,
  };
}

// Resolve a revolve axis ({ sketchId, shapeIdx }) to its live endpoints in the
// PROFILE sketch's local 3D frame, so the axis line can live in a different
// sketch (its world position is mapped into the profile's frame; a z component
// appears only if the two sketches aren't coplanar).  Returns null if gone.
function resolveAxisLocal(axis, allItems, profile) {
  if (!axis) return null;
  const aSketch = (allItems || []).find(
    (i) => i.id === axis.sketchId && i.type === "sketch",
  );
  const line = aSketch?.shapes?.[axis.shapeIdx];
  if (!line || line.type !== "line") return null;
  const aR = aSketch.rotation || { x: 0, y: 0, z: 0 };
  const aP = aSketch.position || { x: 0, y: 0, z: 0 };
  const toWorld = (x, y) => {
    const w = applyEulerXYZ(x, y, 0, aR.x || 0, aR.y || 0, aR.z || 0);
    return { x: w.x + (aP.x || 0), y: w.y + (aP.y || 0), z: w.z + (aP.z || 0) };
  };
  const pR = profile?.rotation || { x: 0, y: 0, z: 0 };
  const pP = profile?.position || { x: 0, y: 0, z: 0 };
  const toLocal = (W) =>
    applyInverseEulerXYZ(
      W.x - (pP.x || 0),
      W.y - (pP.y || 0),
      W.z - (pP.z || 0),
      pR.x || 0,
      pR.y || 0,
      pR.z || 0,
    );
  const l1 = toLocal(toWorld(line.x1, line.y1));
  const l2 = toLocal(toWorld(line.x2, line.y2));
  return { x1: l1.x, y1: l1.y, z1: l1.z, x2: l2.x, y2: l2.y, z2: l2.z };
}

// Build the makeRevolve arguments from a revolve recipe's source profile (live
// polygon) + axis.  Returns null when the profile/axis can't be resolved.
function revolveArgs(source, axis, allItems, precision) {
  const live = extrudeWithLivePolygon(source, allItems, precision);
  const poly = live.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const ax = resolveAxisLocal(axis, allItems, live.profile);
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

// Inverse (transpose) of the XYZ-Euler rotation applyEulerXYZ applies — maps a
// world vector back into a sketch's local frame.
function applyInverseEulerXYZ(vx, vy, vz, rx, ry, rz) {
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
    x: c * e * vx + (af + be * d) * vy + (bf - ae * d) * vz,
    y: -c * f * vx + (ae - bf * d) * vy + (be + af * d) * vz,
    z: d * vx + -b * c * vy + a * c * vz,
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

// How many segments to sample a cubic into for a given tessellation precision
// (sagitta in mm).  Treats the control-polygon length as a circle circumference
// and reuses the same sagitta→segments math as curved-surface tessellation, so
// a finer print resolution subdivides the swept path too (not just its surface).
// precision == null (preview) keeps the historical fixed count.
function bezierSegments(p0, p1, p2, p3, precision) {
  if (precision == null) return 24;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const len = d(p0, p1) + d(p1, p2) + d(p2, p3);
  if (len <= 0) return 24;
  const r = len / (2 * Math.PI);
  const sUnits = precision / MM_PER_UNIT;
  const halfTheta = Math.acos(Math.max(-1, Math.min(1, 1 - sUnits / r)));
  if (!isFinite(halfTheta) || halfTheta <= 0) return 24;
  return Math.max(8, Math.min(256, Math.ceil(Math.PI / halfTheta)));
}

// A path-eligible shape as { a, b, sample(reverse) } — its endpoints plus an
// ordered point list (a→b, or reversed) used to thread it into the polyline.
function pathSegment(shape, i, precision) {
  if (shape?.type === "line") {
    const a = { x: shape.x1, y: shape.y1 };
    const b = { x: shape.x2, y: shape.y2 };
    return { i, a, b, sample: (rev) => (rev ? [b, a] : [a, b]) };
  }
  if (shape?.type === "bezier") {
    const a = { x: shape.p0.x, y: shape.p0.y };
    const b = { x: shape.p3.x, y: shape.p3.y };
    const n = bezierSegments(shape.p0, shape.p1, shape.p2, shape.p3, precision);
    const pts = sampleCubic(shape.p0, shape.p1, shape.p2, shape.p3, n);
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
export function orderPathPoints(sketch, startShapeIdx, precision) {
  const shapes = sketch?.shapes || [];
  const segs = [];
  shapes.forEach((s, i) => {
    const seg = pathSegment(s, i, precision);
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
function pipePathWorld(pathRef, allItems, precision) {
  const sketch = (allItems || []).find(
    (i) => i.id === pathRef?.sketchId && i.type === "sketch",
  );
  if (!sketch) return null;
  const pts2d = orderPathPoints(sketch, pathRef.shapeIdx, precision);
  if (!pts2d || pts2d.length < 2) return null;
  return pts2d.map((p) => sketchPointToWorld(sketch, p.x, p.y));
}

// Build makePipe args: 2D profile (live from sketch A) + the path's world
// polyline (live from sketch B).  Returns null if either can't be resolved.
function pipeArgs(profileSource, pathRef, allItems, precision) {
  const live = extrudeWithLivePolygon(profileSource, allItems, precision);
  const poly = live.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const pathWorld = pipePathWorld(pathRef, allItems, precision);
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

// Apply an item's local-frame scale to a freshly built shape, BEFORE it is
// rotated/translated into world space (matching the mesh's T·R·S order).  A
// uniform scale uses the analytic scaleShape; a per-axis stretch needs the
// affine scaleShapeXYZ.  Returns the scaled shape id (a NEW shape when it
// scales, with the input released) or `localId` unchanged when scale ≈ 1.
function scaleLocal(localId, scale) {
  const sx = scale?.x ?? 1;
  const sy = scale?.y ?? 1;
  const sz = scale?.z ?? 1;
  const uniform = Math.abs(sx - sy) < 1e-9 && Math.abs(sy - sz) < 1e-9;
  if (uniform) {
    if (Math.abs(sx - 1) < 1e-9) return localId;
    const id = occ.scaleShape(localId, sx);
    occ.releaseShape(localId);
    return id;
  }
  const id = occ.scaleShapeXYZ(localId, sx, sy, sz);
  occ.releaseShape(localId);
  return id;
}

// Build the native OCC shape for an item in its LOCAL frame (matching the
// frame of the rendered geometryData so edge endpoints from the viewport
// mesh align with the OCC shape's edges).
//
// Returns a shape ID (integer >= 1) on success, or null on failure.
// Caller MUST release the returned ID via occ.releaseShape().
export function buildItemShapeLocal(item, allItems = [], precision = null) {
  if (item.type === "cube") {
    const d = item.dimensions || {};
    const w = (d.width || 2) / 2,
      h = (d.height || 2) / 2,
      dp = (d.depth || 2) / 2;
    return occ.makeBox(-w, -h, -dp, w, h, dp);
  }
  if (item.type === "sphere") {
    const d = item.dimensions || {};
    return occ.makeSphere(d.radius ?? 1.5);
  }
  if (item.type === "cylinder") {
    const d = item.dimensions || {};
    const radius = d.radius ?? 1,
      height = d.height ?? 2;
    return occ.makeCylinder(-height / 2, radius, height);
  }
  if (item.type === "torus") {
    const d = item.dimensions || {};
    return occ.makeTorus(d.major ?? 1, d.minor ?? 0.4);
  }
  if (item.type === "cone") {
    const d = item.dimensions || {};
    const rb = d.radiusBottom ?? 1,
      rt = d.radiusTop ?? 0,
      height = d.height ?? 2;
    return occ.makeCone(-height / 2, rb, rt, height);
  }

  if (item.type === "extrude") {
    const live = extrudeWithLivePolygon(item, allItems, precision);
    const poly = live.profile?.polygon2D;
    if (!poly || poly.length < 3) return null;
    const holes = live.profile?.holes || [];
    const depth = resolveItemDepth(live);
    // Area centroid (density-invariant) so the prism's pivot — and thus the
    // brush position it cancels against in buildBrushTransform — doesn't drift
    // when the profile's curves re-tessellate at a different resolution.
    const c = polyAreaCentroid(poly);
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

  // An imported solid is a csg item carrying only its mesh (no recipe).  Sew a
  // solid from that mesh so it can take part in booleans/chamfers.
  if (item.type === "csg" && !item.regenerator && item.geometryData) {
    const g = item.geometryData;
    if (!g.positions || g.positions.length < 9) return null;
    const positions = new Float64Array(g.positions);
    const indices =
      g.indices && g.indices.length ? new Uint32Array(g.indices) : null;
    return occ.makeSolidFromMesh(positions, indices);
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

    if (r.kind === "shell") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        resultId = occ.makeShell(sourceId, r.thickness ?? 0);
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

    if (r.kind === "draft") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        const angleRad =
          (((r.angleDeg || 0) * Math.PI) / 180) * (r.flip ? -1 : 1);
        resultId = occ.draftFaces(
          sourceId,
          r.neutral,
          { faces: r.faces || [] },
          angleRad,
        );
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

    if (r.kind === "hole") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        resultId = buildHoleShape(sourceId, r.hole);
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

    if (r.kind === "emboss") {
      const sourceId = buildItemShapeLocal(r.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId = 0;
      try {
        resultId = embossResultShape(sourceId, r.stamp);
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
        args.ax.z1,
        args.ax.x2,
        args.ax.y2,
        args.ax.z2,
        r.angleRad ?? 2 * Math.PI,
        r.prismSides ?? 0,
        r.offsetPerRotation ?? 0,
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
        r.twistTurns ?? 0,
        !!r.autoRotate,
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
          const scaledId = scaleLocal(localId, t.scale);
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

    if (r.kind === "extrudeUnion") {
      // A multi-area extrude fused into one body: build each embedded prism
      // recipe (and any host solid) in world space, then union them.
      const buildWorld = (inp) => {
        const localId = buildItemShapeLocal(inp, allItems, precision);
        if (localId == null) return null;
        const t = buildBrushTransform(inp);
        const scaledId = scaleLocal(localId, t.scale);
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
      };
      const ids = [
        ...(r.extrudeDefs || []),
        ...(r.inputIds || [])
          .map((id) => allItems.find((i) => i.id === id))
          .filter(Boolean),
      ]
        .map(buildWorld)
        .filter((id) => id != null);
      if (ids.length === 0) return null;
      let worldId;
      if (ids.length === 1) worldId = ids[0];
      else {
        try {
          worldId = occ.booleanOp(ids, "union");
        } finally {
          ids.forEach((id) => occ.releaseShape(id));
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
// `items` = the objects to export; `allItems` = the whole scene, so a csg
// recipe (boolean / chamfer source) still resolves its inputs when only a
// selected subset is exported.
// The LOCAL-frame solid to export for one item.  Prefer the item's BAKED mesh —
// the exact high-res geometry already on screen at the active precision — by
// sewing it into a solid (cap-free: export only tessellates / writes it, never
// booleans it, so the boolean-safety caps + coplanar unify don't apply and the
// triangles stay verbatim).  Rebuilding the recipe instead re-runs the whole OCC
// chain (slow) and for an emboss/csg can diverge from the baked result.  Fall
// back to the recipe only when there's no baked mesh (primitives / extrudes,
// which are analytic + cheap) or the sew fails.
function exportLocalSolid(item, allItems, precision) {
  const gd = item.geometryData;
  if (gd?.positions?.length >= 9) {
    try {
      const id = occ.makeSolidFromMesh(
        new Float64Array(gd.positions),
        gd.indices?.length ? new Uint32Array(gd.indices) : null,
        true, // skipCaps — exported mesh, not booleaned
        true, // fastSew — cutting off + no unify (near-instant)
      );
      if (id != null) return id;
    } catch {
      // fall through to the recipe rebuild
    }
  }
  return buildItemShapeLocal(item, allItems, precision);
}

function buildExportShapes(items, allItems = items, precision = 0.01) {
  const out = [];
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    const localId = exportLocalSolid(item, allItems, precision);
    if (localId == null) continue;
    const t = buildBrushTransform(item);
    // Per-axis scale, then the world unit conversion (mm) folded onto every
    // axis, so a stretched body exports at its visible proportions.
    const scaledId = scaleLocal(localId, {
      x: t.scale.x * MM_PER_UNIT,
      y: t.scale.y * MM_PER_UNIT,
      z: t.scale.z * MM_PER_UNIT,
    });
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
  sourceShapeId,
  retainResult,
  subGeo,
  amount,
  angleRad,
  segments,
  allItems,
  printPrecision,
}) {
  // JIT-timeline model: the caller can hand us the previous entry's CACHED
  // solid (sourceShapeId) so we chamfer that directly instead of rebuilding the
  // frozen `source` recipe.  We only own (and release) the source id when we
  // built it ourselves; a cached id stays alive for its owning entry.
  const ownsSource = sourceShapeId == null;
  const sourceId = ownsSource
    ? buildItemShapeLocal(source, allItems, printPrecision)
    : sourceShapeId;
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
    if (ownsSource) occ.releaseShape(sourceId);
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
    // Keep the result solid alive when the caller wants to cache it (chain the
    // next op off this entry's solid); otherwise release it after tessellation.
    if (!retainResult) occ.releaseShape(resultId);
  }
  if (!tess) {
    if (retainResult) occ.releaseShape(resultId);
    return null;
  }

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
  // Re-centre the cached solid to match buildItemShapeLocal (see finishSolidResult).
  const shapeId = retainResult
    ? occ.transformShape(resultId, -cx, -cy, -cz, 0, 0, 0)
    : null;
  if (retainResult) occ.releaseShape(resultId);
  return {
    geometryData: {
      positions: centered,
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo,
    ...(retainResult ? { shapeId } : null),
  };
}

// Move the selected faces of an item along their normals by `distance`
// (signed: +pull / -push).  Mirrors chamferOrFilletItem's structure: rebuild
// the source shape, run the native push/pull, tessellate, and centre the
// result on its bbox so the rendered mesh stays origin-centred.
async function pushPullFaces({
  source,
  sourceShapeId,
  retainResult,
  subGeo,
  distance,
  allItems,
  printPrecision,
}) {
  const { id: sourceId, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer / push-pull) is missing or references deleted inputs.",
    );
  }

  let resultId;
  try {
    resultId = occ.pushPullFaces(sourceId, subGeo, distance);
  } finally {
    if (owns) occ.releaseShape(sourceId);
  }

  if (!resultId) {
    throw new Error(
      "Push/pull couldn't find a matching face on the source shape. " +
        "Try re-selecting the face on the current object.",
    );
  }

  return finishSolidResult(resultId, printPrecision, retainResult, {
    resolvedSubGeo: subGeo,
  });
}

// Hollow a solid into a shell of `thickness` (scene units).  Mirrors
// pushPullFaces: rebuild the source, run the native shell, tessellate, and
// bbox-centre the result so the rendered mesh stays origin-centred.
async function shellItem({
  source,
  sourceShapeId,
  retainResult,
  thickness,
  allItems,
  printPrecision,
}) {
  const { id: sourceId, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs.",
    );
  }

  let resultId;
  try {
    resultId = occ.makeShell(sourceId, thickness);
  } finally {
    if (owns) occ.releaseShape(sourceId);
  }

  if (!resultId) {
    throw new Error(
      "Shell failed — the wall thickness is too large for this body. Try a smaller value.",
    );
  }

  return finishSolidResult(resultId, printPrecision, retainResult);
}

// Apply a draft (taper) to selected faces about the neutral (main) face's plane.
// Mirrors shellItem: rebuild source, draft, tessellate, bbox-centre.
async function draftItem({
  source,
  sourceShapeId,
  retainResult,
  neutral,
  faces,
  angleDeg,
  flip,
  allItems,
  printPrecision,
}) {
  const { id: sourceId, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs.",
    );
  }
  let resultId;
  try {
    const angleRad = (((angleDeg || 0) * Math.PI) / 180) * (flip ? -1 : 1);
    resultId = occ.draftFaces(
      sourceId,
      neutral,
      { faces: faces || [] },
      angleRad,
    );
  } finally {
    if (owns) occ.releaseShape(sourceId);
  }
  if (!resultId) {
    throw new Error(
      "Draft failed — try a smaller angle, or faces that share an edge with the main face.",
    );
  }
  return finishSolidResult(resultId, printPrecision, retainResult);
}

// Cut a hole into `partId`: a bore cylinder plus, for a threaded hole, a real
// ISO thread groove (cut as a SECOND tool — far more robust than fusing the
// helix).  `h` carries point/dir in the part's local frame and sizes in mm.
// Returns a new shape id (caller releases) or null; does not release `partId`.
export function buildHoleShape(partId, h) {
  const p = h.point,
    d = h.dir;
  const length = h.length / MM_PER_UNIT;
  const diameter = h.diameter / MM_PER_UNIT;
  const pitch = (h.pitch || 0) / MM_PER_UNIT;
  const tol = (h.tolerance || 0) / MM_PER_UNIT;
  const useThread = !!h.threaded && pitch > 1e-6;
  // Bore to the thread's MINOR (crest) diameter so the bore wall sits flush with
  // the crests and the groove valleys stay visible.  The crest radius includes
  // the tolerance the groove is grown by (native: majR = D/2 + tol, minR = majR
  // - 0.5413·pitch), so the +2·tol matches it; the 1.0825 (vs 2·0.5413) leaves
  // the bore a hair larger than the crest, which both avoids a coincident-face
  // boolean and keeps no smooth wall standing in front of the thread.  Omitting
  // the +2·tol (the old formula) bored SMALLER than the crest, hiding it.
  const boreDia = useThread
    ? Math.max(1e-4, diameter - 1.0825 * pitch + 2 * tol)
    : diameter;

  // Start the BORE outside the face (back up along the normal by `length`) and
  // extend it, so it always breaks through the surface into an open hole even
  // when the picked entry lands a little below it.  Depth into the part stays
  // `length` (the bore still ends at point + length·dir).
  const m = length;
  const sx = p.x - d.x * m,
    sy = p.y - d.y * m,
    sz = p.z - d.z * m;

  const bore = occ.makeHole(
    sx,
    sy,
    sz,
    d.x,
    d.y,
    d.z,
    length + m,
    boreDia,
    tol,
  );
  if (!bore) return null;
  let cut = occ.booleanOp([partId, bore], "difference");
  occ.releaseShape(bore);
  if (!cut) return null;

  if (useThread) {
    // The groove sweep has a one-pitch lead-in turn at each end.  Offset the
    // thread one pitch INTO the part so that lead-in lands on the entry face
    // instead of spiralling across it around the opening, and shorten it to end
    // at the bore bottom.  Skip the offset for holes too short to fit it.
    let tx = p.x,
      ty = p.y,
      tz = p.z,
      tLen = length;
    if (length > 2 * pitch) {
      tx = p.x + d.x * pitch;
      ty = p.y + d.y * pitch;
      tz = p.z + d.z * pitch;
      tLen = length - 2 * pitch;
    }
    const groove = occ.makeThread(
      tx,
      ty,
      tz,
      d.x,
      d.y,
      d.z,
      tLen,
      diameter,
      pitch,
      tol,
    );
    if (groove) {
      const threadedCut = occ.booleanOp([cut, groove], "difference");
      occ.releaseShape(groove);
      if (threadedCut) {
        occ.releaseShape(cut);
        cut = threadedCut;
      }
    }
  }
  return cut;
}

// Drill a hole into the source body.  Mirrors shellItem: rebuild the source, cut
// the hole, tessellate, and bbox-centre.
// Build the emboss/deboss "stamp" tool from a baked recipe (flat 2D loops +
// placement transform, computed renderer-side in embossGeometry.js so this stays
// THREE-free for the Electron bridge).  Returns a shape id (caller releases) or 0.
export function buildEmbossStampShape(stamp) {
  if (!stamp) return 0;
  // Conform: a pre-wrapped watertight mesh, sewn into a solid.
  if (stamp.mode === "conform") {
    const m = stamp.mesh;
    if (!m || !m.positions || m.positions.length < 9) return 0;
    const positions = new Float64Array(m.positions);
    const indices =
      m.indices && m.indices.length ? new Uint32Array(m.indices) : null;
    // The wrapped-text stamp is a flat-prism mesh bent over the wall: its shared
    // vertices already encode the per-letter shells, but the bend makes triangles
    // near-touch, so cutting-ON sewing chokes (hangs) trying to resolve the
    // intersections.  fastSew=true sews cutting-OFF (fast) and SKIPS unify — the
    // un-cut shell is exactly what we want here (unify was what mangled it into a
    // "single line").  skipCaps: it's dense + must be booleaned.
    return occ.makeSolidFromMesh(positions, indices, true, true) || 0;
  }
  if (!stamp.loops || stamp.loops.length === 0) return 0;
  const { placement: pl, depth } = stamp;
  let stampId = 0;
  for (const lp of stamp.loops) {
    if (!lp.outer || lp.outer.length < 6) continue;
    const outer = new Float64Array(lp.outer);
    const holes = (lp.holes || [])
      .filter((h) => h && h.length >= 6)
      .map((h) => new Float64Array(h));
    const prism = occ.makeExtrude(outer, holes, 0, 0, depth);
    if (!prism) continue;
    if (!stampId) {
      stampId = prism;
    } else {
      const u = occ.booleanOp([stampId, prism], "union");
      occ.releaseShape(prism);
      if (u) {
        occ.releaseShape(stampId);
        stampId = u;
      }
    }
  }
  if (!stampId) return 0;
  const placed = occ.transformShape(
    stampId,
    pl.tx,
    pl.ty,
    pl.tz,
    pl.rx,
    pl.ry,
    pl.rz,
  );
  occ.releaseShape(stampId);
  return placed;
}

// Run the emboss against a body shape id and return a new result id (caller
// releases) or 0; does NOT release `targetId`.  Conform booleans the wrapped
// mesh directly.  Center INTERSECTS a deep profile prism with the body to get
// the projected footprint — which exists ONLY where the geometry touches a face,
// clipping anything that would float — then raises (emboss) / removes a top layer
// (deboss) of it by `distance` along the face normal.
function embossResultShape(targetId, stamp, printPrecision) {
  if (!stamp) return 0;
  if (stamp.mode === "conform") {
    const s = buildEmbossStampShape(stamp);
    if (!s) return 0;
    // Boolean the wrapped mesh against a FACETED copy of the body, not the
    // analytic primitive: OCC's fuse/cut of an analytic sphere vs a faceted stamp
    // is fragile and silently drops the sphere for some stamp orientations (text
    // rotated 90°/270°).  A faceted-vs-faceted boolean is robust.  Fall back to
    // the analytic body if the re-mesh can't be sewn (e.g. too many faces).
    let body = targetId;
    let faceted = 0;
    const t = occ.tessellate(targetId, printPrecision ?? 0.1);
    if (t && t.positions && t.indices) {
      try {
        // skipCaps: a fine-tessellated curved body exceeds the import face cap at
        // print resolution; it's booleaned here, so keep cutting + unify.
        faceted = occ.makeSolidFromMesh(
          new Float64Array(t.positions),
          new Uint32Array(t.indices),
          true,
          false,
        );
      } catch {
        faceted = 0;
      }
      if (faceted) body = faceted;
    }
    const r = occ.booleanOp([body, s], stamp.deboss ? "difference" : "union");
    if (faceted) occ.releaseShape(faceted);
    occ.releaseShape(s);
    return r || 0;
  }
  const tool = buildEmbossStampShape(stamp);
  if (!tool) return 0;
  const imprint = occ.booleanOp([tool, targetId], "intersection");
  occ.releaseShape(tool);
  if (!imprint) return 0;
  const n = stamp.normal || { nx: 0, ny: 1, nz: 0 };
  const d = stamp.distance || 0;
  let result = 0;
  if (stamp.deboss) {
    const lowered = occ.transformShape(
      imprint,
      -d * n.nx,
      -d * n.ny,
      -d * n.nz,
      0,
      0,
      0,
    );
    const cutter = lowered
      ? occ.booleanOp([imprint, lowered], "difference")
      : 0;
    if (lowered) occ.releaseShape(lowered);
    occ.releaseShape(imprint);
    if (!cutter) return 0;
    result = occ.booleanOp([targetId, cutter], "difference");
    occ.releaseShape(cutter);
  } else {
    const raised = occ.transformShape(
      imprint,
      d * n.nx,
      d * n.ny,
      d * n.nz,
      0,
      0,
      0,
    );
    occ.releaseShape(imprint);
    if (!raised) return 0;
    result = occ.booleanOp([targetId, raised], "union");
    occ.releaseShape(raised);
  }
  return result || 0;
}

async function embossItem({
  source,
  sourceShapeId,
  retainResult,
  stamp,
  allItems,
  printPrecision,
}) {
  const { id: targetId, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (targetId == null) {
    throw new Error(
      "Could not rebuild the body to emboss onto — its recipe is missing or references deleted inputs.",
    );
  }

  let resultId = 0;
  try {
    resultId = embossResultShape(targetId, stamp, printPrecision);
  } finally {
    if (owns) occ.releaseShape(targetId);
  }
  if (!resultId) {
    throw new Error(
      "Emboss failed — the geometry didn't reach the face. Check the distance, scale and offset.",
    );
  }

  let tess;
  try {
    tess = occ.tessellate(resultId, printPrecision ?? 0.5);
  } finally {
    if (!retainResult) occ.releaseShape(resultId);
  }
  if (!tess) {
    if (retainResult) occ.releaseShape(resultId);
    return null;
  }

  // Keep the result in the SOURCE's local frame (no bbox-centring): the relief
  // can stand far off the body, and a bbox centre that shifts with offset/scale
  // would drag the whole object as you tweak the offset.  Anchoring to the body
  // (centerOffset 0 → position = the source's brush transform) keeps it put.
  return {
    geometryData: {
      positions: Array.from(tess.positions),
      normals: null,
      indices: Array.from(tess.indices),
    },
    centerOffset: { cx: 0, cy: 0, cz: 0 },
    ...(retainResult ? { shapeId: resultId } : null),
  };
}

async function holeItem({
  source,
  sourceShapeId,
  retainResult,
  hole,
  allItems,
  printPrecision,
}) {
  const { id: sourceId, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs.",
    );
  }

  let resultId;
  try {
    resultId = buildHoleShape(sourceId, hole);
  } finally {
    if (owns) occ.releaseShape(sourceId);
  }
  if (!resultId) {
    throw new Error(
      "Hole failed — the cut produced nothing. Check the diameter/length and that the point is on the body.",
    );
  }

  return finishSolidResult(resultId, printPrecision, retainResult);
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
  offsetPerRotation,
  allItems,
  printPrecision,
}) {
  const args = revolveArgs(source, axis, allItems, printPrecision);
  if (!args) {
    throw new Error("Revolve needs a closed profile loop and an axis line.");
  }
  const resultId = occ.makeRevolve(
    args.outerFlat,
    args.holesFlat,
    args.cx,
    args.cy,
    args.ax.x1,
    args.ax.y1,
    args.ax.z1,
    args.ax.x2,
    args.ax.y2,
    args.ax.z2,
    angleRad ?? 2 * Math.PI,
    prismSides ?? 0,
    offsetPerRotation ?? 0,
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
async function pipeItem({
  profileSource,
  pathRef,
  twistTurns,
  autoRotate,
  allItems,
  printPrecision,
}) {
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
    twistTurns ?? 0,
    !!autoRotate,
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

// Local OCC shape for one boolean input.  A transformed csg body must
// contribute the EXACT geometry the user sees.  Re-deriving a recipe csg from
// buildItemShapeLocal diverges from its baked geometryData under a NON-UNIFORM
// gizmo scale (the per-axis scale then hits a differently-built shape, so the
// cut result comes out the wrong size).  In that case sew the baked mesh — the
// display truth — and let scaleLocal + transform reproduce it exactly.  Uniform
// scales are origin-independent, so they keep the robust analytic rebuild.
function booleanInputLocal(item, sources, precision) {
  const s = item.scale || {};
  const sx = s.x ?? 1;
  const sy = s.y ?? 1;
  const sz = s.z ?? 1;
  const nonUniform = Math.abs(sx - sy) > 1e-9 || Math.abs(sy - sz) > 1e-9;
  if (item.type === "csg" && item.geometryData && nonUniform) {
    const g = item.geometryData;
    if (g.positions && g.positions.length >= 9) {
      const positions = new Float64Array(g.positions);
      const indices =
        g.indices && g.indices.length ? new Uint32Array(g.indices) : null;
      return occ.makeSolidFromMesh(positions, indices);
    }
  }
  return buildItemShapeLocal(item, sources, precision);
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
    const localId = booleanInputLocal(item, sources, printPrecision);
    if (localId == null) continue;
    const t = buildBrushTransform(item);
    const scaledId = scaleLocal(localId, t.scale);
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

// Slice a solid into two parts along a plane (origin = plane.position, normal =
// the plane's local +Z rotated by plane.rotation).  Builds the target's world
// solid, intersects it with a large half-space box on the +normal side (partA)
// and cuts that box away (partB).  Returns { partA, partB } (either may be null
// when the plane misses that side), each bbox-centred like a CSG result.
async function splitItem({ target, plane, allItems, printPrecision }) {
  const localId = buildItemShapeLocal(target, allItems, printPrecision);
  if (localId == null) throw new Error("Couldn't build the object to split.");
  const t = buildBrushTransform(target);
  const scaledId = scaleLocal(localId, t.scale);
  const solidId = occ.transformShape(
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
  if (!solidId) throw new Error("Couldn't build the object to split.");

  // A large box whose -Z face lies on the plane and which extends along +normal.
  const S = 1000;
  const boxLocal = occ.makeBox(-S, -S, 0, S, S, 2 * S);
  const box = occ.transformShape(
    boxLocal,
    plane.position.x,
    plane.position.y,
    plane.position.z,
    plane.rotation.x || 0,
    plane.rotation.y || 0,
    plane.rotation.z || 0,
  );
  occ.releaseShape(boxLocal);

  let aId, bId;
  try {
    aId = occ.booleanOp([solidId, box], "intersection");
    bId = occ.booleanOp([solidId, box], "difference");
  } finally {
    occ.releaseShape(solidId);
    occ.releaseShape(box);
  }

  const part = (id) => {
    if (!id) return null;
    let tess;
    try {
      tess = occ.tessellate(id, printPrecision ?? 0.5);
    } finally {
      occ.releaseShape(id);
    }
    if (!tess || tess.positions.length === 0) return null;
    const positions = Array.from(tess.positions);
    const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      cz = (minZ + maxZ) / 2;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= cx;
      positions[i + 1] -= cy;
      positions[i + 2] -= cz;
    }
    return {
      position: { x: cx, y: cy, z: cz },
      geometryData: {
        positions,
        normals: null,
        indices: Array.from(tess.indices),
      },
    };
  };

  const partA = part(aId);
  const partB = part(bId);
  if (!partA && !partB)
    throw new Error("Split produced no geometry — does the plane cross it?");
  return { partA, partB };
}

// Build an item's world-space OCC solid (local shape × its brush transform).
function buildWorldSolid(item, allItems, precision) {
  const localId = buildItemShapeLocal(item, allItems, precision);
  if (localId == null) return null;
  const t = buildBrushTransform(item);
  const id = scaleLocal(localId, t.scale);
  const w = occ.transformShape(
    id,
    t.position.x,
    t.position.y,
    t.position.z,
    t.rotation.x || 0,
    t.rotation.y || 0,
    t.rotation.z || 0,
  );
  if (id !== localId) occ.releaseShape(id);
  else occ.releaseShape(localId);
  return w;
}

// Tessellate + concatenate several shapes into one bbox-centred geometryData,
// releasing each id.  Returns null when nothing tessellated.
function combineTessellations(ids, precision) {
  const positions = [];
  const indices = [];
  for (const id of ids) {
    if (!id) continue;
    let tess;
    try {
      tess = occ.tessellate(id, precision ?? 0.5);
    } finally {
      occ.releaseShape(id);
    }
    if (!tess || tess.positions.length === 0) continue;
    const base = positions.length / 3;
    for (let i = 0; i < tess.positions.length; i++)
      positions.push(tess.positions[i]);
    for (let i = 0; i < tess.indices.length; i++)
      indices.push(tess.indices[i] + base);
  }
  if (positions.length === 0) return null;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }
  return {
    geometryData: { positions, normals: null, indices },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
  };
}

// The clone shapes for a 3D pattern (copies only — not the original), each a
// new transform of the source's world solid.
function patternInstances(worldId, patternType, params) {
  const out = [];
  if (patternType === "mirror") {
    const o = params.origin,
      n = params.normal;
    out.push(occ.mirrorShape(worldId, o.x, o.y, o.z, n.x, n.y, n.z));
  } else if (patternType === "circular") {
    const count = Math.max(2, Math.round(params.count || 2));
    const total = params.angleRad ?? 2 * Math.PI;
    const o = params.origin,
      a = params.axis;
    // Helical pitch: axial slide along the (unit) axis per full 360°, so each
    // copy moves in proportion to how far it has rotated.
    const pitch = params.axialOffset || 0;
    for (let k = 1; k < count; k++) {
      const ang = (total * k) / count;
      const rotId = occ.rotateShapeAxis(
        worldId,
        o.x,
        o.y,
        o.z,
        a.x,
        a.y,
        a.z,
        ang,
      );
      if (pitch) {
        const d = (pitch * ang) / (2 * Math.PI);
        const moved = occ.transformShape(
          rotId,
          a.x * d,
          a.y * d,
          a.z * d,
          0,
          0,
          0,
        );
        occ.releaseShape(rotId);
        out.push(moved);
      } else {
        out.push(rotId);
      }
    }
  } else if (patternType === "rectangular") {
    const cx = Math.max(1, Math.round(params.countX || 1));
    const cy = Math.max(1, Math.round(params.countY || 1));
    const cz = Math.max(1, Math.round(params.countZ || 1));
    for (let i = 0; i < cx; i++)
      for (let j = 0; j < cy; j++)
        for (let k = 0; k < cz; k++) {
          if (i === 0 && j === 0 && k === 0) continue;
          out.push(
            occ.transformShape(
              worldId,
              i * (params.dx || 0),
              j * (params.dy || 0),
              k * (params.dz || 0),
              0,
              0,
              0,
            ),
          );
        }
  }
  return out;
}

// ── Mesh-based pattern instancing ───────────────────────────────────────────
// Fallback used when a pattern source can't be rebuilt as an OCC solid (an
// imported dense mesh, or a sweep whose recipe won't re-resolve): replicate the
// source's already-baked tessellation with rigid transforms instead.  Matches
// patternInstances exactly — the result is the CLONES only (the source's own
// copy is excluded), bbox-centred like combineTessellations.

const v3normalize = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

// Reflect a point across the plane (o, unit n).
const reflectPoint = (x, y, z, o, n) => {
  const d = (x - o.x) * n.x + (y - o.y) * n.y + (z - o.z) * n.z;
  return { x: x - 2 * d * n.x, y: y - 2 * d * n.y, z: z - 2 * d * n.z };
};

// Rotate a point about the axis (o, unit a) by `ang` (Rodrigues' rotation).
const rotateAboutAxis = (x, y, z, o, a, ang) => {
  const px = x - o.x,
    py = y - o.y,
    pz = z - o.z;
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const dot = a.x * px + a.y * py + a.z * pz;
  const cx = a.y * pz - a.z * py,
    cy = a.z * px - a.x * pz,
    cz = a.x * py - a.y * px;
  return {
    x: px * c + cx * s + a.x * dot * (1 - c) + o.x,
    y: py * c + cy * s + a.y * dot * (1 - c) + o.y,
    z: pz * c + cz * s + a.z * dot * (1 - c) + o.z,
  };
};

// The per-clone transforms ({ fn, flip }) for a pattern, mirroring
// patternInstances' clone set (original excluded; mirror flips winding).
function patternCloneTransforms(patternType, params) {
  const out = [];
  if (patternType === "mirror") {
    const o = params.origin,
      n = v3normalize(params.normal);
    out.push({ fn: (x, y, z) => reflectPoint(x, y, z, o, n), flip: true });
  } else if (patternType === "circular") {
    const count = Math.max(2, Math.round(params.count || 2));
    const total = params.angleRad ?? 2 * Math.PI;
    const o = params.origin,
      a = v3normalize(params.axis);
    // Helical pitch: axial distance per full 360°.
    const pitch = params.axialOffset || 0;
    for (let k = 1; k < count; k++) {
      const ang = (total * k) / count;
      const d = (pitch * ang) / (2 * Math.PI);
      out.push({
        fn: (x, y, z) => {
          const r = rotateAboutAxis(x, y, z, o, a, ang);
          return { x: r.x + a.x * d, y: r.y + a.y * d, z: r.z + a.z * d };
        },
      });
    }
  } else if (patternType === "rectangular") {
    const cx = Math.max(1, Math.round(params.countX || 1));
    const cy = Math.max(1, Math.round(params.countY || 1));
    const cz = Math.max(1, Math.round(params.countZ || 1));
    for (let i = 0; i < cx; i++)
      for (let j = 0; j < cy; j++)
        for (let k = 0; k < cz; k++) {
          if (i === 0 && j === 0 && k === 0) continue;
          const tx = i * (params.dx || 0),
            ty = j * (params.dy || 0),
            tz = k * (params.dz || 0);
          out.push({ fn: (x, y, z) => ({ x: x + tx, y: y + ty, z: z + tz }) });
        }
  }
  return out;
}

function patternMeshInstances(source, patternType, params) {
  const g = source.geometryData;
  if (!g || !g.positions || g.positions.length < 9) return null;
  // Source mesh into WORLD space (baked local geometryData → item TRS).
  const s = (source.scale && source.scale.x) || 1;
  const rot = source.rotation || { x: 0, y: 0, z: 0 };
  const pos = source.position || { x: 0, y: 0, z: 0 };
  const lp = g.positions;
  const world = new Float64Array(lp.length);
  for (let i = 0; i < lp.length; i += 3) {
    const w = applyEulerXYZ(
      lp[i] * s,
      lp[i + 1] * s,
      lp[i + 2] * s,
      rot.x || 0,
      rot.y || 0,
      rot.z || 0,
    );
    world[i] = w.x + (pos.x || 0);
    world[i + 1] = w.y + (pos.y || 0);
    world[i + 2] = w.z + (pos.z || 0);
  }
  const vertCount = lp.length / 3;
  const srcIdx =
    g.indices && g.indices.length
      ? g.indices
      : Array.from({ length: vertCount }, (_, i) => i);

  const transforms = patternCloneTransforms(patternType, params);
  const positions = [];
  const indices = [];
  for (const { fn, flip } of transforms) {
    const base = positions.length / 3;
    for (let i = 0; i < world.length; i += 3) {
      const t = fn(world[i], world[i + 1], world[i + 2]);
      positions.push(t.x, t.y, t.z);
    }
    for (let t = 0; t < srcIdx.length; t += 3) {
      const a = srcIdx[t] + base,
        b = srcIdx[t + 1] + base,
        c = srcIdx[t + 2] + base;
      if (flip) indices.push(a, c, b);
      else indices.push(a, b, c);
    }
  }
  if (positions.length === 0) return null;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }
  return {
    geometryData: { positions, normals: null, indices },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
  };
}

// Build a 3D pattern's clone geometry (mirror / circular / rectangular) from the
// live source object, so it tracks the source through regen.
async function pattern3dItem({
  patternType,
  sourceId,
  params,
  allItems,
  printPrecision,
}) {
  const source = (allItems || []).find((i) => i.id === sourceId);
  if (!source) throw new Error("Pattern source object not found.");

  // Any source carrying a baked mesh (every csg / sweep / imported result) is
  // patterned by replicating that mesh.  Rebuilding it as an OCC solid is not
  // just slower — for a boolean over a dense / imported / swept mesh the OCC
  // boolean rebuild can hard-crash the kernel, so we must NOT attempt it here.
  // Primitives and extrudes carry no baked mesh and take the OCC path below.
  const g = source.geometryData;
  if (g && g.positions && g.positions.length >= 9) {
    const meshResult = patternMeshInstances(source, patternType, params);
    if (!meshResult) throw new Error("Pattern produced no geometry.");
    return meshResult;
  }

  const worldId = buildWorldSolid(source, allItems, printPrecision);
  if (!worldId) throw new Error("Couldn't build the pattern source.");
  let ids;
  try {
    ids = patternInstances(worldId, patternType, params);
  } finally {
    occ.releaseShape(worldId);
  }
  const result = combineTessellations(ids, printPrecision);
  if (!result) throw new Error("Pattern produced no geometry.");
  return result;
}

// World-space tessellation of an item's BAKED mesh for STL: the baked mesh is
// already a watertight OCC tessellation, so transform its triangles to world
// (per-axis scale × mm, item rotation, position × mm, then +π/2 about X for the
// Z-up export convention) and write them VERBATIM.  Sewing the mesh into a solid
// and re-tessellating (as the STEP path must, to get a B-rep) round-trips through
// OCC and can OPEN the seams — the STL would then show open edges.  Matches the
// transform buildExportShapes applies.
function bakedWorldTessellation(item) {
  const gd = item.geometryData;
  const bt = buildBrushTransform(item);
  const sx = (bt.scale.x ?? 1) * MM_PER_UNIT;
  const sy = (bt.scale.y ?? 1) * MM_PER_UNIT;
  const sz = (bt.scale.z ?? 1) * MM_PER_UNIT;
  const rot = bt.rotation || { x: 0, y: 0, z: 0 };
  const px = (bt.position.x || 0) * MM_PER_UNIT;
  const py = (bt.position.y || 0) * MM_PER_UNIT;
  const pz = (bt.position.z || 0) * MM_PER_UNIT;
  const src = gd.positions;
  const pos = new Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const r = applyEulerXYZ(
      src[i] * sx,
      src[i + 1] * sy,
      src[i + 2] * sz,
      rot.x || 0,
      rot.y || 0,
      rot.z || 0,
    );
    const o = applyEulerXYZ(r.x + px, r.y + py, r.z + pz, Math.PI / 2, 0, 0);
    pos[i] = o.x;
    pos[i + 1] = o.y;
    pos[i + 2] = o.z;
  }
  const idx = gd.indices?.length
    ? gd.indices
    : Array.from({ length: src.length / 3 }, (_, k) => k);
  return { pos, idx, n: idx.length / 3 };
}

async function exportSTL({ items, allItems, precision }) {
  const all = allItems || items;
  const tessellations = [];
  let triCount = 0;
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    let entry;
    if (item.geometryData?.positions?.length >= 9) {
      // Write the exact on-screen watertight mesh (no sew / re-tessellate).
      entry = bakedWorldTessellation(item);
    } else {
      // Primitive / extrude: no baked mesh — build the analytic solid + tessellate.
      const ids = buildExportShapes([item], all, precision ?? 0.01);
      if (ids.length === 0) continue;
      const t = occ.tessellate(ids[0], 0.01);
      occ.releaseShape(ids[0]);
      if (!t) continue;
      entry = { pos: t.positions, idx: t.indices, n: t.indices.length / 3 };
    }
    tessellations.push(entry);
    triCount += entry.n;
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

async function exportSTEP({ items, allItems, precision }) {
  const shapeIds = buildExportShapes(
    items,
    allItems || items,
    precision ?? 0.01,
  );
  if (shapeIds.length === 0) return null;
  try {
    return occ.exportSTEP(shapeIds);
  } finally {
    shapeIds.forEach((id) => occ.releaseShape(id));
  }
}

// Read a STEP file's content into a tessellated mesh (raw mm / Z-up positions —
// the renderer converts to scene units / Y-up and centres it).
async function importStep({ stepText, printPrecision }) {
  const id = occ.importSTEP(stepText);
  if (!id) throw new Error("STEP import produced no shape.");
  let tess;
  try {
    tess = occ.tessellate(id, printPrecision ?? 0.5);
  } finally {
    occ.releaseShape(id);
  }
  if (!tess) throw new Error("STEP import produced no geometry.");
  return {
    positions: Array.from(tess.positions),
    indices: Array.from(tess.indices),
  };
}

// Tessellate an item's rebuilt solid in its LOCAL frame — the Texture tool's
// base mesh when the source has no baked geometryData (primitives, extrudes).
// Thin by design: resolveSourceSolid + tessellate + release.
function tessellateItem({ source, sourceShapeId, allItems, printPrecision }) {
  const { id, owns } = resolveSourceSolid(
    sourceShapeId,
    source,
    allItems,
    printPrecision,
  );
  if (id == null) return null;
  try {
    const tess = occ.tessellate(id, printPrecision ?? 0.5);
    return tess ? { geometryData: tess } : null;
  } finally {
    if (owns) occ.releaseShape(id);
  }
}

// Sew a baked mesh into a retained OCC solid (JIT timeline cache).  Lets a
// downstream op build on an upstream step's ALREADY-BUILT result (its display
// mesh, the truth) instead of re-running the upstream recipe — which can fail to
// re-select geometry (e.g. a rim chamfer on a re-tessellated ring).  Returns
// { shapeId } of the retained solid, or null.
function solidFromMesh({ positions, indices }) {
  if (!positions || positions.length < 9) return null;
  const pos = new Float64Array(positions);
  const idx = indices && indices.length ? new Uint32Array(indices) : null;
  // skipCaps: this is a step's own baked mesh — a clean OCC tessellation, not
  // an imported file, so the tri/face rejection caps guarding imports would
  // wrongly reject a dense curved result (an emboss relief).  Full sew stays
  // ON (cutting + unify): the solid feeds downstream booleans/chamfers.
  const id = occ.makeSolidFromMesh(pos, idx, /*skipCaps*/ true, false);
  return id ? { shapeId: id } : null;
}

// Release a cached OCC solid held in the native shape store (JIT timeline
// cache).  Fire-and-forget cleanup; a missing/already-released id is a no-op.
function releaseShape({ id }) {
  if (id != null) {
    try {
      occ.releaseShape(id);
    } catch {
      /* already gone */
    }
  }
  return null;
}

export const ops = {
  chamferOrFilletItem,
  pushPullFaces,
  shellItem,
  holeItem,
  embossItem,
  draftItem,
  revolveItem,
  pipeItem,
  loftItem,
  performCsg,
  splitItem,
  pattern3dItem,
  exportSTL,
  exportSTEP,
  importStep,
  releaseShape,
  solidFromMesh,
  tessellateItem,
};
