// pattern3dItem patterns any source carrying a baked mesh by replicating that
// mesh — it must NOT rebuild it as an OCC solid (which can hard-crash the kernel
// for a boolean over a dense / swept mesh).  These sources have recipes that
// would fail/crash the OCC rebuild, so reaching the mesh path is the assertion.

import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../../store", () => {
  const state = { variables: [], beginOperation() {}, endOperation() {} };
  const useStore = () => null;
  useStore.getState = () => state;
  return { useStore };
});

import { ensureOcc } from "../occ/init.js";
import { pattern3dItem } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A 2×2×2 cube (corners at ±1) as baked geometryData.
const cubeMesh = () => {
  const p = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [1, 5, 6],
    [1, 6, 2],
    [2, 6, 7],
    [2, 7, 3],
    [3, 7, 4],
    [3, 4, 0],
  ];
  return { positions: p.flat(), indices: faces.flat(), normals: null };
};

// A csg source whose OCC rebuild fails (pipe recipe with no sketches available),
// forcing the mesh-replication path.
const source = (position = { x: 0, y: 0, z: 0 }) => ({
  id: 1,
  type: "csg",
  position,
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: cubeMesh(),
  regenerator: {
    kind: "pipe",
    profileSource: { profile: { polygon2D: [] } },
    pathRef: { sketchId: 999, shapeIdx: 0 },
  },
});

const bbox = (pos) => {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], pos[i + k]);
      mx[k] = Math.max(mx[k], pos[i + k]);
    }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
};

describe("pattern3dItem mesh fallback", () => {
  it("rectangular pattern of a non-rebuildable source replicates its mesh", async () => {
    const res = await pattern3dItem({
      patternType: "rectangular",
      sourceId: 1,
      params: { countX: 3, countY: 1, countZ: 1, dx: 5, dy: 0, dz: 0 },
      allItems: [source()],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // Clones only (original excluded): i=1 cube x∈[4,6], i=2 cube x∈[9,11] → 7.
    const ext = bbox(res.geometryData.positions);
    expect(ext[0]).toBeCloseTo(7, 5);
    expect(ext[1]).toBeCloseTo(2, 5);
    expect(ext[2]).toBeCloseTo(2, 5);
  });

  it("tiles along Z too", async () => {
    const res = await pattern3dItem({
      patternType: "rectangular",
      sourceId: 1,
      params: { countX: 1, countY: 1, countZ: 3, dx: 0, dy: 0, dz: 5 },
      allItems: [source()],
      printPrecision: 0.1,
    });
    const ext = bbox(res.geometryData.positions);
    expect(ext[2]).toBeCloseTo(7, 5);
  });

  it("patterns a boolean-result source via its mesh (no OCC rebuild)", async () => {
    // A boolean whose inputs aren't in allItems would fail/crash the OCC
    // rebuild; the baked mesh must be used instead.
    const boolSource = {
      id: 2,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      geometryData: cubeMesh(),
      regenerator: {
        kind: "boolean",
        op: "difference",
        inputIds: [101, 102],
        originalCenter: { x: 0, y: 0, z: 0 },
      },
    };
    const res = await pattern3dItem({
      patternType: "rectangular",
      sourceId: 2,
      params: { countX: 3, countY: 1, countZ: 1, dx: 5, dy: 0, dz: 0 },
      allItems: [boolSource],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    expect(bbox(res.geometryData.positions)[0]).toBeCloseTo(7, 5);
  });

  it("mirror reflects across the plane", async () => {
    const res = await pattern3dItem({
      patternType: "mirror",
      sourceId: 1,
      // Source cube at x∈[4,6]; mirror across YZ plane (x=0) → x∈[-6,-4].
      params: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
      allItems: [source({ x: 5, y: 0, z: 0 })],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // The single mirrored cube spans 2 in each axis; its centre is the position.
    const ext = bbox(res.geometryData.positions);
    expect(ext[0]).toBeCloseTo(2, 5);
    expect(res.position.x).toBeCloseTo(-5, 5);
  });
});
