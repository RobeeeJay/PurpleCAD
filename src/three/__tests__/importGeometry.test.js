// Import: the mm/Z-up → scene-unit/Y-up finalize transform, and a STEP
// export→import round-trip through the native addon.

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

import { finalizeImportedMesh } from "../importGeometry.js";
import { ensureOcc } from "../occ/init.js";
import { exportSTEP, importStep } from "../occClient.js";

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

describe("finalizeImportedMesh", () => {
  it("converts mm/Z-up to centred scene-unit/Y-up geometry", () => {
    // A box in mm, Z-up: X ∈ [0,20], Y ∈ [0,40], Z ∈ [0,60], offset from origin.
    const positions = [
      0, 0, 0, 20, 0, 0, 20, 40, 0, 0, 40, 0, 0, 0, 60, 20, 40, 60,
    ];
    const { geometryData, center } = finalizeImportedMesh(positions, null);
    const [ex, ey, ez] = extents(geometryData.positions);
    // ÷10 scene units, axes (X, Z, -Y): X→2, viewport-Y = Z/10 = 6, Z = Y/10 = 4.
    expect(ex).toBeCloseTo(2, 5);
    expect(ey).toBeCloseTo(6, 5);
    expect(ez).toBeCloseTo(4, 5);
    // Centred at the origin.
    const xs = geometryData.positions.filter((_, i) => i % 3 === 0);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6);
    expect(center).toBeTruthy();
  });
});

describe("STEP import round-trip", () => {
  beforeAll(async () => {
    await ensureOcc();
  }, 60000);

  it("re-imports an exported cube at the same size", async () => {
    const cube = {
      id: 1,
      type: "cube",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const stepText = await exportSTEP({ items: [cube] });
    expect(stepText.slice(0, 13)).toBe("ISO-10303-21;");

    const res = await importStep({ stepText, printPrecision: 0.05 });
    const { geometryData } = finalizeImportedMesh(res.positions, res.indices);
    // The cube primitive is a 2×2×2 scene-unit box; export (×10, +90°X) then
    // import + finalize round-trips back to ~2×2×2.
    const [ex, ey, ez] = extents(geometryData.positions);
    expect(ex).toBeCloseTo(2, 1);
    expect(ey).toBeCloseTo(2, 1);
    expect(ez).toBeCloseTo(2, 1);
  });
});
