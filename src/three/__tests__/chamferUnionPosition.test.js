// Regression: a chamfer on a union (boss) must stay anchored when the sketch
// dimension changes.  The union is re-localised by its frozen originalCentre,
// so a resize moves its bbox centre; if recalculateTimeline keeps the chamfer's
// stored position the body shifts by that delta ("the object origin moves").
// recalculateTimeline must recompute the position for a boolean source.

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

// Rectangle x:[-1,x1], y:[-1,1] as 4 sketch lines.
const rectLines = (x1) => [
  { type: "line", x1: -1, y1: -1, x2: x1, y2: -1 },
  { type: "line", x1: x1, y1: -1, x2: x1, y2: 1 },
  { type: "line", x1: x1, y1: 1, x2: -1, y2: 1 },
  { type: "line", x1: -1, y1: 1, x2: -1, y2: -1 },
];

// The union snapshot's frozen anchor (captured when x1 was 1: centre ≈ origin).
const FROZEN = { x: 0, y: 0, z: 0 };
const unionSnap = {
  id: 4,
  type: "csg",
  position: { ...FROZEN },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  regenerator: {
    kind: "boolean",
    op: "union",
    inputIds: [2, 3],
    originalCenter: { ...FROZEN },
    regeneratedAt: null,
  },
};

const mkHistory = (x1) => [
  {
    id: "a",
    instruction: {
      type: "create",
      item: { id: 1, type: "sketch", shapes: rectLines(x1) },
    },
  },
  {
    id: "b",
    instruction: {
      type: "create",
      item: {
        id: 2,
        type: "extrude",
        depth: 2,
        visible: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        profile: {
          sketchId: 1,
          profileCentroid: { x: 0, y: 0 },
          // Frozen stale polygon (x1 = 1) — re-derived live from the sketch.
          polygon2D: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
          ],
          holes: [],
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          normalWorld: { x: 0, y: 0, z: 1 },
        },
      },
    },
  },
  {
    id: "c",
    instruction: {
      type: "create",
      item: {
        id: 3,
        type: "cube",
        visible: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  },
  { id: "d", instruction: { type: "create", item: { ...unionSnap } } },
  {
    id: "e",
    instruction: {
      type: "modify",
      itemId: 4,
      patches: {
        type: "csg",
        position: { x: 99, y: 99, z: 99 }, // deliberately wrong; must be recomputed
        regenerator: {
          kind: "chamfer",
          source: { ...unionSnap },
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

// World min corner = item.position + geometry's (bbox-centred) min.
const worldMin = (item) => {
  const p = item.geometryData.positions;
  let mnx = 1e9,
    mny = 1e9,
    mnz = 1e9;
  for (let i = 0; i < p.length; i += 3) {
    mnx = Math.min(mnx, p[i]);
    mny = Math.min(mny, p[i + 1]);
    mnz = Math.min(mnz, p[i + 2]);
  }
  return {
    x: item.position.x + mnx,
    y: item.position.y + mny,
    z: item.position.z + mnz,
  };
};

const run = async (x1) => {
  storeState = {
    items: [],
    history: mkHistory(x1),
    activeHistoryId: null,
    setRegenProgress: () => {},
  };
  await recalculateTimeline();
  return storeState.items.find((i) => i.id === 4);
};

describe("chamfer on a union stays anchored across a dimension change", () => {
  it("keeps the fixed corner put when the boss grows in +X", async () => {
    const a = await run(1);
    const b = await run(3); // grow the +X edge from 1 to 3
    expect(a.geometryData).toBeTruthy();
    expect(b.geometryData).toBeTruthy();
    // The body grew in +X (max corner moved out)...
    const ax =
      a.position.x +
      Math.max(...a.geometryData.positions.filter((_, i) => i % 3 === 0));
    const bx =
      b.position.x +
      Math.max(...b.geometryData.positions.filter((_, i) => i % 3 === 0));
    expect(bx).toBeGreaterThan(ax + 0.5);
    // ...but the fixed cube corner (-1,-1,-1) stayed put — no origin drift.
    const wa = worldMin(a);
    const wb = worldMin(b);
    expect(Math.abs(wb.x - wa.x)).toBeLessThan(0.05);
    expect(Math.abs(wb.y - wa.y)).toBeLessThan(0.05);
    expect(Math.abs(wb.z - wa.z)).toBeLessThan(0.05);
  });
});
