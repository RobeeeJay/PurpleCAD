// Regression: removing a region from a multi-area extrude must make that
// region's geometry actually disappear.  When a union drops to a single
// remaining input (2 regions → 1), the boolean used to bail (< 2 inputs) and
// the item kept its stale, larger geometry — the removed region "returned".
// A union of one input now fuses to just that input.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});
vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class {} }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({}) }));

import { regenerateItemsForResolution } from "../regenerateItems.js";

// A unit square centred at (cx, 0).
const squareAt = (cx) => [
  { type: "line", x1: cx - 1, y1: -1, x2: cx + 1, y2: -1 },
  { type: "line", x1: cx + 1, y1: -1, x2: cx + 1, y2: 1 },
  { type: "line", x1: cx + 1, y1: 1, x2: cx - 1, y2: 1 },
  { type: "line", x1: cx - 1, y1: 1, x2: cx - 1, y2: -1 },
];

const prism = (id, cx) => ({
  id,
  type: "extrude",
  depth: 2,
  visible: false,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  profile: {
    sketchId: 1,
    profileCentroid: { x: cx, y: 0 },
    polygon2D: [
      { x: cx - 1, y: -1 },
      { x: cx + 1, y: -1 },
      { x: cx + 1, y: 1 },
      { x: cx - 1, y: 1 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

const union = (inputIds) => ({
  id: 4,
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  regenerator: {
    kind: "boolean",
    op: "union",
    inputIds,
    regeneratedAt: "dirty",
  },
});

const xSpan = (g) => {
  const p = g.positions;
  let mn = 1e9,
    mx = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return { mn, mx, width: mx - mn };
};

const sketch = {
  id: 1,
  type: "sketch",
  shapes: [...squareAt(-2), ...squareAt(2)],
};

describe("union reduced to a single input", () => {
  it("two regions span both squares", async () => {
    const out = await regenerateItemsForResolution(
      [sketch, prism(2, -2), prism(3, 2), union([2, 3])],
      null,
    );
    const g = out.find((i) => i.id === 4).geometryData;
    expect(g).toBeTruthy();
    // Squares at ±2 (half-width 1) → overall x from -3 to 3.
    expect(xSpan(g).width).toBeGreaterThan(5);
  });

  it("dropping a region leaves only the remaining square (no stale geometry)", async () => {
    const out = await regenerateItemsForResolution(
      [sketch, prism(2, -2), union([2])],
      null,
    );
    const item = out.find((i) => i.id === 4);
    expect(item.geometryData).toBeTruthy();
    // geometryData is bbox-centred (world anchor lives in item.position), so
    // assert on width: a single square is ~2 wide, the stale two-square union
    // was ~6.  Width < 3 proves the dropped region's geometry is gone.
    expect(xSpan(item.geometryData).width).toBeLessThan(3);
    // And the surviving body sits at the remaining square's centre (~ -2),
    // not the midpoint of the original pair (~0).
    expect(item.position.x).toBeLessThan(-1);
  });
});
