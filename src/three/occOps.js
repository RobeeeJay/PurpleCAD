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
    return occ.makeExtrude(outerFlat, holesFlat, c.x, c.y, depth);
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

      if (inputShapeIds.length < 2) {
        inputShapeIds.forEach((id) => occ.releaseShape(id));
        return null;
      }
      let worldId;
      try {
        worldId = occ.booleanOp(inputShapeIds, r.op || "difference");
      } finally {
        inputShapeIds.forEach((id) => occ.releaseShape(id));
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

  if (shapeIds.length < 2) {
    shapeIds.forEach((id) => occ.releaseShape(id));
    return null;
  }

  let resultId;
  try {
    resultId = occ.booleanOp(shapeIds, operation);
  } finally {
    shapeIds.forEach((id) => occ.releaseShape(id));
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
  performCsg,
  exportSTL,
  exportSTEP,
};
