// OCC bridge for Electron main process.
// Implements performCsg and chamferOrFilletItem using the native C++ addon
// mirroring the logic of:
//   src/three/csgUtils.js#buildItemShapeLocal
//   src/three/occOps.js#performCsg / chamferOrFilletItem
//
// All shape IDs are short-lived: built for one operation, tessellated,
// then released.  The shape store never accumulates across IPC calls.

const path = require("path");
const occ = require(path.join(__dirname, "../native/occ-addon/build/Release/occ_addon.node"));

// ── Geometry helpers (no THREE.js — main process) ────────────────────────

function polyCentroid(poly) {
  if (!poly || poly.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

// Area (shoelace) centroid — density-invariant, so a re-tessellated curve
// doesn't drift the extrude pivot (see polygonUtil.js polyAreaCentroid).
function polyAreaCentroid(poly) {
  if (!poly || poly.length === 0) return { x: 0, y: 0 };
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) return polyCentroid(poly);
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// Signed area (CCW positive) + winding normalisation, mirroring
// sceneObjects/polygonUtil.js.  The renderer forces outer wires CCW / holes CW
// before building the prism, so its top-cap normal is +Z.  The OCC bridge must
// do the same or a clockwise-traced sketch yields a -Z top normal that no face
// selection on the (correctly-wound) rendered mesh can match.
function signedPolyAreaXY(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function withWinding(poly, wantCcw) {
  if (!poly || poly.length < 3) return poly;
  const isCcw = signedPolyAreaXY(poly) > 0;
  return isCcw === wantCcw ? poly : [...poly].reverse();
}

// A loop's exact curve runs, wound and packed for the addon's BuildCurveWire
// (mirrors polygonUtil.js reverseEdgeCurves / packCurveRuns / windLoopForOcc).
const CURVE_RUN_WIDTH = 11;
const CURVE_KIND = { arc: 1, bezier: 2, ellipse: 3, interp: 4 };
function packCurveRuns(runs) {
  const out = new Float64Array(runs.length * CURVE_RUN_WIDTH);
  runs.forEach((run, i) => {
    const params =
      run.type === "arc" ? [run.cx, run.cy, run.r]
        : run.type === "ellipse" ? [run.cx, run.cy, run.rx, run.ry]
          : run.type === "bezier" ? [run.p0, run.p1, run.p2, run.p3].flatMap(p => [p.x, p.y])
            : [];
    out.set([run.start, run.count, CURVE_KIND[run.type], ...params], i * CURVE_RUN_WIDTH);
  });
  return out;
}
function windLoop(poly, runs, wantCcw) {
  const n = poly.length;
  const flip = signedPolyAreaXY(poly) > 0 !== wantCcw;
  return {
    pts: flip ? [...poly].reverse() : poly,
    // Reversed, old edge k becomes edge n-2-k.
    runs: runs && flip
      ? runs.map(r => ({ ...r, start: (((n - 1 - r.start - r.count) % n) + n) % n }))
      : runs,
  };
}
function windLoopForOcc(poly, runs, wantCcw) {
  const wound = windLoop(poly, runs, wantCcw);
  return {
    flat: new Float64Array(wound.pts.flatMap(p => [p.x, p.y])),
    curves: wound.runs ? packCurveRuns(wound.runs) : null,
  };
}
// World-space packing for BuildWorldCurveWire (mirrors polygonUtil.js).
const WORLD_RUN_WIDTH = 15;
function packWorldCurveRuns(runs, toWorld) {
  const kept = runs || [];
  const w3 = (p) => { const w = toWorld(p); return [w.x, w.y, w.z]; };
  const out = new Float64Array(kept.length * WORLD_RUN_WIDTH);
  kept.forEach((run, i) => {
    let poles = [];
    if (run.type === "bezier") poles = [run.p0, run.p1, run.p2, run.p3].flatMap(w3);
    else if (run.type === "ellipse") {
      // Centre, world axis directions and radii: three points don't fix one.
      const c = w3({ x: run.cx, y: run.cy });
      const ax = w3({ x: run.cx + 1, y: run.cy }).map((v, k) => v - c[k]);
      const ay = w3({ x: run.cx, y: run.cy + 1 }).map((v, k) => v - c[k]);
      poles = [...c, ...ax, ...ay, run.rx, run.ry];
    }
    out.set([run.start, run.count, CURVE_KIND[run.type], ...poles], i * WORLD_RUN_WIDTH);
  });
  return out;
}

// Resolve a revolve axis ({ sketchId, shapeIdx }) to its live 2D endpoints by
// reading the referenced line from the current sketch (mirrors occOps.js).
// Resolve a revolve axis to endpoints in the PROFILE sketch's local 3D frame
// (mirrors occOps.js#resolveAxisLocal) so the axis may live in a different
// sketch.  Returns null if the line is gone.
function resolveAxisLocal(axis, allItems, profile) {
  if (!axis) return null;
  const aSketch = (allItems || []).find(
    (i) => i.id === axis.sketchId && i.type === "sketch",
  );
  const line = aSketch && aSketch.shapes && aSketch.shapes[axis.shapeIdx];
  if (!line || line.type !== "line") return null;
  const aR = aSketch.rotation || { x: 0, y: 0, z: 0 };
  const aP = aSketch.position || { x: 0, y: 0, z: 0 };
  const toWorld = (x, y) => {
    const w = applyEulerXYZ(x, y, 0, aR.x || 0, aR.y || 0, aR.z || 0);
    return { x: w.x + (aP.x || 0), y: w.y + (aP.y || 0), z: w.z + (aP.z || 0) };
  };
  const pR = (profile && profile.rotation) || { x: 0, y: 0, z: 0 };
  const pP = (profile && profile.position) || { x: 0, y: 0, z: 0 };
  const toLocal = (W) =>
    applyInverseEulerXYZ(
      W.x - (pP.x || 0), W.y - (pP.y || 0), W.z - (pP.z || 0),
      pR.x || 0, pR.y || 0, pR.z || 0,
    );
  const l1 = toLocal(toWorld(line.x1, line.y1));
  const l2 = toLocal(toWorld(line.x2, line.y2));
  return { x1: l1.x, y1: l1.y, z1: l1.z, x2: l2.x, y2: l2.y, z2: l2.z };
}

// Build makeRevolve args from a revolve recipe.  The renderer pre-bakes the
// live polygon into source.profile.polygon2D before IPC (like chamfer), so this
// reads it directly; the axis is resolved from the live sketch in allItems.
function revolveArgs(source, axis, allItems) {
  const poly = source && source.profile && source.profile.polygon2D;
  if (!poly || poly.length < 3) return null;
  const ax = resolveAxisLocal(axis, allItems, source.profile);
  if (!ax) return null;
  const holes = (source.profile.holes || []).filter((h) => h && h.length >= 3);
  const c = polyCentroid(poly);
  return { ...profileLoopsForOcc(source.profile, poly, holes), cx: c.x, cy: c.y, ax };
}

// A profile's loops wound and flattened for the addon, with their exact
// curves when the profile was made with them (mirrors occOps.js).
function profileLoopsForOcc(profile, poly, holes) {
  const curves = profile.curves2D;
  const outer = windLoopForOcc(poly, curves?.outer, true);
  const holeLoops = holes.map((h, i) => windLoopForOcc(h, curves?.holes?.[i], false));
  return {
    outerFlat: outer.flat,
    holesFlat: holeLoops.map(h => h.flat),
    outerCurves: outer.curves,
    holeCurves: holeLoops.map(h => h.curves),
  };
}

// XYZ Euler rotation of a 3D vector, matching THREE.js applyEuler('XYZ').
function applyEulerXYZ(vx, vy, vz, rx, ry, rz) {
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ae = a*e, af = a*f, be = b*e, bf = b*f;
  return {
    x:  c*e*vx  + (-c*f)*vy  + d*vz,
    y: (af+be*d)*vx + (ae-bf*d)*vy + (-b*c)*vz,
    z: (bf-ae*d)*vx + (be+af*d)*vy + (a*c)*vz,
  };
}

// Inverse (transpose) of applyEulerXYZ — world vector back into a local frame.
function applyInverseEulerXYZ(vx, vy, vz, rx, ry, rz) {
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ae = a*e, af = a*f, be = b*e, bf = b*f;
  return {
    x: c*e*vx + (af+be*d)*vy + (bf-ae*d)*vz,
    y: (-c*f)*vx + (ae-bf*d)*vy + (be+af*d)*vz,
    z: d*vx + (-b*c)*vy + (a*c)*vz,
  };
}

// ── Pipe sweep helpers (mirror occOps.js) ────────────────────────────────

function sketchPointToWorld(sketch, x, y) {
  const r = sketch.rotation || { x: 0, y: 0, z: 0 };
  const p = sketch.position || { x: 0, y: 0, z: 0 };
  const w = applyEulerXYZ(x, y, 0, r.x || 0, r.y || 0, r.z || 0);
  return { x: w.x + (p.x || 0), y: w.y + (p.y || 0), z: w.z + (p.z || 0) };
}

function sampleCubic(p0, p1, p2, p3, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push({
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    });
  }
  return out;
}

// Mirror of occOps.js#bezierSegments: subdivide a swept path's beziers finer at
// finer tessellation precision, so print resolution refines the pipe's length.
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


// Segments for a path arc of radius r sweeping `angle`, by the same sagitta
// rule as bezierSegments (mirrors occOps.js); preview (precision null) keeps 24 a half turn.
function arcPathSegments(r, angle, precision) {
  if (precision == null || !(r > 0))
    return Math.max(4, Math.ceil((24 * angle) / Math.PI));
  const sUnits = precision / MM_PER_UNIT;
  const halfTheta = Math.acos(Math.max(-1, Math.min(1, 1 - sUnits / r)));
  if (!isFinite(halfTheta) || halfTheta <= 0) return 24;
  return Math.max(4, Math.min(512, Math.ceil(angle / (2 * halfTheta))));
}

// Points round a circle arc from angle a0 through `sweep`, n segments.
function arcPathPoints(cx, cy, r, a0, sweep, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

function pathSegment(shape, i, precision) {
  if (shape && (shape.type === "arc" || shape.type === "circle")) {
    const closed = shape.type === "circle";
    const a0 = closed ? 0 : shape.startAngle;
    let sweep = closed ? 2 * Math.PI : shape.endAngle - shape.startAngle;
    if (!closed && sweep <= 0) sweep += 2 * Math.PI;
    const n = arcPathSegments(shape.r, sweep, precision);
    const pts = arcPathPoints(shape.cx, shape.cy, shape.r, a0, sweep, n);
    if (closed) pts[n] = pts[0];
    return { i, shape, closed, a: pts[0], b: pts[n], sample: (rev) => (rev ? pts.slice().reverse() : pts.slice()) };
  }
  if (shape && shape.type === "line") {
    const a = { x: shape.x1, y: shape.y1 };
    const b = { x: shape.x2, y: shape.y2 };
    return { i, shape, a, b, sample: (rev) => (rev ? [b, a] : [a, b]) };
  }
  if (shape && shape.type === "bezier") {
    const a = { x: shape.p0.x, y: shape.p0.y };
    const b = { x: shape.p3.x, y: shape.p3.y };
    const n = bezierSegments(shape.p0, shape.p1, shape.p2, shape.p3, precision);
    const pts = sampleCubic(shape.p0, shape.p1, shape.p2, shape.p3, n);
    return { i, shape, a, b, sample: (rev) => (rev ? pts.slice().reverse() : pts.slice()) };
  }
  return null;
}

// The ordered path and its curve runs: a bezier piece's edges lie on it
// (mirrors occOps.js orderPath).
function orderPath(sketch, startShapeIdx, precision) {
  const shapes = (sketch && sketch.shapes) || [];
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
  const pieces = [{ shape: startSeg.shape, edges: pts.length - 1 }];
  if (startSeg.closed) return { pts, runs: [{ type: "arc", start: 0, count: pts.length - 1 }] };
  const extend = (atEnd) => {
    let changed = true;
    while (changed) {
      changed = false;
      const tip = atEnd ? pts[pts.length - 1] : pts[0];
      for (const seg of segs) {
        if (used.has(seg.i) || seg.closed) continue;
        const segPts = near(seg.a, tip)
          ? seg.sample(false)
          : near(seg.b, tip)
            ? seg.sample(true)
            : null;
        if (segPts) {
          used.add(seg.i);
          const piece = { shape: seg.shape, edges: segPts.length - 1 };
          if (atEnd) { pts = pts.concat(segPts.slice(1)); pieces.push(piece); }
          else { pts = segPts.slice(1).reverse().concat(pts); pieces.unshift(piece); }
          changed = true;
          break;
        }
      }
    }
  };
  extend(true);
  extend(false);
  const runs = [];
  let start = 0;
  for (const { shape, edges } of pieces) {
    if (shape.type === "bezier") {
      const { p0, p1, p2, p3 } = shape;
      runs.push({ start, count: edges, type: "bezier", p0, p1, p2, p3 });
    } else if (shape.type === "arc") {
      runs.push({ start, count: edges, type: "arc" });
    }
    start += edges;
  }
  return { pts, runs };
}

function pipePathWorld(pathRef, allItems, precision) {
  const sketch = (allItems || []).find(
    (i) => i.id === (pathRef && pathRef.sketchId) && i.type === "sketch",
  );
  if (!sketch) return null;
  const path = orderPath(sketch, pathRef.shapeIdx, precision);
  if (!path || path.pts.length < 2) return null;
  const toWorld = (p) => sketchPointToWorld(sketch, p.x, p.y);
  return { pts: path.pts.map(toWorld), curves: packWorldCurveRuns(path.runs, toWorld) };
}

// The renderer pre-bakes the live profile polygon into source.profile.polygon2D
// (like revolve); the path is resolved from the live sketch in allItems.
function pipeArgs(profileSource, pathRef, allItems, precision) {
  const poly =
    profileSource && profileSource.profile && profileSource.profile.polygon2D;
  if (!poly || poly.length < 3) return null;
  const pathWorld = pipePathWorld(pathRef, allItems, precision);
  if (!pathWorld) return null;
  const holes = (profileSource.profile.holes || []).filter(
    (h) => h && h.length >= 3,
  );
  const c = polyCentroid(poly);
  const pathFlat = new Float64Array(pathWorld.pts.flatMap((p) => [p.x, p.y, p.z]));
  return {
    ...profileLoopsForOcc(profileSource.profile, poly, holes),
    cx: c.x, cy: c.y, pathFlat,
    // The path's curves too, for a sweep made since exact curves.
    pathCurves: profileSource.profile.curves2D ? pathWorld.curves : null,
  };
}

// ── Loft helpers (mirror occOps.js) ──────────────────────────────────────

function polyToWorld(poly, position, rotation) {
  const r = rotation || { x: 0, y: 0, z: 0 };
  const p = position || { x: 0, y: 0, z: 0 };
  return poly.map((pt) => {
    const w = applyEulerXYZ(pt.x, pt.y, 0, r.x || 0, r.y || 0, r.z || 0);
    return { x: w.x + (p.x || 0), y: w.y + (p.y || 0), z: w.z + (p.z || 0) };
  });
}

// The renderer pre-bakes both live profile polygons into profile.polygon2D.
function loftArgs(profileSource, secondSource) {
  const a = loftLoop(profileSource && profileSource.profile);
  const b = loftLoop(secondSource && secondSource.profile);
  if (!a || !b) return null;
  return { aFlat: a.flat, bFlat: b.flat, aCurves: a.curves, bCurves: b.curves };
}

// One loft section, wound CCW on its world plane, with its exact curves when
// it was made with them (mirrors occOps.js loftLoop).
function loftLoop(profile) {
  const poly = profile && profile.polygon2D;
  if (!poly || poly.length < 3) return null;
  const { pts, runs } = windLoop(poly, profile.curves2D?.outer, true);
  const toWorld = (p) => polyToWorld([p], profile.position, profile.rotation)[0];
  return {
    flat: new Float64Array(pts.map(toWorld).flatMap((p) => [p.x, p.y, p.z])),
    curves: runs ? packWorldCurveRuns(runs, toWorld) : null,
  };
}

// Resolve depth from legacy number (scene units) or simple string formula
// (mm / MM_PER_UNIT where MM_PER_UNIT = 10).  Complex variable references
// can't be resolved without the store; fall back to 1 in that case.
function resolveDepth(depth, fallback = 1) {
  if (depth == null || depth === "") return fallback;
  if (typeof depth === "number") return Number.isFinite(depth) ? depth : fallback;
  const n = parseFloat(depth);
  return Number.isFinite(n) ? n / 10 : fallback;
}

// Mirrors csgUtils.js#buildBrushTransform without THREE.js.  Returns the full
// per-axis scale (in the LOCAL geometry frame) so a non-uniformly stretched
// body rebuilds at its visible size.  The extrude centroid offset is UNSCALED —
// the renderer adds it via mesh.position, which mesh.scale never touches.
function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const sc = item.scale || {};
  const s = { x: sc.x ?? 1, y: sc.y ?? 1, z: sc.z ?? 1 };
  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const c = polyAreaCentroid(item.profile.polygon2D);
    const rotated = applyEulerXYZ(c.x, c.y, 0, r.x||0, r.y||0, r.z||0);
    const base = item.position || { x: 0, y: 0, z: 0 };
    return {
      position: { x: base.x + rotated.x, y: base.y + rotated.y, z: base.z + rotated.z },
      rotation: r,
      scale: s,
    };
  }
  return {
    position: item.position || { x: 0, y: 0, z: 0 },
    rotation: r,
    scale: s,
  };
}

// Mirrors occOps.js#scaleLocal — apply an item's local-frame scale to a shape
// before it is rotated/translated.  Uniform → analytic scaleShape; per-axis →
// affine scaleShapeXYZ.  Returns the scaled id (input released) or `localId`.
function scaleLocal(localId, scale) {
  const sx = scale && scale.x != null ? scale.x : 1;
  const sy = scale && scale.y != null ? scale.y : 1;
  const sz = scale && scale.z != null ? scale.z : 1;
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

// Mirrors occOps.js#booleanInputLocal — a transformed csg body must contribute
// the EXACT geometry the user sees.  Under a non-uniform gizmo scale a recipe
// re-derivation can diverge from the baked geometryData, so sew the baked mesh.
function booleanInputLocal(item, allItems, precision) {
  const s = item.scale || {};
  const sx = s.x ?? 1, sy = s.y ?? 1, sz = s.z ?? 1;
  const nonUniform = Math.abs(sx - sy) > 1e-9 || Math.abs(sy - sz) > 1e-9;
  if (item.type === "csg" && item.geometryData && nonUniform) {
    const g = item.geometryData;
    if (g.positions && g.positions.length >= 9) {
      const positions = new Float64Array(g.positions);
      const indices = g.indices && g.indices.length ? new Uint32Array(g.indices) : null;
      return occ.makeSolidFromMesh(positions, indices);
    }
  }
  return buildItemShapeLocal(item, allItems, precision);
}

function bboxOf(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i]   < minX) minX = positions[i];
    if (positions[i]   > maxX) maxX = positions[i];
    if (positions[i+1] < minY) minY = positions[i+1];
    if (positions[i+1] > maxY) maxY = positions[i+1];
    if (positions[i+2] < minZ) minZ = positions[i+2];
    if (positions[i+2] > maxZ) maxZ = positions[i+2];
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// ── Cached-solid op helpers (JIT timeline) — mirror occOps.js ──────────────
// A source-based op can take the previous entry's CACHED solid (sourceShapeId)
// instead of rebuilding the frozen `source`.  We only own/release an id we
// built ourselves; a cached id is owned by its entry and left alive.
function resolveSourceSolid(sourceShapeId, source, allItems, precision) {
  const owns = sourceShapeId == null;
  const id = owns ? buildItemShapeLocal(source, allItems, precision) : sourceShapeId;
  return { id, owns };
}

// Tessellate + bbox-centre an op result, releasing it unless the caller wants
// to cache it (retainResult).  `extra` merges op-specific return fields.
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i+1] -= cy; centered[i+2] -= cz;
  }
  // Re-centre the cached solid to buildItemShapeLocal's frame (mirrors occOps.js).
  const shapeId = retainResult
    ? occ.transformShape(resultId, -cx, -cy, -cz, 0, 0, 0)
    : null;
  if (retainResult) occ.releaseShape(resultId);
  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx, cy, cz },
    ...(retainResult ? { shapeId } : null),
    ...extra,
  };
}

// ── Shape builder ────────────────────────────────────────────────────────

// Mirrors csgUtils.js#buildItemShapeLocal.
// Returns a native shape ID that the caller must release, or null on failure.
function buildItemShapeLocal(item, allItems, precision) {
  if (item.type === "cube") {
    const d = item.dimensions || {};
    const w = (d.width || 2) / 2, h = (d.height || 2) / 2, dp = (d.depth || 2) / 2;
    return occ.makeBox(-w, -h, -dp, w, h, dp);
  }
  if (item.type === "sphere") {
    const d = item.dimensions || {};
    return occ.makeSphere(d.radius ?? 1.5);
  }
  if (item.type === "cylinder") {
    const d = item.dimensions || {};
    const radius = d.radius ?? 1, height = d.height ?? 2;
    return occ.makeCylinder(-height / 2, radius, height);
  }
  if (item.type === "torus") {
    const d = item.dimensions || {};
    return occ.makeTorus(d.major ?? 1, d.minor ?? 0.4);
  }
  if (item.type === "cone") {
    const d = item.dimensions || {};
    const rb = d.radiusBottom ?? 1, rt = d.radiusTop ?? 0, height = d.height ?? 2;
    return occ.makeCone(-height / 2, rb, rt, height);
  }

  if (item.type === "extrude") {
    const poly = item.profile?.polygon2D;
    if (!poly || poly.length < 3) return null;
    const holes = item.profile?.holes || [];
    // Depth is stored on the item (a mm formula string), NOT on the profile —
    // reading item.profile?.depth always fell through to the 1-unit fallback,
    // so the OCC prism was built 10 mm tall regardless of the real depth. That
    // put its top face at the wrong Z, and a chamfer/fillet face selection on
    // the top then matched nothing.  Mirror occOps.js, which uses item.depth.
    const depth = resolveDepth(item.depth);
    // Area centroid (density-invariant) so the prism pivot matches
    // buildBrushTransform and the solid doesn't drift when a curved profile
    // re-tessellates at a different resolution (mirrors occOps.js).
    const c = polyAreaCentroid(poly);
    // Exact curves only for a profile made with them (mirrors occOps.js).
    const curves = item.profile.curves2D;
    const outer = windLoopForOcc(poly, curves?.outer, true);
    const holeLoops = holes
      .filter(h => h && h.length >= 3)
      .map((h, i) => windLoopForOcc(h, curves?.holes?.[i], false));
    const prismId = occ.makeExtrude(
      outer.flat, holeLoops.map(h => h.flat), c.x, c.y, depth,
      outer.curves, holeLoops.map(h => h.curves),
    );
    // startOffset slides the prism base along the extrude normal (local +Z) so
    // the OCC shape matches the rendered mesh (mirrors occOps.js).
    const startOffset = item.startOffset || 0;
    if (prismId != null && startOffset) {
      const shifted = occ.transformShape(prismId, 0, 0, startOffset, 0, 0, 0);
      occ.releaseShape(prismId);
      return shifted;
    }
    return prismId;
  }

  // Imported solid (mesh only, no recipe) — sew a solid for booleans/chamfers.
  // An imported STEP body: its exact shape, already in its local frame.
  if (item.type === "csg" && item.regenerator?.kind === "importedShape")
    return occ.shapeFromBrep(item.regenerator.brep);
  if (item.type === "csg" && !item.regenerator && item.geometryData) {
    const g = item.geometryData;
    if (!g.positions || g.positions.length < 9) return null;
    const positions = new Float64Array(g.positions);
    const indices =
      g.indices && g.indices.length ? new Uint32Array(g.indices) : null;
    return occ.makeSolidFromMesh(positions, indices);
  }

  if (item.type === "csg" && item.regenerator) {
    const regen = item.regenerator;

    // A Split piece is re-cut from its source (mirrors occOps.js): sewn from
    // its mesh, its "flat" faces weren't, and chamfers on it failed.
    if (regen.kind === "split" && regen.center && !regen.regenFailed) {
      try {
        const id = splitPieceLocal(regen, allItems, precision);
        if (id != null) return id;
      } catch {
        // the mesh below
      }
    }
    // A simplified mesh IS its baked mesh -- the op's whole output -- (mirrors
    // occOps.js) so a later op sews that, as does a Split piece that can't be
    // re-cut.
    if (regen.kind === "simplify" || regen.kind === "split") {
      const g = item.geometryData;
      if (!g?.positions || g.positions.length < 9) return null;
      return occ.makeSolidFromMesh(
        new Float64Array(g.positions),
        g.indices?.length ? new Uint32Array(g.indices) : null,
      );
    }

    // A 3D PATTERN rebuilds its copies in OCC when its source can be rebuilt.
    // Sewing the baked mesh instead (the fallback below) produces a shell whose
    // face count is its TRIANGLE count -- a ring of eight spikes came to 8.4k
    // faces and the fuse onto the body had not finished after five minutes.
    // Replicating the source SOLID keeps a handful of faces per copy.
    //
    // patternInstances returns the COPIES only: the object the pattern was made
    // from stays its own item, so the recipe's geometry is the copies alone and
    // the rebuild must match it.
    if (regen.kind === "pattern3d") {
      const src = (allItems || []).find((i) => i.id === regen.sourceId);
      const params =
        regen.patternType === "circular"
          ? {
              origin: regen.axisOrigin,
              axis: regen.axisDir,
              count: regen.count,
              angleRad: regen.angleRad,
              axialOffset: regen.axialOffset,
            }
          : regen;
      const srcWorld = src ? buildWorldSolid(src, allItems, precision) : null;
      if (srcWorld) {
        let ids;
        try {
          ids = patternInstances(srcWorld, regen.patternType, params);
        } finally {
          occ.releaseShape(srcWorld);
        }
        if (ids && ids.length) {
          let worldId;
          if (ids.length === 1) worldId = ids[0];
          else {
            try {
              worldId = occ.booleanOp(ids, "union");
            } finally {
              ids.forEach((id) => occ.releaseShape(id));
            }
          }
          if (worldId) {
            // The stored mesh is centred on the pattern's own centre, so the
            // rebuild has to be shifted the same way. centerOffset is {cx,cy,cz};
            // a position is {x,y,z}.
            const c = regen.centerOffset;
            const ox = c ? (c.cx ?? 0) : (item.position?.x ?? 0);
            const oy = c ? (c.cy ?? 0) : (item.position?.y ?? 0);
            const oz = c ? (c.cz ?? 0) : (item.position?.z ?? 0);
            const localId = occ.transformShape(
              worldId,
              -ox,
              -oy,
              -oz,
              0,
              0,
              0,
            );
            occ.releaseShape(worldId);
            return localId;
          }
        }
      }
      // No rebuildable source (an imported mesh, say): sew the baked mesh
      // instead. That shell's face count is its triangle count, so a dense
      // pattern can exceed the boolean caps and be refused -- which is why the
      // rebuild above is tried first.
      const g = item.geometryData;
      if (g && g.positions && g.positions.length >= 9) {
        const positions = new Float64Array(g.positions);
        const indices =
          g.indices && g.indices.length ? new Uint32Array(g.indices) : null;
        return occ.makeSolidFromMesh(positions, indices);
      }
      return null;
    }

    if (regen.kind === "chamfer") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      const subGeo = regen.subGeo || { edges: [], faces: [] };
      const amount = regen.amount ?? 0.05;
      let resultId;
      try {
        resultId = regen.segments === 1
          ? occ.chamferShape(sourceId, subGeo, amount, regen.angleRad ?? null)
          : occ.filletShape(sourceId, subGeo, amount);
      } finally {
        occ.releaseShape(sourceId);
      }
      // 0 = no edges matched
      if (!resultId) return null;
      // Apply the -centerOffset correction so this shape's local frame
      // matches the rendered geometryData frame (mirrors csgUtils.js).
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "pushpull") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      const subGeo = regen.subGeo || { faces: [] };
      let resultId;
      try {
        resultId = occ.pushPullFaces(sourceId, subGeo, regen.distance ?? 0);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      // Apply the -centerOffset correction so this shape's local frame matches
      // the rendered geometryData frame (mirrors csgUtils.js / occOps.js).
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "shell") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        resultId = occ.makeShell(sourceId, regen.thickness ?? 0);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "draft") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        const angleRad =
          (((regen.angleDeg || 0) * Math.PI) / 180) * (regen.flip ? -1 : 1);
        resultId = occ.draftFaces(
          sourceId,
          regen.neutral,
          { faces: regen.faces || [] },
          angleRad,
        );
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "hole") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId;
      try {
        resultId = buildHoleShape(sourceId, regen.hole);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "emboss") {
      const sourceId = buildItemShapeLocal(regen.source, allItems, precision);
      if (sourceId == null) return null;
      let resultId = 0;
      try {
        resultId = embossResultShape(sourceId, regen.stamp);
      } finally {
        occ.releaseShape(sourceId);
      }
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "revolve") {
      const args = revolveArgs(regen.source, regen.axis, allItems);
      if (!args) return null;
      const resultId = occ.makeRevolve(
        args.outerFlat, args.holesFlat, args.cx, args.cy,
        args.ax.x1, args.ax.y1, args.ax.z1, args.ax.x2, args.ax.y2, args.ax.z2,
        regen.angleRad ?? 2 * Math.PI, regen.prismSides ?? 0,
        regen.offsetPerRotation ?? 0, args.outerCurves, args.holeCurves,
      );
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "pipe") {
      const args = pipeArgs(regen.profileSource, regen.pathRef, allItems, precision);
      if (!args) return null;
      const resultId = occ.makePipe(
        args.outerFlat, args.holesFlat, args.cx, args.cy, args.pathFlat,
        regen.twistTurns ?? 0, !!regen.autoRotate, args.outerCurves, args.holeCurves, args.pathCurves,
      );
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "loft") {
      const args = loftArgs(regen.profileSource, regen.secondProfileSource);
      if (!args) return null;
      const resultId = occ.makeLoft(args.aFlat, args.bFlat, args.aCurves, args.bCurves);
      if (!resultId) return null;
      const off = regen.centerOffset;
      if (off) {
        const corrected = occ.transformShape(resultId, -off.cx, -off.cy, -off.cz, 0, 0, 0);
        occ.releaseShape(resultId);
        return corrected;
      }
      return resultId;
    }

    if (regen.kind === "boolean") {
      const inputShapeIds = (regen.inputIds || [])
        .map(id => allItems.find(i => i.id === id))
        .filter(Boolean)
        .map(inp => {
          const localId = buildItemShapeLocal(inp, allItems, precision);
          if (localId == null) return null;
          const t = buildBrushTransform(inp);
          // Scale BEFORE translate+rotate (mirrors occOps.js#performCsg)
          const scaledId = scaleLocal(localId, t.scale);
          const worldId = occ.transformShape(
            scaledId,
            t.position.x, t.position.y, t.position.z,
            t.rotation.x||0, t.rotation.y||0, t.rotation.z||0
          );
          if (scaledId !== localId) occ.releaseShape(scaledId);
          else occ.releaseShape(localId);
          return worldId;
        })
        .filter(id => id != null);

      if (inputShapeIds.length === 0) return null;

      let worldId;
      if (inputShapeIds.length === 1) {
        // A single remaining input fuses to just that shape (re-localised
        // below); don't release it — it's the result.
        worldId = inputShapeIds[0];
      } else {
        try {
          worldId = occ.booleanOp(inputShapeIds, regen.op || "difference");
        } finally {
          inputShapeIds.forEach(id => occ.releaseShape(id));
        }
      }
      if (!worldId) return null;

      // Translate back into local frame so edge positions from the rendered
      // mesh match the OCC shape (mirrors csgUtils.js#buildItemShapeLocal).
      if (item.position) {
        const localId = occ.transformShape(
          worldId,
          -item.position.x, -item.position.y, -item.position.z,
          0, 0, 0
        );
        occ.releaseShape(worldId);
        return localId;
      }
      return worldId;
    }

    if (regen.kind === "extrudeUnion" || regen.kind === "extrudeCut") {
      // A multi-area extrude fused into (or subtracted from) one body: build
      // each embedded prism recipe and any host solid in world space, then
      // boolean them.  A cut puts the hosts FIRST — booleanOp takes the first
      // shape as the argument and the rest as tools.
      const buildWorld = inp => {
        const localId = buildItemShapeLocal(inp, allItems, precision);
        if (localId == null) return null;
        const t = buildBrushTransform(inp);
        const scaledId = scaleLocal(localId, t.scale);
        const worldId = occ.transformShape(
          scaledId,
          t.position.x, t.position.y, t.position.z,
          t.rotation.x||0, t.rotation.y||0, t.rotation.z||0
        );
        if (scaledId !== localId) occ.releaseShape(scaledId);
        else occ.releaseShape(localId);
        return worldId;
      };
      const isCut = regen.kind === "extrudeCut";
      const prisms = regen.extrudeDefs || [];
      const hosts = (regen.inputIds || []).map(id => allItems.find(i => i.id === id)).filter(Boolean);
      const ids = (isCut ? [...hosts, ...prisms] : [...prisms, ...hosts])
        .map(buildWorld).filter(id => id != null);
      if (ids.length === 0) return null;
      let worldId;
      if (ids.length === 1) worldId = ids[0];
      else {
        try { worldId = occ.booleanOp(ids, isCut ? "difference" : "union"); }
        finally { ids.forEach(id => occ.releaseShape(id)); }
      }
      if (!worldId) return null;
      if (item.position) {
        const localId = occ.transformShape(
          worldId,
          -item.position.x, -item.position.y, -item.position.z,
          0, 0, 0
        );
        occ.releaseShape(worldId);
        return localId;
      }
      return worldId;
    }
  }

  return null;
}

// ── Public ops (mirror occOps.js interface) ──────────────────────────────

function performCsg({ selectedItems, allItems, operation, printPrecision }) {
  const sources = allItems || selectedItems;
  const shapeIds = [];
  const worldAnchors = [];

  for (const item of selectedItems) {
    const localId = booleanInputLocal(item, sources, printPrecision);
    if (localId == null) continue;
    const t = buildBrushTransform(item);

    // Apply scale before rotate+translate (mirrors occOps.js)
    const scaledId = scaleLocal(localId, t.scale);
    const worldId = occ.transformShape(
      scaledId,
      t.position.x, t.position.y, t.position.z,
      t.rotation.x||0, t.rotation.y||0, t.rotation.z||0
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
      shapeIds.forEach(id => occ.releaseShape(id));
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
    ax = worldAnchors[0].x; ay = worldAnchors[0].y; az = worldAnchors[0].z;
  } else {
    const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
    ax = (minX + maxX) / 2; ay = (minY + maxY) / 2; az = (minZ + maxZ) / 2;
  }
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= ax; positions[i+1] -= ay; positions[i+2] -= az;
  }

  return {
    position: { x: ax, y: ay, z: az },
    geometryData: {
      positions,
      normals: null,
      indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null,
    },
  };
}

function chamferOrFilletItem({ source, sourceShapeId, retainResult, subGeo, amount, angleRad, segments, allItems, printPrecision }) {
  // JIT-timeline model (mirrors occOps.js): chamfer a CACHED input solid when
  // one is handed in, and retain the result solid for the next op to chain off.
  const ownsSource = sourceShapeId == null;
  const sourceId = ownsSource ? buildItemShapeLocal(source, allItems, printPrecision) : sourceShapeId;
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer) is missing or references deleted inputs."
    );
  }

  const kind = segments === 1 ? "Chamfer" : "Fillet";
  let resultId;
  // Resolve each selected edge's adjacent-face normals on the current source
  // so the selection survives a parametric resize (see occOps.js).
  let resolvedSubGeo = subGeo;
  try {
    try {
      resolvedSubGeo = occ.enrichSubGeo(sourceId, subGeo) || subGeo;
    } catch {
      resolvedSubGeo = subGeo;
    }
    resultId = segments === 1
      ? occ.chamferShape(sourceId, resolvedSubGeo, amount, angleRad ?? null)
      : occ.filletShape(sourceId, resolvedSubGeo, amount);
  } finally {
    if (ownsSource) occ.releaseShape(sourceId);
  }

  if (!resultId) {
    const hasEdges = (subGeo?.edges || []).length > 0;
    const hasFaces = (subGeo?.faces || []).length > 0;
    const what = hasEdges && hasFaces ? "edge / face" : hasEdges ? "edge" : "face";
    throw new Error(
      `${kind} couldn't find a matching ${what} on the source shape. ` +
      `Try re-selecting the ${what} on the current object.`
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

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i+1] -= cy; centered[i+2] -= cz;
  }
  // Re-centre the cached solid to buildItemShapeLocal's frame (mirrors occOps.js).
  const shapeId = retainResult
    ? occ.transformShape(resultId, -cx, -cy, -cz, 0, 0, 0)
    : null;
  if (retainResult) occ.releaseShape(resultId);

  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo,
    ...(retainResult ? { shapeId } : null),
  };
}

// Mirrors occOps.js#pushPullFaces — move the selected faces along their
// normals by `distance` (signed: +pull / -push), then bbox-centre the result.
function pushPullFaces({ source, sourceShapeId, retainResult, subGeo, distance, allItems, printPrecision }) {
  const { id: sourceId, owns } = resolveSourceSolid(sourceShapeId, source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer / push-pull) is missing or references deleted inputs."
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
      "Try re-selecting the face on the current object."
    );
  }

  return finishSolidResult(resultId, printPrecision, retainResult, { resolvedSubGeo: subGeo });
}

// Mirrors occOps.js#shellItem — hollow the source solid into a shell of
// `thickness` (scene units), then bbox-centre the result.
function shellItem({ source, sourceShapeId, retainResult, thickness, allItems, printPrecision }) {
  const { id: sourceId, owns } = resolveSourceSolid(sourceShapeId, source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs."
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
      "Shell failed — the wall thickness is too large for this body. Try a smaller value."
    );
  }

  return finishSolidResult(resultId, printPrecision, retainResult);
}

// Mirrors occOps.js#draftItem — taper selected faces about the neutral (main)
// face's plane, then bbox-centre.
function draftItem({ source, sourceShapeId, retainResult, neutral, faces, angleDeg, flip, allItems, printPrecision }) {
  const { id: sourceId, owns } = resolveSourceSolid(sourceShapeId, source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs."
    );
  }
  let resultId;
  try {
    const angleRad = (((angleDeg || 0) * Math.PI) / 180) * (flip ? -1 : 1);
    resultId = occ.draftFaces(sourceId, neutral, { faces: faces || [] }, angleRad);
  } finally {
    if (owns) occ.releaseShape(sourceId);
  }
  if (!resultId) {
    throw new Error(
      "Draft failed — try a smaller angle, or faces that share an edge with the main face."
    );
  }
  return finishSolidResult(resultId, printPrecision, retainResult);
}

// Mirrors occOps.js#buildHoleShape — cut a bore (+ optional ISO thread groove)
// into partId.  Returns a new shape id (caller releases) or null.
function buildHoleShape(partId, h) {
  const p = h.point, d = h.dir;
  const length = h.length / MM_PER_UNIT;
  const diameter = h.diameter / MM_PER_UNIT;
  const pitch = (h.pitch || 0) / MM_PER_UNIT;
  const tol = (h.tolerance || 0) / MM_PER_UNIT;
  const useThread = !!h.threaded && pitch > 1e-6;
  // Bore to the thread crest (minor) radius incl. tolerance so the bore wall is
  // flush with the crests and the groove stays visible (see occOps.js).
  const boreDia = useThread
    ? Math.max(1e-4, diameter - 1.0825 * pitch + 2 * tol)
    : diameter;

  // Bore starts outside the face so it always breaks through (see occOps.js).
  const m = length;
  const sx = p.x - d.x * m, sy = p.y - d.y * m, sz = p.z - d.z * m;

  const bore = occ.makeHole(sx, sy, sz, d.x, d.y, d.z, length + m, boreDia, tol);
  if (!bore) return null;
  let cut = occ.booleanOp([partId, bore], "difference");
  occ.releaseShape(bore);
  if (!cut) return null;

  if (useThread) {
    // Offset the thread one pitch into the part so its lead-in turn lands on the
    // entry face, not spiralling across it; size it to end at the bore bottom.
    let tx = p.x, ty = p.y, tz = p.z, tLen = length;
    if (length > 2 * pitch) {
      tx = p.x + d.x * pitch; ty = p.y + d.y * pitch; tz = p.z + d.z * pitch;
      tLen = length - 2 * pitch;
    }
    const groove = occ.makeThread(tx, ty, tz, d.x, d.y, d.z, tLen, diameter, pitch, tol);
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

// Mirrors occOps.js#holeItem — drill a hole into the source body, bbox-centred.
function holeItem({ source, sourceShapeId, retainResult, hole, allItems, printPrecision }) {
  const { id: sourceId, owns } = resolveSourceSolid(sourceShapeId, source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe is missing or references deleted inputs."
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
      "Hole failed — the cut produced nothing. Check the diameter/length and that the point is on the body."
    );
  }
  return finishSolidResult(resultId, printPrecision, retainResult);
}

// Build the emboss/deboss stamp tool from a baked recipe (see occOps.js).
function buildEmbossStampShape(stamp) {
  if (!stamp) return 0;
  if (stamp.mode === "conform") {
    const m = stamp.mesh;
    if (!m || !m.positions || m.positions.length < 9) return 0;
    const positions = new Float64Array(m.positions);
    const indices = m.indices && m.indices.length ? new Uint32Array(m.indices) : null;
    // The wrapped-text stamp is a flat-prism mesh bent over the wall — cutting-ON
    // sewing hangs resolving the near-touching bent triangles.  fastSew=true sews
    // cutting-OFF (fast) + skips unify (unify mangled the un-cut shell into a
    // "single line").  skipCaps: dense + must be booleaned.  Mirrors occOps.js.
    return occ.makeSolidFromMesh(positions, indices, true, true) || 0;
  }
  if (!stamp.loops || stamp.loops.length === 0) return 0;
  const { placement: pl, depth } = stamp;
  let stampId = 0;
  for (const lp of stamp.loops) {
    if (!lp.outer || lp.outer.length < 6) continue;
    const outer = new Float64Array(lp.outer);
    const holes = (lp.holes || []).filter((h) => h && h.length >= 6).map((h) => new Float64Array(h));
    const prism = occ.makeExtrude(outer, holes, 0, 0, depth);
    if (!prism) continue;
    if (!stampId) {
      stampId = prism;
    } else {
      const u = occ.booleanOp([stampId, prism], "union");
      occ.releaseShape(prism);
      if (u) { occ.releaseShape(stampId); stampId = u; }
    }
  }
  if (!stampId) return 0;
  const placed = occ.transformShape(stampId, pl.tx, pl.ty, pl.tz, pl.rx, pl.ry, pl.rz);
  occ.releaseShape(stampId);
  return placed;
}

// See occOps.js embossResultShape: conform booleans the wrapped mesh; center
// intersects a deep prism with the body (clipping to faces) then raises/lowers.
// Whether an emboss result's volume is one these two solids can produce: a
// raised emboss holds at least the body and at most body + stamp; a deboss at
// most the body and at least body - stamp.  (A sliver of tolerance for the
// stamp's sewn surface.)
function embossVolumeHolds(bodyId, stampId, resultId, deboss) {
  const vb = Math.abs(occ.shapeVolume(bodyId));
  const vs = Math.abs(occ.shapeVolume(stampId));
  const vr = occ.shapeVolume(resultId);
  const eps = 1e-3 * vb + 1e-9;
  return deboss
    ? vr <= vb + eps && vr >= vb - vs - eps
    : vr >= vb - eps && vr <= vb + vs + eps;
}

function embossResultShape(targetId, stamp, printPrecision) {
  if (!stamp) return 0;
  if (stamp.mode === "conform") {
    const s = buildEmbossStampShape(stamp);
    if (!s) return 0;
    // First onto the body as it is, so its exact surfaces stay exact: against
    // a faceted copy, an embossed cylinder came back as hundreds of flat faces
    // after every recalculation.  That boolean is the fragile one -- on a
    // sphere it silently DROPPED the body for text turned 90 or 270 degrees --
    // but a dropped body shows as a volume no emboss of these two solids can
    // have, so a result outside that range falls through to the faceted copy
    // below, which booleans robustly.
    const op = stamp.deboss ? "difference" : "union";
    let exact = 0;
    try {
      exact = occ.booleanOp([targetId, s], op);
    } catch {
      exact = 0;
    }
    if (exact && embossVolumeHolds(targetId, s, exact, stamp.deboss)) {
      occ.releaseShape(s);
      return exact;
    }
    if (exact) occ.releaseShape(exact);
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
    const lowered = occ.transformShape(imprint, -d * n.nx, -d * n.ny, -d * n.nz, 0, 0, 0);
    const cutter = lowered ? occ.booleanOp([imprint, lowered], "difference") : 0;
    if (lowered) occ.releaseShape(lowered);
    occ.releaseShape(imprint);
    if (!cutter) return 0;
    result = occ.booleanOp([targetId, cutter], "difference");
    occ.releaseShape(cutter);
  } else {
    const raised = occ.transformShape(imprint, d * n.nx, d * n.ny, d * n.nz, 0, 0, 0);
    occ.releaseShape(imprint);
    if (!raised) return 0;
    result = occ.booleanOp([targetId, raised], "union");
    occ.releaseShape(raised);
  }
  return result || 0;
}

function embossItem({ source, sourceShapeId, retainResult, stamp, allItems, printPrecision }) {
  const { id: targetId, owns } = resolveSourceSolid(sourceShapeId, source, allItems, printPrecision);
  if (targetId == null) {
    throw new Error("Could not rebuild the body to emboss onto.");
  }
  let resultId = 0;
  try {
    resultId = embossResultShape(targetId, stamp, printPrecision);
  } finally {
    if (owns) occ.releaseShape(targetId);
  }
  if (!resultId) {
    throw new Error("Emboss failed — the geometry didn't reach the face. Check distance/scale/offset.");
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
  // No bbox-centring — anchor to the body's frame so the offset doesn't drag the
  // object (see occOps.js embossItem).
  return {
    geometryData: { positions: Array.from(tess.positions), normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx: 0, cy: 0, cz: 0 },
    ...(retainResult ? { shapeId: resultId } : null),
  };
}

// ── Export helpers ────────────────────────────────────────────────────────

const EXPORTABLE_TYPES = new Set(["cube", "sphere", "cylinder", "torus", "extrude", "csg"]);
const MM_PER_UNIT = 10;

// Build each visible exportable item as a world-space OCC shape, scaled to
// millimetres and rotated +π/2 around X (viewport Y-up → export Z-up).
// Returns an array of { id } objects; caller must releaseShape each id.
// `allItems` = whole scene so a csg recipe resolves inputs when exporting a
// selected subset (mirrors occOps.js).
// LOCAL-frame solid to export for one item: prefer the BAKED mesh (the exact
// high-res on-screen geometry) sewn cap-free, else recipe rebuild.  Mirrors
// occOps.js#exportLocalSolid.
function exportLocalSolid(item, allItems, precision) {
  const gd = item.geometryData;
  if (gd?.positions?.length >= 9) {
    try {
      const id = occ.makeSolidFromMesh(
        new Float64Array(gd.positions),
        gd.indices && gd.indices.length ? new Uint32Array(gd.indices) : null,
        true, // skipCaps — exported mesh, never booleaned
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

    // Per-axis scale, then the mm unit conversion folded onto every axis, then
    // world rotation + translation.
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

    // +π/2 around X: viewport Y-up → Z-up (matches occOps.js buildExportShapes).
    const orientedId = occ.transformShape(worldId, 0, 0, 0, Math.PI / 2, 0, 0);
    occ.releaseShape(worldId);
    if (orientedId != null) out.push(orientedId);
  }
  return out;
}

// World-space tessellation of an item's BAKED mesh for STL (mirrors
// occOps.js#bakedWorldTessellation): the baked mesh is already a watertight OCC
// tessellation, so transform its triangles to world and write them verbatim —
// sewing + re-tessellating round-trips through OCC and can open the seams.
function bakedWorldTessellation(item) {
  const gd = item.geometryData;
  const bt = buildBrushTransform(item);
  const sx = (bt.scale.x != null ? bt.scale.x : 1) * MM_PER_UNIT;
  const sy = (bt.scale.y != null ? bt.scale.y : 1) * MM_PER_UNIT;
  const sz = (bt.scale.z != null ? bt.scale.z : 1) * MM_PER_UNIT;
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
  const idx =
    gd.indices && gd.indices.length
      ? gd.indices
      : Array.from({ length: src.length / 3 }, (_, k) => k);
  return { pos, idx, n: idx.length / 3 };
}

// Binary STL: write each item's exact on-screen watertight baked mesh (or, for a
// primitive/extrude with no baked mesh, tessellate its analytic solid) at 0.1 mm
// chord deviation.  Returns a Buffer suitable for Electron IPC + new Blob([buf]).
function exportSTL({ items, allItems, precision }) {
  const all = allItems || items;
  const tessellations = [];
  let triCount = 0;
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    let entry;
    if (item.geometryData && item.geometryData.positions
      && item.geometryData.positions.length >= 9) {
      entry = bakedWorldTessellation(item);
    } else {
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

  const buf = Buffer.allocUnsafe(84 + triCount * 50);
  buf.fill(0, 0, 80);
  buf.writeUInt32LE(triCount, 80);
  let offset = 84;

  for (const { pos, idx, n } of tessellations) {
    for (let t = 0; t < n; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
      const bx = pos[b*3], by = pos[b*3+1], bz = pos[b*3+2];
      const cx = pos[c*3], cy = pos[c*3+1], cz = pos[c*3+2];
      const ux = bx-ax, uy = by-ay, uz = bz-az;
      const vx = cx-ax, vy = cy-ay, vz = cz-az;
      let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      buf.writeFloatLE(nx, offset);      buf.writeFloatLE(ny, offset+4);   buf.writeFloatLE(nz, offset+8);
      buf.writeFloatLE(ax, offset+12);   buf.writeFloatLE(ay, offset+16);  buf.writeFloatLE(az, offset+20);
      buf.writeFloatLE(bx, offset+24);   buf.writeFloatLE(by, offset+28);  buf.writeFloatLE(bz, offset+32);
      buf.writeFloatLE(cx, offset+36);   buf.writeFloatLE(cy, offset+40);  buf.writeFloatLE(cz, offset+44);
      buf.writeUInt16LE(0, offset+48);
      offset += 50;
    }
  }
  return buf;
}

// Export as STEP.  Builds all shapes, passes their IDs to the C++ writer,
// and returns the ISO-10303-21 file content as a string.
function exportSTEP({ items, allItems, precision }) {
  const shapeIds = buildExportShapes(items, allItems || items, precision ?? 0.01);
  if (shapeIds.length === 0) return null;
  try {
    return occ.exportSTEP(shapeIds);
  } finally {
    shapeIds.forEach((id) => occ.releaseShape(id));
  }
}

// Read a STEP file into a tessellated mesh (mirrors occOps.js#importStep).
function importStep({ stepText, printPrecision }) {
  const id = occ.importSTEP(stepText);
  if (!id) throw new Error("STEP import produced no shape.");
  let tess, brep;
  try {
    tess = occ.tessellate(id, printPrecision ?? 0.5);
    if (tess) brep = importedShapeBrep(id, tess.positions);
  } finally {
    occ.releaseShape(id);
  }
  if (!tess) throw new Error("STEP import produced no geometry.");
  return {
    positions: Array.from(tess.positions),
    indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null,
    brep,
  };
}

// The imported shape in its item's frame, as BREP text (mirrors occOps.js).
function importedShapeBrep(id, positions) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const q = [positions[i] / MM_PER_UNIT, positions[i + 2] / MM_PER_UNIT, -positions[i + 1] / MM_PER_UNIT];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const scaled = occ.scaleShape(id, 1 / MM_PER_UNIT);
  const placed = occ.transformShape(scaled, -c[0], -c[1], -c[2], -Math.PI / 2, 0, 0);
  occ.releaseShape(scaled);
  try { return occ.shapeToBrep(placed); } finally { occ.releaseShape(placed); }
}

// Revolve a sketch profile around an axis line (mirrors occOps.js#revolveItem).
function revolveItem({ source, axis, angleRad, prismSides, offsetPerRotation, allItems, printPrecision }) {
  const args = revolveArgs(source, axis, allItems);
  if (!args) {
    throw new Error(
      "Revolve needs a closed profile loop and an axis line on the same sketch.",
    );
  }
  const resultId = occ.makeRevolve(
    args.outerFlat, args.holesFlat, args.cx, args.cy,
    args.ax.x1, args.ax.y1, args.ax.z1, args.ax.x2, args.ax.y2, args.ax.z2,
    angleRad ?? 2 * Math.PI, prismSides ?? 0, offsetPerRotation ?? 0, args.outerCurves, args.holeCurves,
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i + 1] -= cy; centered[i + 2] -= cz;
  }
  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo: { axis },
  };
}

// Sweep a sketch profile along a path polyline (mirrors occOps.js#pipeItem).
function pipeItem({ profileSource, pathRef, twistTurns, autoRotate, allItems, printPrecision }) {
  const args = pipeArgs(profileSource, pathRef, allItems, printPrecision);
  if (!args) {
    throw new Error(
      "Pipe needs a closed profile loop and a path line on another sketch.",
    );
  }
  const resultId = occ.makePipe(
    args.outerFlat, args.holesFlat, args.cx, args.cy, args.pathFlat,
    twistTurns ?? 0, !!autoRotate, args.outerCurves, args.holeCurves, args.pathCurves,
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i + 1] -= cy; centered[i + 2] -= cz;
  }
  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: { pathRef },
  };
}

// Loft a smooth solid between two profile loops (mirrors occOps.js#loftItem).
function loftItem({ profileSource, secondProfileSource, printPrecision }) {
  const args = loftArgs(profileSource, secondProfileSource);
  if (!args) throw new Error("Loft needs two closed profile loops.");
  const resultId = occ.makeLoft(args.aFlat, args.bFlat, args.aCurves, args.bCurves);
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i + 1] -= cy; centered[i + 2] -= cz;
  }
  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: {},
  };
}

// Slice a solid into two parts along a plane (mirrors occOps.js#splitItem).
// Both sides of `target` cut along `plane`, as world solids { aId, bId }
// (mirrors occOps.js#splitHalvesWorld).  The caller releases them.
function splitHalvesWorld(target, plane, allItems, printPrecision) {
  const localId = buildItemShapeLocal(target, allItems, printPrecision);
  if (localId == null) throw new Error("Couldn't build the object to split.");
  const t = buildBrushTransform(target);
  const scaledId = scaleLocal(localId, t.scale);
  const solidId = occ.transformShape(
    scaledId, t.position.x, t.position.y, t.position.z,
    t.rotation.x || 0, t.rotation.y || 0, t.rotation.z || 0,
  );
  if (scaledId !== localId) occ.releaseShape(scaledId);
  else occ.releaseShape(localId);
  if (!solidId) throw new Error("Couldn't build the object to split.");

  const S = 1000;
  const boxLocal = occ.makeBox(-S, -S, 0, S, S, 2 * S);
  const box = occ.transformShape(
    boxLocal, plane.position.x, plane.position.y, plane.position.z,
    plane.rotation.x || 0, plane.rotation.y || 0, plane.rotation.z || 0,
  );
  occ.releaseShape(boxLocal);

  try {
    return {
      aId: occ.booleanOp([solidId, box], "intersection"),
      bId: occ.booleanOp([solidId, box], "difference"),
    };
  } finally {
    occ.releaseShape(solidId);
    occ.releaseShape(box);
  }
}

// A Split piece re-cut from its source, in its mesh's frame (mirrors
// occOps.js#splitPieceLocal).
function splitPieceLocal(r, allItems, precision) {
  const source = (allItems || []).find((i) => i.id === r.sourceId);
  if (!source) return null;
  const { aId, bId } = splitHalvesWorld(source, r.plane, allItems, precision);
  const keep = r.side === "a" ? aId : bId;
  const drop = r.side === "a" ? bId : aId;
  if (drop) occ.releaseShape(drop);
  if (!keep) return null;
  const c = r.center;
  const localId = occ.transformShape(keep, -c.x, -c.y, -c.z, 0, 0, 0);
  occ.releaseShape(keep);
  return localId;
}

function splitItem({ target, plane, allItems, printPrecision }) {
  const { aId, bId } = splitHalvesWorld(target, plane, allItems, printPrecision);

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
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= cx; positions[i + 1] -= cy; positions[i + 2] -= cz;
    }
    return {
      position: { x: cx, y: cy, z: cz },
      geometryData: { positions, normals: null, indices: Array.from(tess.indices), edges: tess.edges ? Array.from(tess.edges) : null },
    };
  };

  const partA = part(aId);
  const partB = part(bId);
  if (!partA && !partB)
    throw new Error("Split produced no geometry — does the plane cross it?");
  return { partA, partB };
}

// ── 3D pattern (mirror / circular / rectangular) — mirrors occOps.js ────────
function buildWorldSolid(item, allItems, precision) {
  const localId = buildItemShapeLocal(item, allItems, precision);
  if (localId == null) return null;
  const t = buildBrushTransform(item);
  const id = scaleLocal(localId, t.scale);
  const w = occ.transformShape(
    id, t.position.x, t.position.y, t.position.z,
    t.rotation.x || 0, t.rotation.y || 0, t.rotation.z || 0,
  );
  if (id !== localId) occ.releaseShape(id);
  else occ.releaseShape(localId);
  return w;
}

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
    for (let i = 0; i < tess.positions.length; i++) positions.push(tess.positions[i]);
    for (let i = 0; i < tess.indices.length; i++) indices.push(tess.indices[i] + base);
  }
  if (positions.length === 0) return null;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx; positions[i + 1] -= cy; positions[i + 2] -= cz;
  }
  return {
    geometryData: { positions, normals: null, indices },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
  };
}

// ── Mesh-based pattern instancing (mirrors occOps.js) ───────────────────────
// Fallback for sources that can't be rebuilt as an OCC solid: replicate the
// source's baked tessellation with rigid transforms.  Clones only (source
// excluded), bbox-centred like combineTessellations.
function v3normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function reflectPoint(x, y, z, o, n) {
  const d = (x - o.x) * n.x + (y - o.y) * n.y + (z - o.z) * n.z;
  return { x: x - 2 * d * n.x, y: y - 2 * d * n.y, z: z - 2 * d * n.z };
}
function rotateAboutAxis(x, y, z, o, a, ang) {
  const px = x - o.x, py = y - o.y, pz = z - o.z;
  const c = Math.cos(ang), s = Math.sin(ang);
  const dot = a.x * px + a.y * py + a.z * pz;
  const cx = a.y * pz - a.z * py, cy = a.z * px - a.x * pz, cz = a.x * py - a.y * px;
  return {
    x: px * c + cx * s + a.x * dot * (1 - c) + o.x,
    y: py * c + cy * s + a.y * dot * (1 - c) + o.y,
    z: pz * c + cz * s + a.z * dot * (1 - c) + o.z,
  };
}
function patternCloneTransforms(patternType, params) {
  const out = [];
  if (patternType === "mirror") {
    const o = params.origin, n = v3normalize(params.normal);
    out.push({ fn: (x, y, z) => reflectPoint(x, y, z, o, n), flip: true });
  } else if (patternType === "circular") {
    const count = Math.max(2, Math.round(params.count || 2));
    const total = params.angleRad != null ? params.angleRad : 2 * Math.PI;
    const o = params.origin, a = v3normalize(params.axis);
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
          const tx = i * (params.dx || 0), ty = j * (params.dy || 0), tz = k * (params.dz || 0);
          out.push({ fn: (x, y, z) => ({ x: x + tx, y: y + ty, z: z + tz }) });
        }
  }
  return out;
}
function patternMeshInstances(source, patternType, params) {
  const g = source.geometryData;
  if (!g || !g.positions || g.positions.length < 9) return null;
  const s = (source.scale && source.scale.x) || 1;
  const rot = source.rotation || { x: 0, y: 0, z: 0 };
  const pos = source.position || { x: 0, y: 0, z: 0 };
  const lp = g.positions;
  const world = new Float64Array(lp.length);
  for (let i = 0; i < lp.length; i += 3) {
    const w = applyEulerXYZ(lp[i] * s, lp[i + 1] * s, lp[i + 2] * s, rot.x || 0, rot.y || 0, rot.z || 0);
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
      const a = srcIdx[t] + base, b = srcIdx[t + 1] + base, c = srcIdx[t + 2] + base;
      if (flip) indices.push(a, c, b);
      else indices.push(a, b, c);
    }
  }
  if (positions.length === 0) return null;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(positions);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx; positions[i + 1] -= cy; positions[i + 2] -= cz;
  }
  return {
    geometryData: { positions, normals: null, indices },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
  };
}

function patternInstances(worldId, patternType, params) {
  const out = [];
  if (patternType === "mirror") {
    const o = params.origin, n = params.normal;
    out.push(occ.mirrorShape(worldId, o.x, o.y, o.z, n.x, n.y, n.z));
  } else if (patternType === "circular") {
    const count = Math.max(2, Math.round(params.count || 2));
    const total = params.angleRad ?? 2 * Math.PI;
    const o = params.origin, a = params.axis;
    // Helical pitch: axial distance per full 360°.
    const pitch = params.axialOffset || 0;
    for (let k = 1; k < count; k++) {
      const ang = (total * k) / count;
      const rotId = occ.rotateShapeAxis(worldId, o.x, o.y, o.z, a.x, a.y, a.z, ang);
      if (pitch) {
        const d = (pitch * ang) / (2 * Math.PI);
        const moved = occ.transformShape(rotId, a.x * d, a.y * d, a.z * d, 0, 0, 0);
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
          out.push(occ.transformShape(worldId, i * (params.dx || 0), j * (params.dy || 0), k * (params.dz || 0), 0, 0, 0));
        }
  }
  return out;
}

function pattern3dItem({ patternType, sourceId, params, allItems, printPrecision }) {
  const source = (allItems || []).find((i) => i.id === sourceId);
  if (!source) throw new Error("Pattern source object not found.");

  // Sources with a baked mesh (every csg / sweep / imported result) are
  // patterned by replicating that mesh — never rebuilt as an OCC solid, whose
  // boolean rebuild can hard-crash the kernel on dense/swept inputs.  Primitives
  // and extrudes have no baked mesh and take the OCC path below.
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

// Tessellate an item's rebuilt solid in its LOCAL frame (Texture tool base
// mesh).  Mirrors occOps.js#tessellateItem.
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

// Sew a baked mesh into a retained OCC solid (JIT cache input fallback).
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

// Weld a mesh by exact position (native meshoptimizer) and report whether it
// is closed -- mirrors occOps.js#weldMesh.
function weldMesh({ positions, indices }) {
  if (!positions || positions.length < 9) return null;
  const r = occ.weldMesh(
    new Float64Array(positions),
    indices && indices.length ? new Uint32Array(indices) : null,
  );
  return {
    positions: Array.from(r.positions),
    indices: Array.from(r.indices),
    openEdges: r.openEdges,
    nonManifoldEdges: r.nonManifoldEdges,
    degenerateTriangles: r.degenerateTriangles,
    verticesBefore: r.verticesBefore,
    verticesAfter: r.verticesAfter,
  };
}

// Simplify a mesh natively (meshoptimizer) -- mirrors occOps.js#simplifyMesh.
// Held to a MEASURED maximum
// deviation or a triangle budget.  `value` is the deviation in scene units, or
// the triangle count.  The result is welded, closed wherever the input was,
// and adds no pinched edges; the op throws with a reason when it can't be.
function simplifyMesh({ positions, indices, mode, value }) {
  if (!positions || positions.length < 9) return null;
  const r = occ.simplifyMesh(
    new Float64Array(positions),
    indices && indices.length ? new Uint32Array(indices) : null,
    mode,
    value,
  );
  return {
    positions: Array.from(r.positions),
    indices: Array.from(r.indices),
    trianglesBefore: r.trianglesBefore,
    trianglesAfter: r.trianglesAfter,
    maxDeviation: r.maxDeviation,
    openEdges: r.openEdges,
    nonManifoldEdges: r.nonManifoldEdges,
  };
}

// Find the surfaces a mesh is made of -- mirrors occOps.js#recognizeSurfaces.
function recognizeSurfaces({ positions, indices, tolerance }) {
  if (!positions || positions.length < 9) return null;
  const r = occ.recognizeSurfaces(
    new Float64Array(positions),
    indices && indices.length ? new Uint32Array(indices) : null,
    tolerance,
  );
  return {
    regions: Array.from(r.regions, (g) => ({
      type: g.type,
      triangles: g.triangles,
      area: g.area,
      deviation: g.deviation,
      ...(g.type === "mesh"
        ? {}
        : {
            point: Array.from(g.point),
            dir: Array.from(g.dir),
            radius: g.radius,
            halfAngle: g.halfAngle,
            minorRadius: g.minorRadius,
          }),
    })),
    triangleRegion: Array.from(r.triangleRegion),
    counts: { ...r.counts },
    triangleCounts: { ...r.triangleCounts },
  };
}

// Release a cached OCC solid (JIT-timeline cache); no-op if already gone.
function releaseShape({ id }) {
  if (id != null) {
    try { occ.releaseShape(id); } catch { /* already gone */ }
  }
  return null;
}

// Register the shared cancel flag (an Int32Array over a SharedArrayBuffer).  The
// native builders poll it via UserBreak and abort mid-op when another thread
// flips it — see occ_kernel.cc's CancelIndicator.
function setCancelBuffer(view) {
  occ.setCancelBuffer(view);
}

module.exports = {
  performCsg, chamferOrFilletItem, pushPullFaces, shellItem, holeItem, embossItem, draftItem, revolveItem, pipeItem, loftItem, splitItem, pattern3dItem, exportSTL, exportSTEP, importStep, releaseShape, solidFromMesh, tessellateItem, weldMesh, simplifyMesh, recognizeSurfaces, setCancelBuffer };
// Internals the unit tests check against occOps.js's copies.
module.exports.__test = { embossVolumeHolds };
