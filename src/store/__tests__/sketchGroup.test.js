// Grouping / ungrouping tags shapes with a shared `group` id so they act as a
// unit; ungroup dissolves the whole group.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

const makeStore = (shapes) => {
  const item = { id: 1, type: "sketch", shapes, constraints: [], children: [] };
  return create((set) => ({
    items: [item],
    history: [{ id: "h1", instruction: { type: "create", item: { ...item } } }],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createSketchSlice(set),
  }));
};

const shapesOf = (store) =>
  store.getState().items.find((i) => i.id === 1).shapes;

describe("groupSketchShapes / ungroupSketchShapes", () => {
  it("tags the selected shapes with a shared group id and leaves others alone", () => {
    const store = makeStore([L(0, 0, 1, 0), L(1, 0, 1, 1), L(2, 2, 3, 3)]);
    store.getState().groupSketchShapes(1, [0, 1]);
    const s = shapesOf(store);
    expect(s[0].group).toBeTypeOf("number");
    expect(s[1].group).toBe(s[0].group);
    expect(s[2].group).toBeUndefined();
    // The change is mirrored into the sketch's history entry.
    expect(store.getState().history[0].instruction.item.shapes[0].group).toBe(
      s[0].group,
    );
  });

  it("needs at least two shapes to group", () => {
    const store = makeStore([L(0, 0, 1, 0), L(1, 0, 1, 1)]);
    store.getState().groupSketchShapes(1, [0]);
    expect(shapesOf(store)[0].group).toBeUndefined();
  });

  it("dissolves the whole group when ungrouping any member", () => {
    const store = makeStore([L(0, 0, 1, 0), L(1, 0, 1, 1), L(2, 2, 3, 3)]);
    store.getState().groupSketchShapes(1, [0, 1]);
    // Ungroup via just one member — the whole group goes.
    store.getState().ungroupSketchShapes(1, [0]);
    const s = shapesOf(store);
    expect(s[0].group).toBeUndefined();
    expect(s[1].group).toBeUndefined();
  });
});
