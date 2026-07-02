// Loft op (native addon path via occClient).  Two square loops on parallel
// planes (sketch A at z=0, sketch B raised on a plane 4 up) loft to a tapered
// solid; profiles re-derive live from their sketches.

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
import { loftItem } from "../occClient.js";

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

// Sketch A (id 1): a 2×2 square on the XY plane at z=0.
const sketchA = () => ({
  id: 1,
  type: "sketch",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  shapes: [
    { type: "line", x1: -1, y1: -1, x2: 1, y2: -1 },
    { type: "line", x1: 1, y1: -1, x2: 1, y2: 1 },
    { type: "line", x1: 1, y1: 1, x2: -1, y2: 1 },
    { type: "line", x1: -1, y1: 1, x2: -1, y2: -1 },
  ],
});

// Sketch B (id 2): a 1×1 square on a plane raised to z=4 (parallel to A).
const sketchB = () => ({
  id: 2,
  type: "sketch",
  position: { x: 0, y: 0, z: 4 },
  rotation: { x: 0, y: 0, z: 0 },
  shapes: [
    { type: "line", x1: -0.5, y1: -0.5, x2: 0.5, y2: -0.5 },
    { type: "line", x1: 0.5, y1: -0.5, x2: 0.5, y2: 0.5 },
    { type: "line", x1: 0.5, y1: 0.5, x2: -0.5, y2: 0.5 },
    { type: "line", x1: -0.5, y1: 0.5, x2: -0.5, y2: -0.5 },
  ],
});

const sourceFor = (sketchId, half, z) => ({
  type: "extrude",
  depth: 0,
  position: { x: 0, y: 0, z },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ],
    holes: [],
    position: { x: 0, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

describe("loftItem", () => {
  it("lofts a solid between two parallel square loops", async () => {
    const result = await loftItem({
      profileSource: sourceFor(1, 1, 0),
      secondProfileSource: sourceFor(2, 0.5, 4),
      allItems: [sketchA(), sketchB()],
      printPrecision: 0.05,
    });
    expect(result).toBeTruthy();
    const [ex, ey, ez] = extents(result.geometryData.positions);
    // The 2×2 base dominates X/Y; the loft spans z=0..4.
    expect(ex).toBeCloseTo(2, 1);
    expect(ey).toBeCloseTo(2, 1);
    expect(ez).toBeCloseTo(4, 1);
    expect(result.position).toBeTruthy();
    expect(result.centerOffset).toBeTruthy();
  });

  it("throws when a profile has no valid loop", async () => {
    // A source whose sketch is gone AND whose stored polygon is degenerate has
    // no loop to loft — loftArgs returns null and the op rejects.
    const empty = sourceFor(99, 0.5, 4);
    empty.profile.polygon2D = [{ x: 0, y: 0 }];
    await expect(
      loftItem({
        profileSource: sourceFor(1, 1, 0),
        secondProfileSource: empty,
        allItems: [sketchA()],
        printPrecision: 0.05,
      }),
    ).rejects.toThrow();
  });
});
