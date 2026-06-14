// Revolve timeline-entry edits.  A revolve is a CREATE entry (it adds a new
// solid), so updateRevolveParams / retargetRevolveEntry operate on inst.item,
// not inst.patches.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const revolveItem = () => ({
  id: 1,
  type: "csg",
  name: "Revolve 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
  regenerator: {
    kind: "revolve",
    source: { type: "extrude", profile: { sketchId: 1 } },
    axis: { sketchId: 1, shapeIdx: 4 },
    angleRad: Math.PI * 2,
    prismSides: 0,
    centerOffset: { cx: 0, cy: 0, cz: 0 },
    regeneratedAt: null,
  },
});

const makeStore = () => {
  const history = [
    { id: "h1", instruction: { type: "create", item: revolveItem() } },
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

describe("updateRevolveParams", () => {
  it("updates angle + prism on the create entry and dirties it", () => {
    const store = makeStore();
    store.getState().updateRevolveParams("h1", {
      angleRad: Math.PI,
      prismSides: 6,
    });
    const state = store.getState();
    const r = state.history[0].instruction.item.regenerator;
    expect(r.angleRad).toBeCloseTo(Math.PI, 6);
    expect(r.prismSides).toBe(6);
    expect(r.regeneratedAt).toBe("dirty");
    expect(state.history[0].instruction.item.geometryData).toBeNull();
    expect(state.items.find((i) => i.id === 1).regenerator.prismSides).toBe(6);
  });

  it("ignores entries that aren't a revolve create", () => {
    const store = makeStore();
    store.setState((s) => ({
      history: s.history.map((e) => ({
        ...e,
        instruction: {
          ...e.instruction,
          item: { ...e.instruction.item, regenerator: { kind: "boolean" } },
        },
      })),
    }));
    store.getState().updateRevolveParams("h1", { angleRad: 1 });
    expect(
      store.getState().history[0].instruction.item.regenerator.angleRad,
    ).toBeUndefined();
  });
});

describe("retargetRevolveEntry", () => {
  it("merges new recipe/geometry into the create entry in place", () => {
    const store = makeStore();
    store.getState().retargetRevolveEntry("h1", {
      regenerator: {
        kind: "revolve",
        source: { type: "extrude", profile: { sketchId: 2 } },
        axis: { sketchId: 2, shapeIdx: 0 },
        angleRad: Math.PI / 2,
        prismSides: 0,
        centerOffset: { cx: 1, cy: 0, cz: 0 },
      },
      geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      position: { x: 5, y: 0, z: 0 },
    });
    const state = store.getState();
    expect(state.history).toHaveLength(1);
    const item = state.items.find((i) => i.id === 1);
    expect(item.regenerator.axis).toEqual({ sketchId: 2, shapeIdx: 0 });
    expect(item.position).toEqual({ x: 5, y: 0, z: 0 });
    // Preserved fields from the original item.
    expect(item.name).toBe("Revolve 1");
  });
});
