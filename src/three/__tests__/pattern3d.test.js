// 3D pattern op: mirror / circular / rectangular clones of a source object.

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
import { pattern3dItem } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const bbox = (positions) => {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], positions[i + k]);
      mx[k] = Math.max(mx[k], positions[i + k]);
    }
  }
  return { mn, mx, ext: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
};

// A 2×2×2 cube offset to x ∈ [2, 4].
const cube = () => ({
  id: 1,
  type: "cube",
  position: { x: 3, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

describe("pattern3dItem", () => {
  it("mirrors a cube across the YZ plane (the copy lands on the far side)", async () => {
    const res = await pattern3dItem({
      patternType: "mirror",
      sourceId: 1,
      params: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
      allItems: [cube()],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    expect(bbox(res.geometryData.positions).ext).toEqual([2, 2, 2]);
    // World cube x ∈ [2,4] mirrored across x=0 → x ∈ [-4,-2], centred at -3.
    expect(res.position.x).toBeCloseTo(-3, 5);
  });

  it("circular pattern makes count-1 rotated copies about the plane normal", async () => {
    const res = await pattern3dItem({
      patternType: "circular",
      sourceId: 1,
      params: {
        origin: { x: 0, y: 0, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        count: 4,
        angleRad: 2 * Math.PI,
      },
      allItems: [cube()],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // 3 copies at 90/180/270° about Z of a cube at x∈[2,4] spread out in the XY
    // plane (well beyond a single 2-wide cube); the Z height is unchanged.
    const { ext } = bbox(res.geometryData.positions);
    expect(Math.max(ext[0], ext[1])).toBeGreaterThan(6);
    expect(ext[2]).toBeCloseTo(2, 1);
  });

  it("rectangular pattern makes a grid of copies (excluding the original)", async () => {
    const res = await pattern3dItem({
      patternType: "rectangular",
      sourceId: 1,
      params: { countX: 3, countY: 1, dx: 5, dy: 0 },
      allItems: [cube()],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // Copies at i=1 (x+5) and i=2 (x+10); originals not included → 2 cubes.
    const { ext } = bbox(res.geometryData.positions);
    // x spans from the i=1 copy (7..9) to the i=2 copy (12..14) → width 7.
    expect(ext[0]).toBeCloseTo(7, 0);
  });
});
