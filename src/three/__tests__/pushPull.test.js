// Regression test for the push/pull face op (native addon path via occClient).
// A 2x2x2 cube's faces are moved along their normals: a positive distance
// pulls the face outward (the body grows), a negative one pushes it inward
// (the body shrinks).  Connected side faces stretch to keep the solid valid —
// verified here through the resulting bounding-box extents.

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

// Axis-aligned extent (max - min) of a flat [x,y,z,...] position array.
function extents(positions) {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], positions[i + k]);
      mx[k] = Math.max(mx[k], positions[i + k]);
    }
  }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
const topFace = { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 };

describe("push/pull faces", () => {
  it("pulling the +Y face outward grows the body along Y only", async () => {
    const result = await pushPullFaces({
      source: cube,
      subGeo: { faces: [topFace] },
      distance: 0.5,
      allItems: [cube],
      printPrecision: 0.01,
    });
    expect(result).toBeTruthy();
    const [ex, ey, ez] = extents(result.geometryData.positions);
    // Base cube is 2 units each way; +0.5 on the top makes it 2.5 tall.
    expect(ey).toBeCloseTo(2.5, 5);
    expect(ex).toBeCloseTo(2.0, 5);
    expect(ez).toBeCloseTo(2.0, 5);
  });

  it("pushing the +Y face inward shrinks the body along Y", async () => {
    const result = await pushPullFaces({
      source: cube,
      subGeo: { faces: [topFace] },
      distance: -0.5,
      allItems: [cube],
      printPrecision: 0.01,
    });
    expect(result).toBeTruthy();
    const [, ey] = extents(result.geometryData.positions);
    expect(ey).toBeCloseTo(1.5, 5);
  });

  it("moves multiple selected faces in one operation", async () => {
    const result = await pushPullFaces({
      source: cube,
      subGeo: {
        faces: [topFace, { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 }],
      },
      distance: 0.5,
      allItems: [cube],
      printPrecision: 0.01,
    });
    expect(result).toBeTruthy();
    const [ex, ey] = extents(result.geometryData.positions);
    expect(ex).toBeCloseTo(2.5, 5);
    expect(ey).toBeCloseTo(2.5, 5);
  });

  it("throws when the selected face can't be matched on the source", async () => {
    await expect(
      pushPullFaces({
        source: cube,
        subGeo: { faces: [{ nx: 0.7, ny: 0.7, nz: 0, cx: 9, cy: 9, cz: 9 }] },
        distance: 0.5,
        allItems: [cube],
        printPrecision: 0.01,
      }),
    ).rejects.toThrow();
  });
});
