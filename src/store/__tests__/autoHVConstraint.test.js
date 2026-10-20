// A line that is exactly level or upright when it arrives in a sketch gets the
// horizontal or vertical constraint, however it arrived -- so it stays level
// when what it joins moves.  Drawing already snapped near-level lines and
// constrained them; a line pasted, placed from an SVG, or drawn between two
// existing points that happened to line up got nothing.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

// The real store builds the whole app store at import time (not node-safe);
// stub it so the slice evaluates in isolation.
vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";
import { nearestAxis } from "../../three/sketchConstraints.js";

const makeStore = (shapes = []) =>
  create((set) => ({
    items: [{ id: 1, type: "sketch", shapes, constraints: [] }],
    history: [],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createSketchSlice(set),
  }));

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const hv = (store) =>
  store
    .getState()
    .items[0].constraints.filter(
      (c) => c.type === "horizontal" || c.type === "vertical",
    );

describe("lines added level or upright are constrained", () => {
  it("gives a level line horizontal and an upright one vertical, at their own indices", () => {
    const store = makeStore([L(0, 0, 1, 1)]);
    store
      .getState()
      .addSketchShapes(1, [L(0, 2, 5, 2), L(3, 0, 3, 4), L(0, 0, 2, 1)]);
    expect(hv(store)).toEqual([
      { type: "horizontal", shapeIdx: 1 },
      { type: "vertical", shapeIdx: 2 },
    ]);
  });

  it("constrains a single added line too", () => {
    const store = makeStore();
    store.getState().addSketchShape(1, L(4, 7, -2, 7));
    expect(hv(store)).toEqual([{ type: "horizontal", shapeIdx: 0 }]);
  });

  it("leaves a line off its axis alone, however slightly", () => {
    // Drawing snaps lines within ~1.1 degrees onto the axis before they get
    // here; anything else arrives as the user made it.
    const store = makeStore();
    store.getState().addSketchShape(1, L(0, 0, 10, 0.001));
    expect(hv(store)).toEqual([]);
  });

  it("doesn't add a second constraint where the caller gave one", () => {
    const store = makeStore();
    store
      .getState()
      .addSketchShape(1, L(0, 0, 5, 0), [{ type: "horizontal", shapeIdx: 0 }]);
    expect(hv(store)).toEqual([{ type: "horizontal", shapeIdx: 0 }]);
  });

  it("leaves projected lines to follow their source body", () => {
    const store = makeStore();
    store
      .getState()
      .addSketchShapes(1, [{ ...L(0, 0, 5, 0), projection: { sourceId: 9 } }]);
    expect(hv(store)).toEqual([]);
  });
});

describe("the horizontal/vertical button's choice", () => {
  it("picks the axis the line lies nearer", () => {
    expect(nearestAxis(L(0, 0, 10, 3))).toBe("horizontal");
    expect(nearestAxis(L(0, 0, 3, -10))).toBe("vertical");
    expect(nearestAxis(L(5, 5, -5, 4))).toBe("horizontal");
  });
});
