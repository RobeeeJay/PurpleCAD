// Parsers for imported geometry: STL / STEP meshes (3D view) and SVG outlines
// (sketch view).  STL is parsed in-process via three's loader; STEP is read by
// the OCC addon (occClient.importStep) and finalised here.  SVG curves become
// sketch line/bezier shapes.

import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { MM_PER_UNIT } from "./sceneObjects.js";

// Convert a raw mm / Z-up tessellation (STL positions, or an OCC STEP import)
// into a scene-unit, Y-up, bbox-centred geometryData.  This inverts the
// +π/2-about-X rotation and ×MM_PER_UNIT scale that STL/STEP export applies, so
// a round-trip (export then import) lands back where it started.
export function finalizeImportedMesh(positions, indices) {
  const n = positions.length;
  const p = new Array(n);
  for (let i = 0; i < n; i += 3) {
    // file (X, Y, Z) mm Z-up → viewport (X, Z, -Y) scene units.
    p[i] = positions[i] / MM_PER_UNIT;
    p[i + 1] = positions[i + 2] / MM_PER_UNIT;
    p[i + 2] = -positions[i + 1] / MM_PER_UNIT;
  }
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < n; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]);
    maxZ = Math.max(maxZ, p[i + 2]);
  }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  for (let i = 0; i < n; i += 3) {
    p[i] -= cx;
    p[i + 1] -= cy;
    p[i + 2] -= cz;
  }
  return {
    geometryData: {
      positions: p,
      normals: null,
      indices: indices ? Array.from(indices) : null,
    },
    center: { x: cx, y: cy, z: cz },
  };
}

// Parse an STL file (ArrayBuffer, binary or ASCII) into a finalised mesh.
export function parseStl(arrayBuffer) {
  const geom = new STLLoader().parse(arrayBuffer);
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
  return finalizeImportedMesh(pos, idx);
}

// How many scene units the larger dimension of an imported SVG spans, so any
// SVG (whatever its viewBox units) lands at a consistent, visible size.
const SVG_TARGET = 20;

const pt = (v) => ({ x: v.x, y: v.y });
const quadToCubic = (v0, vc, v1) => [
  v0,
  { x: v0.x + (2 / 3) * (vc.x - v0.x), y: v0.y + (2 / 3) * (vc.y - v0.y) },
  { x: v1.x + (2 / 3) * (vc.x - v1.x), y: v1.y + (2 / 3) * (vc.y - v1.y) },
  v1,
];

// Parse an SVG document into sketch shapes (lines + cubic beziers), flipped to
// Y-up, scaled to SVG_TARGET and centred at the origin.  Elliptical / spline
// curves are sampled to short line segments.
export function parseSvgToSketchShapes(svgText) {
  const data = new SVGLoader().parse(svgText);
  const raw = []; // { type, pts:[{x,y}…] } in SVG (y-down) space
  data.paths.forEach((path) => {
    path.subPaths.forEach((sub) => {
      sub.curves.forEach((curve) => {
        switch (curve.type) {
          case "LineCurve":
            raw.push({ type: "line", pts: [pt(curve.v1), pt(curve.v2)] });
            break;
          case "CubicBezierCurve":
            raw.push({
              type: "bezier",
              pts: [pt(curve.v0), pt(curve.v1), pt(curve.v2), pt(curve.v3)],
            });
            break;
          case "QuadraticBezierCurve":
            raw.push({
              type: "bezier",
              pts: quadToCubic(pt(curve.v0), pt(curve.v1), pt(curve.v2)),
            });
            break;
          default: {
            const s = curve.getPoints(24);
            for (let i = 0; i < s.length - 1; i++)
              raw.push({ type: "line", pts: [pt(s[i]), pt(s[i + 1])] });
          }
        }
      });
    });
  });
  if (raw.length === 0) return [];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  raw.forEach((s) =>
    s.pts.forEach((q) => {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }),
  );
  const scale = SVG_TARGET / Math.max(maxX - minX, maxY - minY, 1e-6);
  const ccx = (minX + maxX) / 2,
    ccy = (minY + maxY) / 2;
  const T = (q) => ({ x: (q.x - ccx) * scale, y: -(q.y - ccy) * scale });

  return raw.map((s) => {
    const c = s.pts.map(T);
    return s.type === "line"
      ? { type: "line", x1: c[0].x, y1: c[0].y, x2: c[1].x, y2: c[1].y }
      : { type: "bezier", p0: c[0], p1: c[1], p2: c[2], p3: c[3] };
  });
}

// The endpoints of a line / bezier sketch shape, as {key, x, y}.  Bezier
// endpoints are p0/p3 (p1/p2 are control handles, not joinable corners).
function shapeEndpoints(s) {
  if (s.type === "line")
    return [
      { key: "start", x: s.x1, y: s.y1 },
      { key: "end", x: s.x2, y: s.y2 },
    ];
  if (s.type === "bezier")
    return [
      { key: "p0", x: s.p0.x, y: s.p0.y },
      { key: "p3", x: s.p3.x, y: s.p3.y },
    ];
  return [];
}

// Coincident constraints joining endpoints of `shapes` that land on the same
// location.  Consecutive curves in an SVG subpath share an exact endpoint, so
// without this an imported outline reads as disconnected segments and tools that
// rely on coincident junctions (chamfer/bevel, region detection) don't see a
// closed corner.  `baseIdx` offsets the shape indices to their position in the
// sketch's full shapes array.  Endpoints are bucketed on an `eps` grid so only
// genuinely-coincident points join.
export function svgCoincidentConstraints(shapes, baseIdx = 0, eps = 1e-3) {
  const buckets = new Map();
  shapes.forEach((s, i) => {
    for (const ep of shapeEndpoints(s)) {
      const key = `${Math.round(ep.x / eps)}:${Math.round(ep.y / eps)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ idx: i, key: ep.key });
    }
  });
  const constraints = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    // Chain each later endpoint to the first; transitivity covers the rest.
    const a = group[0];
    for (let j = 1; j < group.length; j++) {
      const b = group[j];
      if (b.idx === a.idx) continue;
      constraints.push({
        type: "coincident",
        shapeAIdx: baseIdx + a.idx,
        pointA: a.key,
        shapeBIdx: baseIdx + b.idx,
        pointB: b.key,
      });
    }
  }
  return constraints;
}
