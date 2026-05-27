// OCC bridge for Electron main process.
// Implements performCsg and chamferOrFilletItem using the native C++ addon
// instead of opencascade.js WASM, mirroring the logic of:
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
    const depth = resolveDepth(item.profile?.depth);
    const c = polyCentroid(poly);
    const outerFlat = new Float64Array(poly.flatMap(p => [p.x, p.y]));
    const holesFlat = holes
      .filter(h => h && h.length >= 3)
      .map(h => new Float64Array(h.flatMap(p => [p.x, p.y])));
    return occ.makeExtrude(outerFlat, holesFlat, c.x, c.y, depth);
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

      if (inputShapeIds.length < 2) {
        inputShapeIds.forEach(id => occ.releaseShape(id));
        return null;
      }

      let worldId;
      try {
        worldId = occ.booleanOp(inputShapeIds, regen.op || "difference");
      } finally {
        inputShapeIds.forEach(id => occ.releaseShape(id));
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

  if (shapeIds.length < 2) {
    shapeIds.forEach(id => occ.releaseShape(id));
    return null;
  }

  let resultId;
  try {
    resultId = occ.booleanOp(shapeIds, operation);
  } finally {
    shapeIds.forEach(id => occ.releaseShape(id));
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
  try {
    resultId = segments === 1
      ? occ.chamferShape(sourceId, subGeo, amount, angleRad ?? null)
      : occ.filletShape(sourceId, subGeo, amount);
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

module.exports = { performCsg, chamferOrFilletItem, exportSTL, exportSTEP };
