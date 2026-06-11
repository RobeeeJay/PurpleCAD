// Integration: a multi-area extrude (two separated regions) fused by a union,
// then retargeted down to ONE region.  The real retargetGroup store action must
// re-point the union to just the kept prism, and the regen must rebuild the
// union so the dropped region's geometry disappears (not "the union shows both").

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

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

import { createHistorySlice } from "../../store/historySlice.js";
import { replayUpTo } from "../../store/internals.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

const squareAt = (cx) => [
  { type: "line", x1: cx - 1, y1: -1, x2: cx + 1, y2: -1 },
  { type: "line", x1: cx + 1, y1: -1, x2: cx + 1, y2: 1 },
  { type: "line", x1: cx + 1, y1: 1, x2: cx - 1, y2: 1 },
  { type: "line", x1: cx - 1, y1: 1, x2: cx - 1, y2: -1 },
];

const profileAt = (cx) => ({
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
});

const prism = (id, cx) => ({
  id,
  type: "extrude",
  depth: 2,
  visible: false,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  profile: profileAt(cx),
});

const history = [
  {
    id: "h1",
    label: "Added",
    itemId: 1,
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
    label: "Extruded",
    itemId: 2,
    instruction: {
      type: "createGroup",
      items: [prism(2, -2), prism(3, 2)],
    },
  },
  {
    id: "h3",
    label: "Added",
    itemId: 4,
    instruction: {
      type: "create",
      item: {
        id: 4,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        // Stale two-region geometry cached on the union.
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
        regenerator: {
          kind: "boolean",
          op: "union",
          inputIds: [2, 3],
          originalCenter: { x: 0, y: 0, z: 0 },
          regeneratedAt: 0.5,
        },
      },
    },
  },
];

const makeStore = () =>
  create((set) => ({
    items: replayUpTo(history, history.length - 1),
    history,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));

const xWidth = (g) => {
  const p = g.positions;
  let mn = 1e9,
    mx = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return mx - mn;
};

describe("retarget a multi-area group down to one region", () => {
  it("re-points the union and the dropped region's geometry disappears", async () => {
    const useStore = makeStore();
    // Keep only the -2 region (drop the +2 one), like deselecting the circle.
    useStore.getState().retargetGroup([2, 3], [profileAt(-2)], 2);

    // The store rewired the union and createGroup to the single kept prism.
    const union = useStore.getState().items.find((i) => i.id === 4);
    expect(union.regenerator.inputIds).toEqual([2]);
    const group = useStore
      .getState()
      .history.find((h) => h.instruction.type === "createGroup")
      .instruction.items;
    expect(group.map((it) => it.id)).toEqual([2]);
    expect(useStore.getState().items.find((i) => i.id === 3)).toBeUndefined();

    // Regen rebuilds the union: only the kept square remains (~2 wide, not ~6).
    const out = await regenerateItemsForResolution(
      useStore.getState().items,
      null,
    );
    const g = out.find((i) => i.id === 4).geometryData;
    expect(g).toBeTruthy();
    expect(xWidth(g)).toBeLessThan(3);
  });
});
