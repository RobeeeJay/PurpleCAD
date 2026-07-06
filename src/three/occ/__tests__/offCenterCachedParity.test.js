// Parity landmine (off-centre profile): a retained op-result solid must live in
// the SAME bbox-centred frame that buildItemShapeLocal rebuilds it in (it
// re-centres by regenerator.centerOffset).  A centred square hides this because
// its centerOffset is ~0; an off-centre profile makes the offset non-zero, so a
// cached chain built on an uncentred solid would be SHIFTED versus the recipe
// rebuild.  This test fails if the retained shape isn't re-centred.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

let ops, buildItemShapeLocal, occ;
beforeAll(async () => {
  await ensureOcc();
  ({ ops, buildItemShapeLocal } = await import("../../occOps.js"));
  occ = createRequire(import.meta.url)(
    "../../../../native/occ-addon/build/Release/occ_addon.node",
  );
}, 60000);

// Extrude whose profile spans (0,0)..(2,2) — centroid (1,1), i.e. off-origin.
const extrudeSource = {
  id: 5,
  type: "extrude",
  depth: 2,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId: null, // null → build from the baked polygon2D, no sketch needed
    profileCentroid: { x: 1, y: 1 },
    polygon2D: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
};

const bbox = (positions) => {
  let lo = [1e9, 1e9, 1e9],
    hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  return { lo, hi, mid: [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2) };
};

describe("retained op solid matches buildItemShapeLocal (off-centre)", () => {
  it("re-centres the cached chamfer solid to the recipe frame", async () => {
    const subGeo = { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] };
    const res = await ops.chamferOrFilletItem({
      source: extrudeSource,
      subGeo,
      amount: 0.2,
      angleRad: null,
      segments: 1,
      allItems: [],
      printPrecision: 0.05,
      retainResult: true,
    });
    expect(res.shapeId).toBeGreaterThan(0);
    // Sanity: this profile really is off-centre (otherwise the test proves
    // nothing).
    expect(
      Math.abs(res.centerOffset.cx) +
        Math.abs(res.centerOffset.cy) +
        Math.abs(res.centerOffset.cz),
    ).toBeGreaterThan(0.5);

    const chamferItem = {
      id: 5,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "chamfer",
        source: extrudeSource,
        subGeo,
        amount: 0.2,
        segments: 1,
        centerOffset: res.centerOffset, // as regenerateItems stamps it back
      },
    };
    const recipeId = buildItemShapeLocal(chamferItem, [], 0.05);
    expect(recipeId).toBeGreaterThan(0);

    const cachedBox = bbox(
      Array.from(occ.tessellate(res.shapeId, 0.05).positions),
    );
    const recipeBox = bbox(
      Array.from(occ.tessellate(recipeId, 0.05).positions),
    );

    // Both must be centred on the same (≈origin) frame: the cached solid is what
    // a downstream op consumes, the recipe solid is what it would rebuild.
    for (let k = 0; k < 3; k++) {
      expect(cachedBox.mid[k]).toBeCloseTo(recipeBox.mid[k], 4);
      expect(cachedBox.lo[k]).toBeCloseTo(recipeBox.lo[k], 4);
      expect(cachedBox.hi[k]).toBeCloseTo(recipeBox.hi[k], 4);
    }

    occ.releaseShape(res.shapeId);
    occ.releaseShape(recipeId);
  });
});
