// Reproduction: a chamfer on an extrude's face must follow the sketch when the
// sketch geometry changes — the chamfer regen rebuilds the source from the live
// sketch, so the chamfered body should grow/shrink with the sketch.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});
vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class {} }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({}) }));

import { regenerateItemsForResolution } from "../regenerateItems.js";

const square = (h) => [
  { type: "line", x1: -h, y1: -h, x2: h, y2: -h },
  { type: "line", x1: h, y1: -h, x2: h, y2: h },
  { type: "line", x1: h, y1: h, x2: -h, y2: h },
  { type: "line", x1: -h, y1: h, x2: -h, y2: -h },
];

// A rectangle x:[x0,x1], y:[-h,h] — lets us shift the +X edge (and the
// centroid) without rotating any face.
const rect = (x0, x1, h) => [
  { type: "line", x1: x0, y1: -h, x2: x1, y2: -h },
  { type: "line", x1: x1, y1: -h, x2: x1, y2: h },
  { type: "line", x1: x1, y1: h, x2: x0, y2: h },
  { type: "line", x1: x0, y1: h, x2: x0, y2: -h },
];

const bboxXY = (geometryData) => {
  const p = geometryData.positions;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
  }
  return { w: maxX - minX, h: maxY - minY };
};

describe("chamfer on an extrude follows sketch geometry edits", () => {
  it("rebuilds the chamfered body when the sketch square grows", async () => {
    const mkItems = (halfSize) => [
      { id: 1, type: "sketch", shapes: square(halfSize) },
      {
        id: 2,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: {
            id: 1,
            type: "extrude",
            depth: 2,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            profile: {
              sketchId: 1,
              profileCentroid: { x: 0, y: 0 },
              polygon2D: [
                { x: -halfSize, y: -halfSize },
                { x: halfSize, y: -halfSize },
                { x: halfSize, y: halfSize },
                { x: -halfSize, y: halfSize },
              ],
              holes: [],
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              normalWorld: { x: 0, y: 0, z: 1 },
            },
          },
          // Chamfer the top face (+Z).
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: "dirty",
        },
      },
    ];

    const small = await regenerateItemsForResolution(mkItems(1), null);
    const smallGeo = small.find((i) => i.id === 2).geometryData;
    expect(smallGeo).toBeTruthy();
    const smallBox = bboxXY(smallGeo);

    const big = await regenerateItemsForResolution(mkItems(2), null);
    const bigGeo = big.find((i) => i.id === 2).geometryData;
    expect(bigGeo).toBeTruthy();
    const bigBox = bboxXY(bigGeo);

    // The 4x4 square chamfer must be clearly larger than the 2x2 one.
    expect(bigBox.w).toBeGreaterThan(smallBox.w + 1);
    expect(bigBox.h).toBeGreaterThan(smallBox.h + 1);
  });

  it("follows a side-face chamfer when the sketch edge moves (centroid shifts)", async () => {
    const mkItems = (x0, x1, shapes) => [
      { id: 1, type: "sketch", shapes },
      {
        id: 2,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: {
            id: 1,
            type: "extrude",
            depth: 2,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            profile: {
              sketchId: 1,
              profileCentroid: { x: (x0 + x1) / 2, y: 0 },
              polygon2D: [
                { x: x0, y: -1 },
                { x: x1, y: -1 },
                { x: x1, y: 1 },
                { x: x0, y: 1 },
              ],
              holes: [],
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              normalWorld: { x: 0, y: 0, z: 1 },
            },
          },
          // Chamfer the +X side face.
          subGeo: { edges: [], faces: [{ nx: 1, ny: 0, nz: 0 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: "dirty",
        },
      },
    ];

    const a = await regenerateItemsForResolution(
      mkItems(-1, 1, rect(-1, 1, 1)),
      null,
    );
    const aGeo = a.find((i) => i.id === 2).geometryData;
    expect(aGeo).toBeTruthy();
    const aBox = bboxXY(aGeo);

    // Push the +X edge out to x=3: the body widens and its centroid shifts.
    const b = await regenerateItemsForResolution(
      mkItems(-1, 3, rect(-1, 3, 1)),
      null,
    );
    const bGeo = b.find((i) => i.id === 2).geometryData;
    expect(bGeo).toBeTruthy();
    const bBox = bboxXY(bGeo);

    expect(bBox.w).toBeGreaterThan(aBox.w + 1);
  });

  it("re-matches a side-face chamfer when the sketch edge tilts (normal changes)", async () => {
    const poly = (pts) => pts.map(([x, y]) => ({ x, y }));
    const lines = (pts) =>
      pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return { type: "line", x1: p[0], y1: p[1], x2: q[0], y2: q[1] };
      });
    const mkItems = (pts) => [
      { id: 1, type: "sketch", shapes: lines(pts) },
      {
        id: 2,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        geometryData: { positions: [0], normals: null, indices: [0] },
        regenerator: {
          kind: "chamfer",
          source: {
            id: 1,
            type: "extrude",
            depth: 2,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            profile: {
              sketchId: 1,
              profileCentroid: { x: 0, y: 0 },
              polygon2D: poly(pts),
              holes: [],
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              normalWorld: { x: 0, y: 0, z: 1 },
            },
          },
          subGeo: {
            edges: [],
            faces: [{ nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 1 }],
          },
          amount: 0.2,
          segments: 1,
          regeneratedAt: "dirty",
        },
      },
    ];

    const maxXof = (geo) => {
      let mx = -Infinity;
      const p = geo.positions;
      for (let i = 0; i < p.length; i += 3) mx = Math.max(mx, p[i]);
      return mx;
    };

    // Square: +X face is axis-aligned at x≈1.
    const a = await regenerateItemsForResolution(
      mkItems([
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]),
      null,
    );
    const aGeo = a.find((i) => i.id === 2).geometryData;
    expect(aGeo).toBeTruthy();

    // Tilt the right edge: top-right corner (1,1) → (2,1).  The +X face normal
    // is no longer (1,0,0); the chamfer must re-match it and follow out to x≈2.
    const tilted = await regenerateItemsForResolution(
      mkItems([
        [-1, -1],
        [1, -1],
        [2, 1],
        [-1, 1],
      ]),
      null,
    );
    const tItem = tilted.find((i) => i.id === 2);
    expect(tItem.geometryData).toBeTruthy();
    // Regen succeeded (not the stale "dirty" fallback) and the body widened.
    expect(tItem.regenerator.regeneratedAt).not.toBe("dirty");
    expect(maxXof(tItem.geometryData)).toBeGreaterThan(maxXof(aGeo) + 0.3);
  });
});
