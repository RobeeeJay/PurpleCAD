// A boolean (or any op) built ON a push/pull result must rebuild that result
// from its recipe — exercising buildItemShapeLocal's `kind === "pushpull"`
// branch, which is otherwise only reached as a top-level regen.  Here a cube
// is pulled on its +Y face, then a difference is cut through it; the result
// must still carry the pulled +Y extent.

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
import { performCsg } from "../occClient.js";

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

// A 2x2x2 cube pulled +0.5 on its +Y face → spans Y -1..1.5 in its own frame.
const pushPulledCube = () => ({
  id: 1,
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  regenerator: {
    kind: "pushpull",
    source: { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } },
    subGeo: { faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }] },
    distance: 0.5,
    centerOffset: { cx: 0, cy: 0, cz: 0 },
  },
});

// A small tool cube parked off to the -X side so the difference removes a
// notch without touching the body's Y extremes.
const toolCube = () => ({
  id: 2,
  type: "cube",
  position: { x: -1, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 0.3, y: 0.3, z: 0.3 },
});

describe("boolean on a push/pull result rebuilds the push/pull source", () => {
  it("keeps the pulled +Y extent through a difference", async () => {
    const body = pushPulledCube();
    const tool = toolCube();
    const result = await performCsg({
      selectedItems: [body, tool],
      allItems: [body, tool],
      operation: "difference",
      printPrecision: 0.01,
    });
    expect(result).toBeTruthy();
    const [, ey] = extents(result.geometryData.positions);
    // Cube is 2 tall; the +0.5 pull makes it 2.5 — the boolean must have built
    // the source via the pushpull branch, not a plain 2x2x2 cube.
    expect(ey).toBeCloseTo(2.5, 3);
  });
});
