// Push/pull on the inside of a bore.  With curve detection on, a click on the
// bore's wall highlights the whole smooth wall (highlights.js grows the face
// across triangles meeting within the detection angle), but the selection
// stored ONE face entry -- the clicked facet -- so only that facet moved
// while the whole wall looked selected.  A face entry now carries the angle
// (smoothDeg), and the native matcher grows it the same way, so what is
// highlighted is what moves.  The facets of a bore face different ways, so
// they can't each be swept along their own normal (pushing would leave wedges
// of uncut material between them): they are offset together, and must come
// out as one even, closed wall.

import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../../store", () => {
  const state = {
    pendingOperations: 0,
    beginOperation() {},
    endOperation() {},
  };
  const useStore = () => null;
  useStore.getState = () => state;
  return { useStore };
});

import { ensureOcc } from "../occ/init.js";
import { pushPullFaces } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60_000);

const SIDES = 48;
const R = 1; // bore radius (scene units, 10 mm), to the polygon's corners
const DEPTH = 1;
const O = { x: 0, y: 0, z: 0 };

// A 4 x 4 block with a 48-sided bore through it -- what an extruded sketch
// circle is, one planar face per side.
const bore = [];
for (let i = 0; i < SIDES; i++) {
  const a = (-2 * Math.PI * i) / SIDES; // clockwise: a hole
  bore.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
}
const block = {
  id: 1,
  type: "extrude",
  depth: DEPTH,
  position: O,
  rotation: O,
  scale: { x: 1, y: 1, z: 1 },
  profile: {
    sketchId: 99,
    profileCentroid: { x: 1.5, y: 1.5 },
    polygon2D: [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ],
    holes: [bore],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  },
};

// The selection a click on the bore wall makes: the clicked facet's normal
// (towards the axis) and the hit point, at the facet between corners 0 and 1.
const mid = -Math.PI / SIDES;
const apothem = R * Math.cos(Math.PI / SIDES);
const wallClick = {
  nx: -Math.cos(mid),
  ny: -Math.sin(mid),
  nz: 0,
  cx: apothem * Math.cos(mid),
  cy: apothem * Math.sin(mid),
  cz: DEPTH / 2,
};

// Signed volume of a closed triangle mesh, and its open-edge count (an edge
// used by one triangle only, after welding by position).
function volumeAndOpenEdges({ positions: p, indices }) {
  const idx = indices ?? [...Array(p.length / 3).keys()];
  let v = 0;
  const key = (i) =>
    `${p[i * 3].toFixed(5)},${p[i * 3 + 1].toFixed(5)},${p[i * 3 + 2].toFixed(5)}`;
  const uses = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const [ax, ay, az] = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]];
    const [bx, by, bz] = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]];
    const [cx, cy, cz] = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]];
    v +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
    for (const [u, w] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const [ku, kw] = [key(u), key(w)];
      if (ku === kw) continue;
      const k = ku < kw ? `${ku}|${kw}` : `${kw}|${ku}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n === 1) open++;
  return { volume: Math.abs(v), open };
}

// Area of a regular SIDES-gon by its apothem.
const polyArea = (a) => SIDES * a * a * Math.tan(Math.PI / SIDES);
const blockVolume = (boreApothem) => (16 - polyArea(boreApothem)) * DEPTH;

const run = (faces, distance) =>
  pushPullFaces({
    source: block,
    subGeo: { faces },
    distance,
    allItems: [block],
    printPrecision: 0.01,
  });

describe("push/pull on a curved wall", () => {
  it("without the detection angle, moves only the clicked facet (the old selection)", async () => {
    const r = await run([wallClick], 0.2);
    const { volume } = volumeAndOpenEdges(r.geometryData);
    const oneFacet = 2 * apothem * Math.tan(Math.PI / SIDES) * 0.2 * DEPTH;
    expect(volume - blockVolume(apothem)).toBeCloseTo(oneFacet, 3);
  });

  it("pulled 2 mm, the whole bore closes in evenly", async () => {
    const r = await run([{ ...wallClick, smoothDeg: 30 }], 0.2);
    const { volume, open } = volumeAndOpenEdges(r.geometryData);
    const expected = blockVolume(apothem - 0.2);
    expect(
      Math.abs(volume - expected) / expected,
      `volume ${volume} against ${expected} (only one facet: ${blockVolume(apothem) + 0.0026})`,
    ).toBeLessThan(1e-4);
    expect(open, "a closed solid").toBe(0);
  });

  it("pushed 2 mm, the whole bore opens up, with no wedges left between facets", async () => {
    const r = await run([{ ...wallClick, smoothDeg: 30 }], -0.2);
    const { volume, open } = volumeAndOpenEdges(r.geometryData);
    const expected = blockVolume(apothem + 0.2);
    expect(
      Math.abs(volume - expected) / expected,
      `volume ${volume} against ${expected}`,
    ).toBeLessThan(1e-4);
    expect(open, "a closed solid").toBe(0);
  });

  // A truly curved face -- a primitive cylinder's side, as a Hole tool bore
  // is -- is one OCC face whose normal at its middle isn't the clicked one,
  // so it is found by the clicked point, then offset.
  it("pulls a cylinder's curved side out evenly", async () => {
    const cyl = { id: 2, type: "cylinder", position: O, rotation: O };
    const side = { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0, smoothDeg: 30 };
    const r = await pushPullFaces({
      source: cyl,
      subGeo: { faces: [side] },
      distance: 0.2,
      allItems: [cyl],
      printPrecision: 0.01,
    });
    const { volume, open } = volumeAndOpenEdges(r.geometryData);
    // Radius 1 to 1.2, height 2; the mesh is a polygon of the circle.
    const expected = Math.PI * 1.2 * 1.2 * 2;
    expect(
      Math.abs(volume - expected) / expected,
      `volume ${volume} against ${expected}`,
    ).toBeLessThan(1e-3);
    expect(open, "a closed solid").toBe(0);
  });

  it("does not grow past a sharp edge: the block's top stays where it was", async () => {
    const r = await run([{ ...wallClick, smoothDeg: 30 }], 0.2);
    let maxZ = -Infinity;
    const p = r.geometryData.positions;
    for (let i = 2; i < p.length; i += 3) maxZ = Math.max(maxZ, p[i]);
    const minZ = Math.min(...p.filter((_, i) => i % 3 === 2));
    expect(maxZ - minZ).toBeCloseTo(DEPTH, 6);
  });
});
