// Push/pull timeline-entry edits: retargetPushPullEntry replaces a step's
// patches in place (re-pick faces) and updatePushPullParams changes just the
// distance — both without appending a new history step.  Mirrors the chamfer
// equivalents (retargetChamferEntry / updateChamferParams).

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const extrudeItem = () => ({
  id: 1,
  type: "extrude",
  name: "Extrude 1",
  children: [],
  parentId: null,
  depth: 2,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
});

const history = () => [
  { id: "h1", instruction: { type: "create", item: extrudeItem() } },
  {
    id: "h2",
    instruction: {
      type: "modify",
      itemId: 1,
      patches: {
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "pushpull",
          source: extrudeItem(),
          subGeo: { faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 }] },
          distance: 0.5,
          regeneratedAt: null,
          centerOffset: { cx: 0, cy: 0, cz: 0 },
        },
        geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      },
    },
    label: "Pulled",
  },
];

const makeStore = () => {
  const h = history();
  return create((set) => ({
    items: replayUpTo(h, h.length - 1),
    history: h,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));
};

describe("retargetPushPullEntry", () => {
  it("replaces the entry's patches in place without adding a step", () => {
    const useStore = makeStore();
    const newPatches = {
      type: "csg",
      position: { x: 1, y: 0, z: 0 },
      regenerator: {
        kind: "pushpull",
        source: extrudeItem(),
        subGeo: { faces: [{ nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 }] },
        distance: 0.5,
        regeneratedAt: null,
        centerOffset: { cx: 1, cy: 0, cz: 0 },
      },
      geometryData: { positions: [2, 2, 2], normals: null, indices: [0] },
    };

    useStore.getState().retargetPushPullEntry("h2", newPatches);

    const state = useStore.getState();
    expect(state.history).toHaveLength(2);
    const entry = state.history.find((h) => h.id === "h2");
    expect(entry.instruction.patches).toEqual(newPatches);
    expect(entry.label).toBe("Pulled");

    const item = state.items.find((i) => i.id === 1);
    expect(item.position).toEqual({ x: 1, y: 0, z: 0 });
    expect(item.regenerator.subGeo.faces[0].nx).toBe(1);
  });

  it("ignores entries whose regenerator is not a push/pull", () => {
    const useStore = makeStore();
    // Mutate h2 to a chamfer so the kind guard rejects it.
    useStore.setState((s) => ({
      history: s.history.map((e) =>
        e.id === "h2"
          ? {
              ...e,
              instruction: {
                ...e.instruction,
                patches: {
                  ...e.instruction.patches,
                  regenerator: { kind: "chamfer" },
                },
              },
            }
          : e,
      ),
    }));
    const before = useStore.getState().history.find((h) => h.id === "h2");
    useStore.getState().retargetPushPullEntry("h2", { type: "csg" });
    const after = useStore.getState().history.find((h) => h.id === "h2");
    expect(after.instruction.patches).toEqual(before.instruction.patches);
  });
});

describe("updatePushPullParams", () => {
  it("updates the distance and dirties the regenerator for rebuild", () => {
    const useStore = makeStore();
    useStore.getState().updatePushPullParams("h2", { distance: 1.5 });

    const state = useStore.getState();
    expect(state.history).toHaveLength(2);
    const r = state.history.find((h) => h.id === "h2").instruction.patches
      .regenerator;
    expect(r.distance).toBe(1.5);
    expect(r.regeneratedAt).toBe("dirty");
    // geometryData is cleared so the regen skip-check misses and re-tessellates.
    expect(
      state.history.find((h) => h.id === "h2").instruction.patches.geometryData,
    ).toBeNull();

    const item = state.items.find((i) => i.id === 1);
    expect(item.regenerator.distance).toBe(1.5);
  });
});
