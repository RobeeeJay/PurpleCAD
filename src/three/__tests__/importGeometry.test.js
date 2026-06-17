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

import {
  finalizeImportedMesh,
  svgCoincidentConstraints,
} from "../importGeometry.js";
import { ensureOcc } from "../occ/init.js";
import { exportSTEP, importStep, performCsg } from "../occClient.js";

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

describe("svgCoincidentConstraints", () => {
  it("joins shared endpoints of consecutive segments", () => {
    // Three lines forming a chain: L0 end == L1 start, L1 end == L2 start.
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
      { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },
      { type: "line", x1: 10, y1: 10, x2: 0, y2: 10 },
    ];
    const cons = svgCoincidentConstraints(shapes);
    expect(cons).toContainEqual({
      type: "coincident",
      shapeAIdx: 0,
      pointA: "end",
      shapeBIdx: 1,
      pointB: "start",
    });
    expect(cons).toContainEqual({
      type: "coincident",
      shapeAIdx: 1,
      pointA: "end",
      shapeBIdx: 2,
      pointB: "start",
    });
  });

  it("offsets indices by baseIdx and joins bezier p0/p3 to lines", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 5, y2: 0 },
      {
        type: "bezier",
        p0: { x: 5, y: 0 },
        p1: { x: 6, y: 1 },
        p2: { x: 7, y: 2 },
        p3: { x: 8, y: 3 },
      },
    ];
    const cons = svgCoincidentConstraints(shapes, 4);
    expect(cons).toContainEqual({
      type: "coincident",
      shapeAIdx: 4,
      pointA: "end",
      shapeBIdx: 5,
      pointB: "p0",
    });
  });

  it("leaves disjoint endpoints unconstrained", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 1, y2: 0 },
      { type: "line", x1: 5, y1: 5, x2: 6, y2: 5 },
    ];
    expect(svgCoincidentConstraints(shapes)).toEqual([]);
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

  it("lets an imported mesh-only solid take part in a boolean", async () => {
    // Build an imported-style item (csg + geometryData, no regenerator) from a
    // STEP round-trip of the cube primitive.
    const stepText = await exportSTEP({
      items: [
        {
          id: 1,
          type: "cube",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    });
    const res = await importStep({ stepText, printPrecision: 0.1 });
    const { geometryData } = finalizeImportedMesh(res.positions, res.indices);
    const imported = {
      id: 2,
      type: "csg",
      geometryData,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const cube = {
      id: 3,
      type: "cube",
      position: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const items = [imported, cube];
    const result = await performCsg({
      selectedItems: items,
      allItems: items,
      operation: "union",
      printPrecision: 0.1,
    });
    expect(result).toBeTruthy();
    expect(result.geometryData.positions.length).toBeGreaterThan(0);
  });

  it("rejects a too-dense imported mesh fast (no boolean hang)", async () => {
    // A boolean on a many-thousand-face mesh-solid would freeze the main
    // process, so an over-the-limit mesh must throw rather than be attempted.
    const triCount = 50001;
    const imported = {
      id: 2,
      type: "csg",
      geometryData: {
        positions: new Array(triCount * 9).fill(0),
        normals: null,
        indices: null,
      },
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const cube = {
      id: 3,
      type: "cube",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const items = [imported, cube];
    await expect(
      performCsg({
        selectedItems: items,
        allItems: items,
        operation: "union",
        printPrecision: 0.1,
      }),
    ).rejects.toThrow(/too detailed/i);
  });
});
