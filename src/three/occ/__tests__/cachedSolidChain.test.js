// Phase 1/2 of the JIT timeline: ops can chamfer a CACHED input solid
// (sourceShapeId) instead of rebuilding the frozen `source` recipe, and can
// retain their result solid so the next op chains off it.  This is the core
// "build on the previous entry's cached solid" mechanism.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

let ops, occ;
beforeAll(async () => {
  await ensureOcc();
  ({ ops } = await import("../../occOps.js"));
  occ = createRequire(import.meta.url)(
    "../../../../native/occ-addon/build/Release/occ_addon.node",
  );
}, 60000);

const cubeItem = {
  id: 1,
  type: "cube",
  position: { x: 0, y: 0, z: 0 },
  dimensions: { width: 2, height: 2, depth: 2 },
};
const topFace = { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] };
const triCount = (g) => g.indices.length / 3;
const extent = (g) => {
  const p = g.positions;
  let lo = [1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
};

describe("chamfer on a cached input solid", () => {
  it("matches the frozen-source path", async () => {
    const args = {
      subGeo: topFace,
      amount: 0.1,
      angleRad: null,
      segments: 1,
      allItems: [cubeItem],
      printPrecision: 0.05,
    };
    // Frozen-source path (rebuilds the cube from its recipe).
    const viaSource = await ops.chamferOrFilletItem({
      source: cubeItem,
      ...args,
    });
    // Cached-solid path (chamfers a prebuilt cube solid directly).
    const cubeId = occ.makeBox(-1, -1, -1, 1, 1, 1);
    const viaCache = await ops.chamferOrFilletItem({
      sourceShapeId: cubeId,
      ...args,
    });
    occ.releaseShape(cubeId);

    expect(viaCache).toBeTruthy();
    expect(triCount(viaCache.geometryData)).toBe(
      triCount(viaSource.geometryData),
    );
    const a = extent(viaCache.geometryData),
      b = extent(viaSource.geometryData);
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 5);
  });

  it("retains its result so the next op chains off it", async () => {
    const cubeId = occ.makeBox(-1, -1, -1, 1, 1, 1);
    const first = await ops.chamferOrFilletItem({
      sourceShapeId: cubeId,
      retainResult: true,
      subGeo: topFace,
      amount: 0.1,
      angleRad: null,
      segments: 1,
      allItems: [cubeItem],
      printPrecision: 0.05,
    });
    occ.releaseShape(cubeId);
    expect(first.shapeId).toBeGreaterThan(0);

    // Chain a second chamfer off the FIRST chamfer's cached solid (bottom face).
    const second = await ops.chamferOrFilletItem({
      sourceShapeId: first.shapeId,
      subGeo: { edges: [], faces: [{ nx: 0, ny: -1, nz: 0 }] },
      amount: 0.1,
      angleRad: null,
      segments: 1,
      allItems: [cubeItem],
      printPrecision: 0.05,
    });
    occ.releaseShape(first.shapeId);
    expect(second).toBeTruthy();
    // Two chamfered faces ⇒ more triangles than a single chamfer.
    expect(triCount(second.geometryData)).toBeGreaterThan(
      triCount(first.geometryData),
    );
  });
});
