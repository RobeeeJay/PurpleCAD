// Split op: slice a solid into two parts along a plane.

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
import { splitItem } from "../occClient.js";

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

const cube = () => ({
  id: 1,
  type: "cube",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

describe("splitItem", () => {
  it("cuts a 2×2×2 cube into two 2×2×1 halves along the XY plane", async () => {
    const res = await splitItem({
      target: cube(),
      // Plane through the origin, normal +Z (rotation 0).
      plane: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      allItems: [cube()],
      printPrecision: 0.1,
    });
    expect(res.partA).toBeTruthy();
    expect(res.partB).toBeTruthy();
    const a = extents(res.partA.geometryData.positions);
    const b = extents(res.partB.geometryData.positions);
    expect(a).toEqual([2, 2, 1]);
    expect(b).toEqual([2, 2, 1]);
    // The two halves sit on opposite sides of z=0.
    expect(res.partA.position.z).toBeCloseTo(0.5, 5);
    expect(res.partB.position.z).toBeCloseTo(-0.5, 5);
  });

  it("returns only one part when the plane misses the solid", async () => {
    const res = await splitItem({
      target: cube(),
      // Plane well above the cube (z = 5) → everything is on the -normal side.
      plane: { position: { x: 0, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0 } },
      allItems: [cube()],
      printPrecision: 0.1,
    });
    expect(res.partA).toBeNull();
    expect(res.partB).toBeTruthy();
    expect(extents(res.partB.geometryData.positions)).toEqual([2, 2, 2]);
  });
});
