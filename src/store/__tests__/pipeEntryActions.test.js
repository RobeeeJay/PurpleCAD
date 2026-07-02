// Pipe timeline-entry retarget.  A pipe is a CREATE entry (it adds a new
// solid) with no editable params, so retargetPipeEntry merges new
// recipe/geometry into inst.item in place.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const pipeItem = () => ({
  id: 1,
  type: "csg",
  name: "Pipe 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
  regenerator: {
    kind: "pipe",
    profileSource: { type: "extrude", profile: { sketchId: 1 } },
    pathRef: { sketchId: 2, shapeIdx: 0 },
    centerOffset: { cx: 0, cy: 0, cz: 0 },
    regeneratedAt: null,
  },
});

const makeStore = () => {
  const history = [
    { id: "h1", instruction: { type: "create", item: pipeItem() } },
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

describe("retargetPipeEntry", () => {
  it("merges new recipe/geometry into the create entry in place", () => {
    const store = makeStore();
    store.getState().retargetPipeEntry("h1", {
      regenerator: {
        kind: "pipe",
        profileSource: { type: "extrude", profile: { sketchId: 3 } },
        pathRef: { sketchId: 4, shapeIdx: 1 },
        centerOffset: { cx: 1, cy: 2, cz: 3 },
      },
      geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      position: { x: 1, y: 2, z: 3 },
    });
    const state = store.getState();
    expect(state.history).toHaveLength(1);
    const item = state.items.find((i) => i.id === 1);
    expect(item.regenerator.pathRef).toEqual({ sketchId: 4, shapeIdx: 1 });
    expect(item.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(item.name).toBe("Pipe 1");
  });

  it("ignores entries that aren't a pipe create", () => {
    const store = makeStore();
    store.setState((s) => ({
      history: s.history.map((e) => ({
        ...e,
        instruction: {
          ...e.instruction,
          item: { ...e.instruction.item, regenerator: { kind: "revolve" } },
        },
      })),
    }));
    store.getState().retargetPipeEntry("h1", {
      position: { x: 9, y: 9, z: 9 },
    });
    expect(store.getState().items.find((i) => i.id === 1).position).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });
});
