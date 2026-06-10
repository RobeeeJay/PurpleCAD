// Regression: a chamfer fused onto a multi-area union must FOLLOW a retarget in
// both geometry AND position.  Dropping a region shrinks the union and moves its
// centre; recalculateTimeline recomputes a chamfer-on-boolean's anchor, so the
// chamfered body must sit at the kept region — not stay parked at the old
// two-region midpoint while only its mesh shrinks.

import { describe, it, expect, vi } from "vitest";

let storeState;
vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => storeState;
  useStore.setState = (patch) => {
    storeState = { ...storeState, ...patch };
  };
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

import { recalculateTimeline } from "../regenerateOrchestrator.js";

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

// `inputIds` lets us model the union (and the chamfer's frozen source) before
// (`[2, 3]`) and after (`[2]`) a retarget that drops the +2 region.
const unionRegen = (inputIds) => ({
  kind: "boolean",
  op: "union",
  inputIds,
  // Frozen anchor from when both regions existed (centre ≈ origin).
  originalCenter: { x: 0, y: 0, z: 0 },
  regeneratedAt: null,
});

const mkHistory = (groupPrisms, inputIds) => [
  {
    id: "h1",
    instruction: {
      type: "create",
      item: {
        id: 1,
        type: "sketch",
        shapes: [...squareAt(-2), ...squareAt(2)],
      },
    },
  },
  {
    id: "h2",
    instruction: { type: "createGroup", items: groupPrisms },
  },
  {
    id: "h3",
    instruction: {
      type: "create",
      item: {
        id: 4,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
        regenerator: unionRegen(inputIds),
      },
    },
  },
  {
    id: "h4",
    instruction: {
      type: "modify",
      itemId: 4,
      patches: {
        type: "csg",
        position: { x: 99, y: 99, z: 99 }, // deliberately wrong; must be recomputed
        regenerator: {
          kind: "chamfer",
          source: {
            id: 4,
            type: "csg",
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
            regenerator: unionRegen(inputIds),
          },
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: null,
        },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
      },
    },
  },
];

const xCentre = (item) => {
  const p = item.geometryData.positions;
  let mn = 1e9,
    mx = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return { centre: item.position.x + (mn + mx) / 2, width: mx - mn };
};

const run = async (groupPrisms, inputIds) => {
  storeState = {
    items: [],
    history: mkHistory(groupPrisms, inputIds),
    curveResolution: "preview",
    activeHistoryId: null,
    setRegenProgress: () => {},
  };
  await recalculateTimeline();
  return storeState.items.find((i) => i.id === 4);
};

describe("chamfer on a union follows a retarget in position", () => {
  it("recentres on the kept region instead of the old midpoint", async () => {
    const both = xCentre(await run([prism(2, -2), prism(3, 2)], [2, 3]));
    const dropped = xCentre(await run([prism(2, -2)], [2]));

    // Two regions: a wide body centred near the midpoint of ±2 (≈ 0).
    expect(both.width).toBeGreaterThan(5);
    expect(Math.abs(both.centre)).toBeLessThan(0.5);

    // One region: a narrow body that has MOVED to the kept square (≈ -2),
    // not left parked at 0.
    expect(dropped.width).toBeLessThan(3);
    expect(dropped.centre).toBeLessThan(-1);
  });
});
