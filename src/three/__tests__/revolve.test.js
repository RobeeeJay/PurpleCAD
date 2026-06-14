// Revolve op (native addon path via occClient).  A unit square profile offset
// from the Y axis, revolved 360°, makes a washer ring; the axis is re-read live
// from the sketch, and prism mode yields a faceted solid.

import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../../store", () => {
  const state = {
    variables: [],
    pendingOperations: 0,
    beginOperation() {},
    endOperation() {},
  };
  const useStore = () => null;
  useStore.getState = () => state;
  return { useStore };
});

import { ensureOcc } from "../occ/init.js";
import { revolveItem } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const extents = (positions) => {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], positions[i + k]);
      mx[k] = Math.max(mx[k], positions[i + k]);
    }
  }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
};

// Sketch: a unit square at x:[2,3] y:[0,1] (4 lines = the profile loop) plus an
// axis line on the Y axis (index 4).
const sketch = () => ({
  id: 1,
  type: "sketch",
  shapes: [
    { type: "line", x1: 2, y1: 0, x2: 3, y2: 0 },
    { type: "line", x1: 3, y1: 0, x2: 3, y2: 1 },
    { type: "line", x1: 3, y1: 1, x2: 2, y2: 1 },
    { type: "line", x1: 2, y1: 1, x2: 2, y2: 0 },
    { type: "line", x1: 0, y1: 0, x2: 0, y2: 1 }, // axis
  ],
});

const source = () => ({
  type: "extrude",
  depth: 0,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId: 1,
    profileCentroid: { x: 2.5, y: 0.5 },
    polygon2D: [
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 2, y: 1 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

const axis = { sketchId: 1, shapeIdx: 4 };

describe("revolveItem", () => {
  it("revolves a profile 360° into a washer ring (outer R=3)", async () => {
    const result = await revolveItem({
      source: source(),
      axis,
      angleRad: 2 * Math.PI,
      prismSides: 0,
      allItems: [sketch()],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey, ez] = extents(result.geometryData.positions);
    // Square x:[2,3] revolved about x=0 → ring spanning ±3 in X and Z, height 1.
    expect(ex).toBeCloseTo(6, 1);
    expect(ez).toBeCloseTo(6, 1);
    expect(ey).toBeCloseTo(1, 2);
  });

  it("prism mode produces a faceted (lower-poly) solid", async () => {
    const smooth = await revolveItem({
      source: source(),
      axis,
      angleRad: 2 * Math.PI,
      prismSides: 0,
      allItems: [sketch()],
      printPrecision: 0.05,
    });
    const prism = await revolveItem({
      source: source(),
      axis,
      angleRad: 2 * Math.PI,
      prismSides: 6,
      allItems: [sketch()],
      printPrecision: 0.05,
    });
    expect(prism).toBeTruthy();
    const smoothTris = smooth.geometryData.indices.length / 3;
    const prismTris = prism.geometryData.indices.length / 3;
    // A 6-sided faceted ring is far lower-poly than the smooth surface.
    expect(prismTris).toBeLessThan(smoothTris / 2);
    // Across-corners spans the full 6; across-flats of a hexagon (R=3) ≈ 5.196.
    const [ex, , ez] = extents(prism.geometryData.positions);
    expect(Math.max(ex, ez)).toBeCloseTo(6, 1);
    expect(Math.min(ex, ez)).toBeCloseTo(5.196, 1);
  });

  it("throws when the axis line is missing", async () => {
    await expect(
      revolveItem({
        source: source(),
        axis: { sketchId: 1, shapeIdx: 99 },
        angleRad: 2 * Math.PI,
        prismSides: 0,
        allItems: [sketch()],
        printPrecision: 0.05,
      }),
    ).rejects.toThrow();
  });
});
