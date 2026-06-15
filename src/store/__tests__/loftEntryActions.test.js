// Loft timeline-entry retarget.  A loft is a CREATE entry with no editable
// params, so retargetLoftEntry merges new recipe/geometry into inst.item.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const loftItem = () => ({
  id: 1,
  type: "csg",
  name: "Loft 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
  regenerator: {
    kind: "loft",
    profileSource: { type: "extrude", profile: { sketchId: 1 } },
    secondProfileSource: { type: "extrude", profile: { sketchId: 2 } },
    centerOffset: { cx: 0, cy: 0, cz: 0 },
    regeneratedAt: null,
  },
});

const makeStore = () => {
  const history = [
    { id: "h1", instruction: { type: "create", item: loftItem() } },
  ];
  return create((set) => ({
    items: replayUpTo(history, history.length - 1),
    history,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));
};

describe("retargetLoftEntry", () => {
  it("merges new recipe/geometry into the create entry in place", () => {
    const store = makeStore();
    store.getState().retargetLoftEntry("h1", {
      regenerator: {
        kind: "loft",
        profileSource: { type: "extrude", profile: { sketchId: 5 } },
        secondProfileSource: { type: "extrude", profile: { sketchId: 6 } },
        centerOffset: { cx: 1, cy: 2, cz: 3 },
      },
      geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      position: { x: 1, y: 2, z: 3 },
    });
    const state = store.getState();
    expect(state.history).toHaveLength(1);
    const item = state.items.find((i) => i.id === 1);
    expect(item.regenerator.secondProfileSource.profile.sketchId).toBe(6);
    expect(item.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(item.name).toBe("Loft 1");
  });

  it("ignores entries that aren't a loft create", () => {
    const store = makeStore();
    store.setState((s) => ({
      history: s.history.map((e) => ({
        ...e,
        instruction: {
          ...e.instruction,
          item: { ...e.instruction.item, regenerator: { kind: "pipe" } },
        },
      })),
    }));
    store
      .getState()
      .retargetLoftEntry("h1", { position: { x: 9, y: 9, z: 9 } });
    expect(store.getState().items.find((i) => i.id === 1).position).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });
});
