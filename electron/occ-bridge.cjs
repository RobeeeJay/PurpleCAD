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
  const outerFlat = new Float64Array(
    withWinding(poly, true).flatMap((p) => [p.x, p.y]),
  );
  const holesFlat = holes.map(
    (h) => new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
  );
  return { outerFlat, holesFlat, cx: c.x, cy: c.y, ax };
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

function pathSegment(shape, i, precision) {
  if (shape && shape.type === "line") {
    const a = { x: shape.x1, y: shape.y1 };
    const b = { x: shape.x2, y: shape.y2 };
    return { i, a, b, sample: (rev) => (rev ? [b, a] : [a, b]) };
  }
  if (shape && shape.type === "bezier") {
    const a = { x: shape.p0.x, y: shape.p0.y };
    const b = { x: shape.p3.x, y: shape.p3.y };
    const n = bezierSegments(shape.p0, shape.p1, shape.p2, shape.p3, precision);
    const pts = sampleCubic(shape.p0, shape.p1, shape.p2, shape.p3, n);
    return { i, a, b, sample: (rev) => (rev ? pts.slice().reverse() : pts.slice()) };
  }
  return null;
}

function orderPathPoints(sketch, startShapeIdx, precision) {
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
  const extend = (atEnd) => {
    let changed = true;
    while (changed) {
      changed = false;
      const tip = atEnd ? pts[pts.length - 1] : pts[0];
      for (const seg of segs) {
        if (used.has(seg.i)) continue;
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

function pipePathWorld(pathRef, allItems, precision) {
  const sketch = (allItems || []).find(
    (i) => i.id === (pathRef && pathRef.sketchId) && i.type === "sketch",
  );
  if (!sketch) return null;
  const pts2d = orderPathPoints(sketch, pathRef.shapeIdx, precision);
  if (!pts2d || pts2d.length < 2) return null;
  return pts2d.map((p) => sketchPointToWorld(sketch, p.x, p.y));
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
  const outerFlat = new Float64Array(
    withWinding(poly, true).flatMap((p) => [p.x, p.y]),
  );
  const holesFlat = holes.map(
    (h) => new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
  );
  const pathFlat = new Float64Array(pathWorld.flatMap((p) => [p.x, p.y, p.z]));
  return { outerFlat, holesFlat, cx: c.x, cy: c.y, pathFlat };
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
  const pa = profileSource && profileSource.profile && profileSource.profile.polygon2D;
  const pb = secondSource && secondSource.profile && secondSource.profile.polygon2D;
  if (!pa || pa.length < 3 || !pb || pb.length < 3) return null;
  const worldA = polyToWorld(
    withWinding(pa, true),
    profileSource.profile.position,
    profileSource.profile.rotation,
  );
  const worldB = polyToWorld(
    withWinding(pb, true),
    secondSource.profile.position,
    secondSource.profile.rotation,
  );
  return {
    aFlat: new Float64Array(worldA.flatMap((p) => [p.x, p.y, p.z])),
    bFlat: new Float64Array(worldB.flatMap((p) => [p.x, p.y, p.z])),
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

// Mirrors csgUtils.js#buildBrushTransform without THREE.js.
function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const s = item.scale ? item.scale.x : 1;
  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const c = polyCentroid(item.profile.polygon2D);
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

// ── Shape builder ────────────────────────────────────────────────────────

// Mirrors csgUtils.js#buildItemShapeLocal.
// Returns a native shape ID that the caller must release, or null on failure.
function buildItemShapeLocal(item, allItems, precision) {
  if (item.type === "cube")     return occ.makeBox(-1, -1, -1, 1, 1, 1);
  if (item.type === "sphere")   return occ.makeSphere(1.5);
  if (item.type === "cylinder") return occ.makeCylinder(-1, 1, 2);
  if (item.type === "torus")    return occ.makeTorus(1.0, 0.4);

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
    const c = polyCentroid(poly);
    const outerFlat = new Float64Array(
      withWinding(poly, true).flatMap(p => [p.x, p.y]),
    );
    const holesFlat = holes
      .filter(h => h && h.length >= 3)
      .map(h => new Float64Array(withWinding(h, false).flatMap(p => [p.x, p.y])));
    const prismId = occ.makeExtrude(outerFlat, holesFlat, c.x, c.y, depth);
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

    if (regen.kind === "revolve") {
      const args = revolveArgs(regen.source, regen.axis, allItems);
      if (!args) return null;
      const resultId = occ.makeRevolve(
        args.outerFlat, args.holesFlat, args.cx, args.cy,
        args.ax.x1, args.ax.y1, args.ax.z1, args.ax.x2, args.ax.y2, args.ax.z2,
        regen.angleRad ?? 2 * Math.PI, regen.prismSides ?? 0,
        regen.offsetPerRotation ?? 0,
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
        regen.twistTurns ?? 0, !!regen.autoRotate,
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
      const resultId = occ.makeLoft(args.aFlat, args.bFlat);
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
          let scaledId = localId;
          if (Math.abs(t.scale - 1) > 1e-9) {
            scaledId = occ.scaleShape(localId, t.scale);
            occ.releaseShape(localId);
          }
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
  }

  return null;
}

// ── Public ops (mirror occOps.js interface) ──────────────────────────────

function performCsg({ selectedItems, allItems, operation, printPrecision }) {
  const sources = allItems || selectedItems;
  const shapeIds = [];
  const worldAnchors = [];

  for (const item of selectedItems) {
    const localId = buildItemShapeLocal(item, sources, printPrecision);
    if (localId == null) continue;
    const t = buildBrushTransform(item);

    // Apply scale before rotate+translate (mirrors occOps.js)
    let scaledId = localId;
    if (Math.abs(t.scale - 1) > 1e-9) {
      scaledId = occ.scaleShape(localId, t.scale);
      occ.releaseShape(localId);
    }
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
      indices: Array.from(tess.indices),
    },
  };
}

function chamferOrFilletItem({ source, subGeo, amount, angleRad, segments, allItems, printPrecision }) {
  const sourceId = buildItemShapeLocal(source, allItems, printPrecision);
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
    occ.releaseShape(sourceId);
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
    occ.releaseShape(resultId);
  }
  if (!tess) return null;

  const arr = Array.from(tess.positions);
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i+1] -= cy; centered[i+2] -= cz;
  }

  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices) },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo,
  };
}

// Mirrors occOps.js#pushPullFaces — move the selected faces along their
// normals by `distance` (signed: +pull / -push), then bbox-centre the result.
function pushPullFaces({ source, subGeo, distance, allItems, printPrecision }) {
  const sourceId = buildItemShapeLocal(source, allItems, printPrecision);
  if (sourceId == null) {
    throw new Error(
      "Could not rebuild the source shape — the item's recipe (boolean / chamfer / push-pull) is missing or references deleted inputs."
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
      "Try re-selecting the face on the current object."
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i+1] -= cy; centered[i+2] -= cz;
  }

  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices) },
    centerOffset: { cx, cy, cz },
    resolvedSubGeo: subGeo,
  };
}

// ── Export helpers ────────────────────────────────────────────────────────

const EXPORTABLE_TYPES = new Set(["cube", "sphere", "cylinder", "torus", "extrude", "csg"]);
const MM_PER_UNIT = 10;

// Build each visible exportable item as a world-space OCC shape, scaled to
// millimetres and rotated +π/2 around X (viewport Y-up → export Z-up).
// Returns an array of { id } objects; caller must releaseShape each id.
function buildExportShapes(items) {
  const out = [];
  const exportPrecision = 0.01;
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;

    const localId = buildItemShapeLocal(item, items, exportPrecision);
    if (localId == null) continue;

    const t = buildBrushTransform(item);
    const finalScale = (t.scale != null ? t.scale : 1) * MM_PER_UNIT;

    // Apply item scale * MM_PER_UNIT, then world rotation + translation.
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

    // +π/2 around X: viewport Y-up → Z-up (matches occOps.js buildExportShapes).
    const orientedId = occ.transformShape(worldId, 0, 0, 0, Math.PI / 2, 0, 0);
    occ.releaseShape(worldId);
    if (orientedId != null) out.push(orientedId);
  }
  return out;
}

// Binary STL: tessellate all export shapes at fine precision (0.01 scene
// units = 0.1 mm chord deviation) and write the binary STL format.
// Returns a Buffer (Uint8Array) suitable for Electron IPC + new Blob([buf]).
function exportSTL({ items }) {
  const shapeIds = buildExportShapes(items);
  if (shapeIds.length === 0) return null;

  const tessellations = [];
  let triCount = 0;
  for (const id of shapeIds) {
    // Export precision in scene units: 0.01 (fine mesh for printing).
    const tess = occ.tessellate(id, 0.01);
    occ.releaseShape(id);
    if (!tess) continue;
    const n = tess.indices.length / 3;
    tessellations.push({ pos: tess.positions, idx: tess.indices, n });
    triCount += n;
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
function exportSTEP({ items }) {
  const shapeIds = buildExportShapes(items);
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
    angleRad ?? 2 * Math.PI, prismSides ?? 0, offsetPerRotation ?? 0,
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
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices) },
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
    twistTurns ?? 0, !!autoRotate,
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
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices) },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: { pathRef },
  };
}

// Loft a smooth solid between two profile loops (mirrors occOps.js#loftItem).
function loftItem({ profileSource, secondProfileSource, printPrecision }) {
  const args = loftArgs(profileSource, secondProfileSource);
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
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const centered = arr.slice();
  for (let i = 0; i < centered.length; i += 3) {
    centered[i] -= cx; centered[i + 1] -= cy; centered[i + 2] -= cz;
  }
  return {
    geometryData: { positions: centered, normals: null, indices: Array.from(tess.indices) },
    centerOffset: { cx, cy, cz },
    position: { x: cx, y: cy, z: cz },
    resolvedSubGeo: {},
  };
}

// Slice a solid into two parts along a plane (mirrors occOps.js#splitItem).
function splitItem({ target, plane, allItems, printPrecision }) {
  const localId = buildItemShapeLocal(target, allItems, printPrecision);
  if (localId == null) throw new Error("Couldn't build the object to split.");
  const t = buildBrushTransform(target);
  let scaledId = localId;
  if (Math.abs(t.scale - 1) > 1e-9) {
    scaledId = occ.scaleShape(localId, t.scale);
    occ.releaseShape(localId);
  }
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
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= cx; positions[i + 1] -= cy; positions[i + 2] -= cz;
    }
    return {
      position: { x: cx, y: cy, z: cz },
      geometryData: { positions, normals: null, indices: Array.from(tess.indices) },
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
  let id = localId;
  if (Math.abs(t.scale - 1) > 1e-9) {
    id = occ.scaleShape(localId, t.scale);
    occ.releaseShape(localId);
  }
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

function patternInstances(worldId, patternType, params) {
  const out = [];
  if (patternType === "mirror") {
    const o = params.origin, n = params.normal;
    out.push(occ.mirrorShape(worldId, o.x, o.y, o.z, n.x, n.y, n.z));
  } else if (patternType === "circular") {
    const count = Math.max(2, Math.round(params.count || 2));
    const total = params.angleRad ?? 2 * Math.PI;
    const o = params.origin, a = params.axis;
    for (let k = 1; k < count; k++)
      out.push(occ.rotateShapeAxis(worldId, o.x, o.y, o.z, a.x, a.y, a.z, (total * k) / count));
  } else if (patternType === "rectangular") {
    const cx = Math.max(1, Math.round(params.countX || 1));
    const cy = Math.max(1, Math.round(params.countY || 1));
    for (let i = 0; i < cx; i++)
      for (let j = 0; j < cy; j++) {
        if (i === 0 && j === 0) continue;
        out.push(occ.transformShape(worldId, i * (params.dx || 0), j * (params.dy || 0), 0, 0, 0, 0));
      }
  }
  return out;
}

function pattern3dItem({ patternType, sourceId, params, allItems, printPrecision }) {
  const source = (allItems || []).find((i) => i.id === sourceId);
  if (!source) throw new Error("Pattern source object not found.");
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

module.exports = { performCsg, chamferOrFilletItem, pushPullFaces, revolveItem, pipeItem, loftItem, splitItem, pattern3dItem, exportSTL, exportSTEP, importStep };
