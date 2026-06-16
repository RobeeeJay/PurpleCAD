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

// Slice a solid into two parts along a plane (origin = plane.position, normal =
// the plane's local +Z rotated by plane.rotation).  Builds the target's world
// solid, intersects it with a large half-space box on the +normal side (partA)
// and cuts that box away (partB).  Returns { partA, partB } (either may be null
// when the plane misses that side), each bbox-centred like a CSG result.
async function splitItem({ target, plane, allItems, printPrecision }) {
  const localId = buildItemShapeLocal(target, allItems, printPrecision);
  if (localId == null) throw new Error("Couldn't build the object to split.");
  const t = buildBrushTransform(target);
  let scaledId = localId;
  if (Math.abs(t.scale - 1) > 1e-9) {
    scaledId = occ.scaleShape(localId, t.scale);
    occ.releaseShape(localId);
  }
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
  let id = localId;
  if (Math.abs(t.scale - 1) > 1e-9) {
    id = occ.scaleShape(localId, t.scale);
    occ.releaseShape(localId);
  }
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
    // Per-copy slide along the (unit) axis turns the ring into a helix/spiral.
    const off = params.axialOffset || 0;
    for (let k = 1; k < count; k++) {
      const rotId = occ.rotateShapeAxis(
        worldId,
        o.x,
        o.y,
        o.z,
        a.x,
        a.y,
        a.z,
        (total * k) / count,
      );
      if (off) {
        const d = off * k;
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
    const off = params.axialOffset || 0;
    for (let k = 1; k < count; k++) {
      const ang = (total * k) / count;
      const d = off * k;
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

export const ops = {
  chamferOrFilletItem,
  pushPullFaces,
  revolveItem,
  pipeItem,
  loftItem,
  performCsg,
  splitItem,
  pattern3dItem,
  exportSTL,
  exportSTEP,
  importStep,
};
