// Regression: a chamfer inserted upstream re-centres the body (new position);
// the following emboss (body-anchored, centerOffset 0) must INHERIT that live
// position, not keep its stale one — otherwise the relief drifts off the object.

import { describe, it, expect, vi } from "vitest";

const GEOM = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: null,
  indices: [0, 1, 2],
};

// Chamfer resolves to a re-centred position (y 0 → 0.5); emboss keeps whatever
// position it was handed (mimics regenerateEmboss keeping currentPosition).
vi.mock("../regenerateItems.js", () => ({
  regenerateItemsForResolution: async (items) =>
    items.map((it) => {
      const r = it.regenerator;
      if (!r) return it;
      if (r.kind === "chamfer")
        return {
          ...it,
          position: { x: 0, y: 0.5, z: 0 },
          geometryData: GEOM,
          regenerator: { ...r, regeneratedAt: 0.1 },
        };
      if (r.kind === "emboss")
        return {
          ...it,
          geometryData: GEOM,
          regenerator: { ...r, regeneratedAt: 0.1 },
        };
      return it;
    }),
}));
vi.mock("../resolution.js", () => ({ activePrecision: () => 0.1 }));
vi.mock("../solidCache.js", () => ({
  getSolid: () => null,
  setSolid: () => {},
  pruneSolids: () => {},
}));

let state;
vi.mock("../../store", () => ({
  useStore: {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
  },
}));

import { recalculateTimeline } from "../regenerateOrchestrator.js";

const extrude = {
  id: 2,
  type: "extrude",
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  depth: 2,
};
const chamferPatches = {
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: GEOM,
  regenerator: {
    kind: "chamfer",
    source: extrude,
    subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
    amount: 0.2,
    segments: 1,
    regeneratedAt: 0.1,
  },
};
const embossPatches = {
  type: "csg",
  position: { x: 0, y: 0, z: 0 }, // stale — must become the chamfer's y=0.5
  geometryData: GEOM,
  regenerator: {
    kind: "emboss",
    source: { ...extrude, ...chamferPatches },
    regeneratedAt: 0.1,
  },
};

describe("emboss inherits the re-centred body position", () => {
  it("moves the emboss step to the chamfer's live position (no drift)", async () => {
    state = {
      history: [
        { id: 0, instruction: { type: "scene_created" } },
        { id: 1, instruction: { type: "create", item: extrude } },
        {
          id: 5,
          dirty: true,
          instruction: { type: "modify", itemId: 2, patches: chamferPatches },
        },
        {
          id: 4,
          dirty: true,
          instruction: { type: "modify", itemId: 2, patches: embossPatches },
        },
      ],
      activeHistoryId: null,
      cancelEpoch: 0,
      setRegenProgress: () => {},
    };

    await recalculateTimeline();

    const emboss = state.history.find((h) => h.id === 4);
    // Was stale y=0; must now equal the chamfer's recomputed y=0.5.
    expect(emboss.instruction.patches.position.y).toBeCloseTo(0.5, 6);
  });
});
