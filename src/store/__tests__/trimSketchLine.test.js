// Trim store action: deletes / shrinks / splits a line and cleans up its
// distance constraints, leaving offset geometry untouched.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";

const makeStore = (items) =>
  create((set) => ({
    items,
    history: [],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createSketchSlice(set),
  }));

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const vAt = (x) => L(x, -5, x, 5);
const dist0 = {
  type: "distance",
  shapeAIdx: 0,
  pointA: "start",
  shapeBIdx: 0,
  pointB: "end",
  distance: 10,
};
const sketch = (shapes, constraints = []) => ({
  id: 1,
  type: "sketch",
  shapes,
  constraints,
});
const shapesOf = (store) =>
  store.getState().items.find((i) => i.id === 1).shapes;
const consOf = (store) =>
  store.getState().items.find((i) => i.id === 1).constraints;

describe("trimSketchLine", () => {
  it("deletes a bare line and drops its distance constraint", () => {
    const store = makeStore([sketch([L(0, 0, 10, 0)], [dist0])]);
    store.getState().trimSketchLine(1, 0, 5, 0);
    expect(shapesOf(store)).toHaveLength(0);
    expect(consOf(store)).toHaveLength(0);
  });

  it("shrinks to the surviving side and drops the distance constraint", () => {
    const store = makeStore([sketch([L(0, 0, 10, 0), vAt(5)], [dist0])]);
    store.getState().trimSketchLine(1, 0, 2, 0); // click left → left removed
    const shapes = shapesOf(store);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ x1: 5, y1: 0, x2: 10, y2: 0 });
    expect(consOf(store)).toHaveLength(0); // distance gone
  });

  it("splits into two segments when an interior span is removed", () => {
    const store = makeStore([sketch([L(0, 0, 10, 0), vAt(3), vAt(7)])]);
    store.getState().trimSketchLine(1, 0, 5, 0);
    const shapes = shapesOf(store);
    expect(shapes).toHaveLength(4); // segA, vAt3, vAt7, segB
    expect(shapes[0]).toMatchObject({ x1: 0, x2: 3 });
    expect(shapes[3]).toMatchObject({ x1: 7, x2: 10 });
  });

  it("never trims an offset line", () => {
    const store = makeStore([
      sketch([L(0, 0, 10, 0)], [{ type: "offset", shapeIdx: 0, origIdx: 1 }]),
    ]);
    store.getState().trimSketchLine(1, 0, 5, 0);
    expect(shapesOf(store)).toHaveLength(1); // untouched
  });
});
