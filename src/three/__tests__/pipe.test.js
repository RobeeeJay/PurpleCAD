// Pipe op (native addon path via occClient).  A small square profile (sketch A)
// is swept along a path polyline (sketch B); the path is re-derived live from
// the sketch's connected lines and mapped onto its world plane.

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
import { pipeItem } from "../occClient.js";

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

// Profile sketch (id 1): a 0.6×0.6 square (4 lines = the loop).
const profileSketch = () => ({
  id: 1,
  type: "sketch",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  shapes: [
    { type: "line", x1: -0.3, y1: -0.3, x2: 0.3, y2: -0.3 },
    { type: "line", x1: 0.3, y1: -0.3, x2: 0.3, y2: 0.3 },
    { type: "line", x1: 0.3, y1: 0.3, x2: -0.3, y2: 0.3 },
    { type: "line", x1: -0.3, y1: 0.3, x2: -0.3, y2: -0.3 },
  ],
});

const profileSource = () => ({
  type: "extrude",
  depth: 0,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId: 1,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -0.3, y: -0.3 },
      { x: 0.3, y: -0.3 },
      { x: 0.3, y: 0.3 },
      { x: -0.3, y: 0.3 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

// Path sketch (id 2), in-plane (no rotation): a straight 5-long path, or an L.
const pathSketch = (shapes) => ({
  id: 2,
  type: "sketch",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  shapes,
});

describe("pipeItem", () => {
  it("sweeps a profile along a straight path", async () => {
    const result = await pipeItem({
      profileSource: profileSource(),
      pathRef: { sketchId: 2, shapeIdx: 0 },
      allItems: [
        profileSketch(),
        pathSketch([{ type: "line", x1: 0, y1: 0, x2: 0, y2: 5 }]),
      ],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey, ez] = extents(result.geometryData.positions);
    // 0.6 cross-section swept 5 along the path → a 0.6 × 5 × 0.6 tube.
    expect(ey).toBeCloseTo(5, 1);
    expect(Math.max(ex, ez)).toBeCloseTo(0.6, 1);
  });

  it("follows a connected multi-segment (L) path", async () => {
    const result = await pipeItem({
      profileSource: profileSource(),
      pathRef: { sketchId: 2, shapeIdx: 0 },
      allItems: [
        profileSketch(),
        pathSketch([
          { type: "line", x1: 0, y1: 0, x2: 0, y2: 3 },
          { type: "line", x1: 0, y1: 3, x2: 2, y2: 3 },
        ]),
      ],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey] = extents(result.geometryData.positions);
    // Up 3 then across 2 → spans ~3 in Y and ~2 in X (plus the section width).
    expect(ey).toBeCloseTo(3, 0);
    expect(ex).toBeGreaterThan(2);
    // Built in world, so position equals the world bbox centre.
    expect(result.position).toBeTruthy();
    expect(result.centerOffset).toBeTruthy();
  });

  it("sweeps along a bezier-curve path", async () => {
    // A cubic bezier from (0,0) up and over to (4,4), bowing through +X.
    const result = await pipeItem({
      profileSource: profileSource(),
      pathRef: { sketchId: 2, shapeIdx: 0 },
      allItems: [
        profileSketch(),
        pathSketch([
          {
            type: "bezier",
            p0: { x: 0, y: 0 },
            p1: { x: 4, y: 0 },
            p2: { x: 4, y: 4 },
            p3: { x: 4, y: 4 },
          },
        ]),
      ],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey] = extents(result.geometryData.positions);
    // The curve spans ~4 in both X and Y; the tube follows it (well past a
    // straight chord, which would be the section width only in one axis).
    expect(ex).toBeGreaterThan(3);
    expect(ey).toBeGreaterThan(3);
  });

  it("twists the profile along a straight sweep", async () => {
    // A 1.0 × 0.4 rectangle twisted one full turn sweeps a ~1.0 envelope in
    // BOTH cross-section axes (un-twisted it's only ~0.4 in one).
    const rectSketch = {
      id: 1,
      type: "sketch",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      shapes: [
        { type: "line", x1: -0.5, y1: -0.2, x2: 0.5, y2: -0.2 },
        { type: "line", x1: 0.5, y1: -0.2, x2: 0.5, y2: 0.2 },
        { type: "line", x1: 0.5, y1: 0.2, x2: -0.5, y2: 0.2 },
        { type: "line", x1: -0.5, y1: 0.2, x2: -0.5, y2: -0.2 },
      ],
    };
    const rectSource = {
      type: "extrude",
      depth: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      profile: {
        sketchId: 1,
        profileCentroid: { x: 0, y: 0 },
        polygon2D: [
          { x: -0.5, y: -0.2 },
          { x: 0.5, y: -0.2 },
          { x: 0.5, y: 0.2 },
          { x: -0.5, y: 0.2 },
        ],
        holes: [],
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normalWorld: { x: 0, y: 0, z: 1 },
      },
    };
    const result = await pipeItem({
      profileSource: rectSource,
      pathRef: { sketchId: 2, shapeIdx: 0 },
      twistTurns: 1,
      allItems: [
        rectSketch,
        pathSketch([{ type: "line", x1: 0, y1: 0, x2: 0, y2: 5 }]),
      ],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey, ez] = extents(result.geometryData.positions);
    expect(ey).toBeCloseTo(5, 1);
    expect(Math.min(ex, ez)).toBeGreaterThan(0.8);
  });

  it("auto-rotates the section along a bezier path", async () => {
    const result = await pipeItem({
      profileSource: profileSource(),
      pathRef: { sketchId: 2, shapeIdx: 0 },
      autoRotate: true,
      allItems: [
        profileSketch(),
        pathSketch([
          {
            type: "bezier",
            p0: { x: 0, y: 0 },
            p1: { x: 4, y: 0 },
            p2: { x: 4, y: 4 },
            p3: { x: 4, y: 4 },
          },
        ]),
      ],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
  });

  it("throws when the path sketch is missing", async () => {
    await expect(
      pipeItem({
        profileSource: profileSource(),
        pathRef: { sketchId: 99, shapeIdx: 0 },
        allItems: [profileSketch()],
        printPrecision: 0.05,
      }),
    ).rejects.toThrow();
  });
});
