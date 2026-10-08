// Drives the unchanged occ-bridge.cjs through every op family and prints a
// digest of each result, one JSON line per case.  jscBridge.test.js runs it
// under Node (N-API) and under occ_jsc_host (JavaScriptCore, the iPad's
// engine) and requires the two outputs to match exactly: same native code,
// same inputs, so any difference is the adapter.
//
//   node bridge-engines.cjs <occ-bridge.cjs> <extra.json>
//   occ_jsc_host bridge-engines.cjs <occ-bridge.cjs> <extra.json>
//
// extra.json carries inputs only ESM code can build (the emboss stamp).
// exportSTL is left out: it writes a Node Buffer, which the iPad host will
// have to provide or the bridge stop using.

const [, , bridgePath, extraPath] = process.argv;
const readText =
  typeof __readFile === "function"
    ? __readFile
    : (p) => require("fs").readFileSync(p, "utf8");
const bridge = require(bridgePath);
const occ = require(bridgePath.replace(
  /electron\/occ-bridge\.cjs$/,
  "native/occ-addon/build/Release/occ_addon.node",
));
const extra = JSON.parse(readText(extraPath));

// FNV-1a over bytes: a typed array's exact bits, not a rounded summary.
function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const textBytes = (s) => {
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 255;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return b;
};
// A STEP file names its creation time and counts the writer's uses.
const scrubStep = (t) =>
  t
    .replace(/^.*DATE_TIME.*$/gm, "")
    .replace(/'[0-9-]+T[0-9:+]+'/g, "''")
    .replace(/STEP translator [\d.]+ \d+/g, "STEP translator N");

// A mesh as its set of triangles: exact coordinates and winding, but not the
// order OCC emits faces in, which changes from run to run in one engine
// (shell's face order varied in three of five Node runs, counts unchanged).
function meshDigest(pos, idx) {
  const P = Array.from(pos);
  const n = idx ? idx.length : P.length / 3;
  const at = (k) => `${P[3 * k]},${P[3 * k + 1]},${P[3 * k + 2]}`;
  const tris = [];
  for (let t = 0; t + 2 < n; t += 3) {
    const v = [0, 1, 2].map((j) => at(idx ? idx[t + j] : t + j));
    const m = v.indexOf([...v].sort()[0]);
    tris.push([v[m], v[(m + 1) % 3], v[(m + 2) % 3]].join(";"));
  }
  tris.sort();
  return {
    vertices: P.length / 3,
    triangles: tris.length,
    h: fnv(textBytes(tris.join("|"))),
  };
}

function digest(v) {
  if (v && typeof v === "object" && v.positions && "indices" in v) {
    const { positions, indices, ...rest } = v;
    return { mesh: meshDigest(positions, indices), ...digest(rest) };
  }
  if (ArrayBuffer.isView(v))
    return {
      typed: v.constructor.name,
      n: v.length,
      h: fnv(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
    };
  if (Array.isArray(v)) {
    if (v.length > 16 && v.every((x) => typeof x === "number"))
      return { numbers: v.length, h: fnv(new Uint8Array(Float64Array.from(v).buffer)) };
    return v.map(digest);
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = digest(v[k]);
    return o;
  }
  if (typeof v === "string" && v.length > 200) {
    const s = scrubStep(v);
    return { text: s.length, h: fnv(textBytes(s)) };
  }
  return v;
}

function run(name, fn) {
  let out;
  try {
    out = { ok: digest(fn()) };
  } catch (e) {
    out = { error: String(e && e.message) };
  }
  console.log(JSON.stringify({ case: name, ...out }));
}

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = (id, over = {}) => ({
  id, type: "cube", position: O, rotation: O, scale: S, ...over,
});
const edgeYZ = { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] };
const square = (h) => [
  { x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h },
];
const sqSketch = (id, h, z) => ({
  id, type: "sketch", position: { x: 0, y: 0, z }, rotation: O,
  shapes: square(h).map((p, i, a) => ({
    type: "line", x1: p.x, y1: p.y, x2: a[(i + 1) % 4].x, y2: a[(i + 1) % 4].y,
  })),
});
const profileSrc = (sketchId, h, z) => ({
  type: "extrude", depth: 0, position: { x: 0, y: 0, z }, rotation: O,
  profile: {
    sketchId, profileCentroid: { x: 0, y: 0 }, polygon2D: square(h), holes: [],
    position: { x: 0, y: 0, z }, rotation: O, normalWorld: { x: 0, y: 0, z: 1 },
  },
});

// ── Bridge ops ──────────────────────────────────────────────────────────
for (const [i, c] of [
  cube(1),
  cube(1, { position: { x: 2, y: 1, z: -0.5 } }),
  cube(1, { rotation: { x: 0, y: Math.PI / 5, z: 0 } }),
  cube(1, { scale: { x: 1, y: 2, z: 1 } }),
].entries())
  run(`chamfer ${i}`, () => bridge.chamferOrFilletItem({
    source: c, subGeo: edgeYZ, amount: 0.25, segments: 1, allItems: [c],
    printPrecision: 0.1,
  }));
run("fillet", () => bridge.chamferOrFilletItem({
  source: cube(2), subGeo: edgeYZ, amount: 0.3, segments: 3,
  allItems: [cube(2)], printPrecision: 0.1,
}));
run("chamfer too big", () => bridge.chamferOrFilletItem({
  source: cube(2), subGeo: edgeYZ, amount: 5, segments: 1,
  allItems: [cube(2)], printPrecision: 0.1,
}));
for (const operation of ["union", "difference", "intersection"]) {
  const a = cube(3, { scale: { x: 1, y: 2, z: 1 } });
  const b = cube(4, {
    position: { x: 1, y: 0.5, z: 0.25 }, rotation: { x: 0, y: Math.PI / 7, z: 0 },
  });
  run(`boolean ${operation}`, () => bridge.performCsg({
    selectedItems: [a, b], allItems: [a, b], operation, printPrecision: 0.1,
  }));
}
run("push/pull", () => bridge.pushPullFaces({
  source: cube(5), subGeo: { faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }] },
  distance: 0.5, allItems: [cube(5)], printPrecision: 0.1,
}));
run("shell", () => bridge.shellItem({
  source: cube(6), thickness: 0.2, allItems: [cube(6)], printPrecision: 0.1,
}));
for (const threaded of [false, true])
  run(`hole threaded=${threaded}`, () => bridge.holeItem({
    source: cube(7),
    hole: {
      point: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: -1, z: 0 }, length: 12,
      diameter: 6, pitch: 1, tolerance: 0, threaded,
    },
    allItems: [cube(7)], printPrecision: 0.1,
  }));
run("emboss", () => bridge.embossItem({
  source: cube(8), stamp: extra.stamp, allItems: [cube(8)], printPrecision: 0.1,
}));
run("draft", () => bridge.draftItem({
  source: cube(12), neutral: { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 },
  faces: [{ nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 }], angleDeg: 12,
  flip: false, allItems: [cube(12)], printPrecision: 0.1,
}));
run("split", () => bridge.splitItem({
  target: cube(13), plane: { position: O, rotation: O },
  allItems: [cube(13)], printPrecision: 0.1,
}));
run("revolve", () => bridge.revolveItem({
  source: {
    type: "extrude", depth: 0, position: O, rotation: O,
    profile: {
      sketchId: 21, profileCentroid: { x: 2.5, y: 0.5 },
      polygon2D: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 2, y: 1 }],
      holes: [], position: O, rotation: O, normalWorld: { x: 0, y: 0, z: 1 },
    },
  },
  axis: { sketchId: 21, shapeIdx: 4 }, angleRad: 2 * Math.PI, prismSides: 0,
  allItems: [{
    id: 21, type: "sketch",
    shapes: [
      { type: "line", x1: 2, y1: 0, x2: 3, y2: 0 },
      { type: "line", x1: 3, y1: 0, x2: 3, y2: 1 },
      { type: "line", x1: 3, y1: 1, x2: 2, y2: 1 },
      { type: "line", x1: 2, y1: 1, x2: 2, y2: 0 },
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 1 },
    ],
  }],
  printPrecision: 0.05,
}));
run("pipe", () => bridge.pipeItem({
  profileSource: profileSrc(22, 0.3, 0),
  pathRef: { sketchId: 23, shapeIdx: 0 },
  allItems: [
    sqSketch(22, 0.3, 0),
    { id: 23, type: "sketch", position: O, rotation: O,
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 0, y2: 5 }] },
  ],
  printPrecision: 0.05,
}));
run("loft", () => bridge.loftItem({
  profileSource: profileSrc(31, 1, 0),
  secondProfileSource: profileSrc(32, 0.5, 4),
  allItems: [sqSketch(31, 1, 0), sqSketch(32, 0.5, 4)],
  printPrecision: 0.05,
}));
const c16 = cube(16, { position: { x: 3, y: 0, z: 0 } });
run("pattern circular", () => bridge.pattern3dItem({
  patternType: "circular", sourceId: 16,
  params: { origin: O, axis: { x: 0, y: 0, z: 1 }, count: 4, angleRad: 2 * Math.PI },
  allItems: [c16], printPrecision: 0.1,
}));
run("pattern mirror", () => bridge.pattern3dItem({
  patternType: "mirror", sourceId: 16,
  params: { origin: O, normal: { x: 1, y: 0, z: 0 } },
  allItems: [c16], printPrecision: 0.1,
}));
run("tessellateItem", () => bridge.tessellateItem({
  source: cube(11, { position: { x: 1, y: 0.5, z: 0 }, scale: { x: 1, y: 2, z: 1 } }),
  allItems: [], printPrecision: 0.1,
}));
const stepItem = cube(15, { position: { x: 0, y: 1, z: 0 } });
let stepText = "";
run("exportSTEP", () =>
  (stepText = bridge.exportSTEP({ items: [stepItem], allItems: [stepItem], precision: 0.1 })));
run("importStep", () => bridge.importStep({ stepText, printPrecision: 0.1 }));
let baked = null;
run("chamfer to bake", () => {
  const r = bridge.chamferOrFilletItem({
    source: cube(9), subGeo: edgeYZ, amount: 0.2, segments: 1,
    allItems: [cube(9)], printPrecision: 0.1,
  });
  baked = r.geometryData;
  return r;
});
run("solidFromMesh", () => {
  const r = bridge.solidFromMesh(baked);
  const t = occ.tessellate(r.shapeId, 0.1);
  bridge.releaseShape({ id: r.shapeId });
  return { r, t };
});
run("releaseShape unknown", () => bridge.releaseShape({ id: 987654321 }));

const box = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const boxFaces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
  [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]];
const soup = [];
for (const f of boxFaces) for (const v of f) soup.push(...box[v]);
run("weldMesh", () => bridge.weldMesh({ positions: soup, indices: null }));
const grid = { positions: [], indices: [], mode: "deviation", value: 0.001 };
{
  const n = 24;
  const at = (i, j) => i * (n + 1) + j;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) grid.positions.push(i / n, 1, j / n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      grid.indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
}
run("simplifyMesh", () => bridge.simplifyMesh(grid));

// ── The addon directly: what the bridge never sends ─────────────────────
// A view that starts partway into its buffer: the adapter must read from the
// view's first element, not the buffer's.
run("weldMesh on a subarray", () => {
  const big = new Float64Array(9 + soup.length);
  big.fill(42, 0, 9);
  big.set(soup, 9);
  return occ.weldMesh(big.subarray(9), null);
});
run("wrong argument type", () => occ.tessellate("not an id", 0.1));
run("unknown shape id", () => occ.tessellate(123456789, 0.1));
run("box names", () => {
  const id = occ.makeBox(-1, -1, -1, 1, 2, 3);
  const r = { names: occ.faceNames(id), top: occ.namedFacePoint(id, "+y"),
              missing: occ.namedFacePoint(id, "nope") };
  occ.releaseShape(id);
  return r;
});
run("enrichSubGeo", () => {
  const id = occ.makeBox(-1, -1, -1, 1, 1, 1);
  const r = occ.enrichSubGeo(id, {
    edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
    faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }],
  });
  occ.releaseShape(id);
  return r;
});
run("shapeCount", () => occ.shapeCount());
