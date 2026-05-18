// Pure OCC operation bodies, shared between the worker (occ.worker.js)
// and the in-process fallback used by node tests and pre-worker browsers.
//
// Each op takes a plain-JS args object and returns a Promise resolving to
// a plain-JS result (or null for no-ops).  No TopoDS_Shape ever escapes
// these functions — when a single user action needs multiple OCC steps,
// they compose those steps inside one op so only the final tessellation
// crosses the boundary.

import { ensureOcc, getOcc } from "./occ/init.js";
import {
  buildItemShapeLocal,
  buildBrushTransform,
} from "./csgUtils.js";
import {
  booleanOp,
  chamferShapeBy,
  filletShapeBy,
  transformShape,
} from "./occ/operations.js";
import { tessellate, tessellateToData } from "./occ/tessellate.js";
import { MM_PER_UNIT } from "./sceneObjects.js";

// Item types that produce a TopoDS_Shape we can export.  Sketches are
// 2D-only; everything else is either a primitive, an extrude, or a CSG
// result whose regenerator we can rebuild.
const EXPORTABLE_TYPES = new Set([
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "extrude",
  "csg",
]);

// Build every exportable item's OCC shape in world space, scaled to
// millimetres (the convention used by every mainstream STL/STEP viewer)
// and rotated +π/2 around X so the viewport's +Y maps to the export's
// +Z (Z-up convention).
function buildExportShapes(items) {
  const oc = getOcc();
  const out = [];
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    const local = buildItemShapeLocal(item, items);
    if (!local) continue;
    const positioned = transformShape(local, item.position, item.rotation);
    if (!positioned) continue;
    const sceneScale = item.scale ? item.scale.x : 1;
    const finalScale = sceneScale * MM_PER_UNIT;
    let scaled = positioned;
    if (Math.abs(finalScale - 1) > 1e-9) {
      const trsf = new oc.gp_Trsf_1();
      trsf.SetScaleFactor(finalScale);
      const mk = new oc.BRepBuilderAPI_Transform_2(positioned, trsf, true);
      scaled = mk.Shape();
    }
    // Y-up viewport → Z-up export.
    const oriented = transformShape(scaled, null, { x: Math.PI / 2 });
    if (oriented) out.push(oriented);
  }
  return out;
}

// Compute axis-aligned bbox over a flat [x,y,z, x,y,z, ...] positions
// array.  Used by every op that centres its output around its bbox —
// inlining keeps occOps free of three.js so the worker bundle doesn't
// pull THREE in just to call Box3.
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

// Apply a chamfer (segments===1) or fillet (segments>1) and return the
// centred tessellation plus the bbox-centre offset the caller uses to
// place the new item in world space.
async function chamferOrFilletItem({
  source,
  subGeo,
  amount,
  angleRad,
  segments,
  allItems,
  printPrecision,
}) {
  await ensureOcc();
  const sourceShape = buildItemShapeLocal(source, allItems);
  if (!sourceShape) return null;
  const result =
    segments === 1
      ? chamferShapeBy(sourceShape, subGeo, amount, angleRad)
      : filletShapeBy(sourceShape, subGeo, amount);
  if (!result || result === sourceShape) return null;
  const data = tessellateToData(result, printPrecision);
  if (!data) return null;

  const arr = data.positions;
  const { minX, minY, minZ, maxX, maxY, maxZ } = bboxOf(arr);
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  const centered = new Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    centered[i] = arr[i] - cx;
    centered[i + 1] = arr[i + 1] - cy;
    centered[i + 2] = arr[i + 2] - cz;
  }
  return {
    geometryData: {
      positions: centered,
      normals: data.normals,
      indices: data.indices,
    },
    centerOffset: { cx, cy, cz },
  };
}

// Build each item's OCC shape in world space and combine them with the
// given boolean operation, then tessellate and centre the result around
// its bbox.  `position` is the world-space bbox centre (== where the
// caller should place the new item so its mesh origin is its volumetric
// centre).
async function performCsg({
  selectedItems,
  allItems,
  operation,
  printPrecision,
}) {
  await ensureOcc();
  const sources = allItems || selectedItems;
  const shapes = [];
  for (const item of selectedItems) {
    const local = buildItemShapeLocal(item, sources);
    if (!local) continue;
    const { position, rotation } = buildBrushTransform(item);
    const world = transformShape(local, position, rotation);
    if (world) shapes.push(world);
  }
  if (shapes.length < 2) return null;
  const result = booleanOp(operation, shapes);
  if (!result) return null;
  const tess = tessellate(result, printPrecision ?? null);
  if (!tess) return null;
  const posAttr = tess.getAttribute("position");
  const normAttr = tess.getAttribute("normal");
  const idxAttr = tess.index;
  const positions = Array.from(posAttr.array);
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
      normals: normAttr ? Array.from(normAttr.array) : null,
      indices: idxAttr ? Array.from(idxAttr.array) : null,
    },
  };
}

// Write a binary STL by walking each exportable item's tessellation.
// The format is trivial enough to emit inline rather than pull three.js
// into the worker bundle just for STLExporter.  Returns an ArrayBuffer
// suitable for `new Blob([...])` on the main thread.
//
// Binary STL layout:
//   80 bytes  header (ignored)
//    4 bytes  uint32 LE triangle count
//   per tri:  12 bytes normal (3 × float32 LE)
//             36 bytes vertices (9 × float32 LE)
//              2 bytes attribute byte count (0)
async function exportSTL({ items }) {
  await ensureOcc();
  const shapes = buildExportShapes(items);
  if (shapes.length === 0) return null;
  // First pass: tessellate everything and count triangles so we can
  // allocate the output buffer exactly once.
  const tessellations = [];
  let triCount = 0;
  for (const shape of shapes) {
    const geo = tessellate(shape, 0.01);
    if (!geo) continue;
    const idx = geo.index;
    const pos = geo.getAttribute("position");
    const n = idx ? idx.count / 3 : pos.count / 3;
    tessellations.push({ geo, n });
    triCount += n;
  }
  if (triCount === 0) return null;
  const byteLength = 84 + triCount * 50;
  const buf = new ArrayBuffer(byteLength);
  const view = new DataView(buf);
  view.setUint32(80, triCount, true);
  let offset = 84;
  for (const { geo, n } of tessellations) {
    const pos = geo.getAttribute("position");
    const idx = geo.index;
    const get = (vi) => [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
    for (let t = 0; t < n; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const [ax, ay, az] = get(a);
      const [bx, by, bz] = get(b);
      const [cx, cy, cz] = get(c);
      // Face normal via (B-A) × (C-A), normalized.
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
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

// Write a B-rep STEP via OCC's STEPControl_Writer.  Returns the file
// content as a string; the main thread wraps it in a Blob and triggers a
// download.  See DocumentSection's previous comments for the
// filename-marshalling quirk we work around with a before/after readdir.
async function exportSTEP({ items }) {
  await ensureOcc();
  const oc = getOcc();
  const shapes = buildExportShapes(items);
  if (shapes.length === 0) return null;
  const writer = new oc.STEPControl_Writer_1();
  const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
  for (const shape of shapes) {
    writer.Transfer(shape, mode, true);
  }
  const before = new Set(oc.FS.readdir("/"));
  writer.Write("scene.step");
  const writtenName = oc.FS.readdir("/").find((n) => !before.has(n));
  if (!writtenName) throw new Error("STEP writer did not produce a file");
  const content = oc.FS.readFile("/" + writtenName, { encoding: "utf8" });
  try {
    oc.FS.unlink("/" + writtenName);
  } catch {
    /* best-effort */
  }
  if (!content || content.length < 100) {
    throw new Error("STEP writer produced an empty or truncated file");
  }
  if (!content.startsWith("ISO-10303-21;")) {
    throw new Error("STEP writer produced an invalid header");
  }
  return content;
}

export const ops = {
  chamferOrFilletItem,
  performCsg,
  exportSTL,
  exportSTEP,
};
