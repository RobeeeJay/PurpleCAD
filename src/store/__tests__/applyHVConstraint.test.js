// Regression: applying a horizontal/vertical constraint to a line snaps that
// line's endpoints, so any geometry coincident to it must be dragged along.
// Previously applySketchHVConstraint only rewrote the line and left connected
// shapes detached; it now propagates through the constraint solver.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

// The real store builds the whole app store at import time (not node-safe) and
// is only pulled in transitively via geometryParams; stub it so the slice +
// solver evaluate in isolation. These tests use coincident + H/V only (no
// distance), so resolveConstraintDistance / variables are never read.
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

describe("applySketchHVConstraint propagates to linked geometry", () => {
  it("making a line horizontal drags its coincident neighbour's endpoint along", () => {
    const sketch = {
      id: 1,
      type: "sketch",
      shapes: [L(0, 0, 10, 1), L(10, 1, 10, 5)], // line0 tilted; line1 joins at (10,1)
      constraints: [
        {
          type: "coincident",
          shapeAIdx: 0,
          pointA: "end",
          shapeBIdx: 1,
          pointB: "start",
        },
      ],
    };
    const store = makeStore([sketch]);
    store.getState().applySketchHVConstraint(1, 0, "horizontal");

    const out = store.getState().items.find((i) => i.id === 1);
    const l0 = out.shapes[0];
    const l1 = out.shapes[1];
    // line0 is now horizontal
    expect(l0.y1).toBeCloseTo(l0.y2);
    // the coincident endpoint of line1 followed line0's end
    expect(l1.x1).toBeCloseTo(l0.x2);
    expect(l1.y1).toBeCloseTo(l0.y2);
  });

  it("making a line vertical drags its coincident neighbour along", () => {
    const sketch = {
      id: 1,
      type: "sketch",
      shapes: [L(0, 0, 1, 6), L(1, 6, 6, 6)], // line0 near-vertical; line1 joins at (1,6)
      constraints: [
        {
          type: "coincident",
          shapeAIdx: 0,
          pointA: "end",
          shapeBIdx: 1,
          pointB: "start",
        },
      ],
    };
    const store = makeStore([sketch]);
    store.getState().applySketchHVConstraint(1, 0, "vertical");

    const out = store.getState().items.find((i) => i.id === 1);
    const l0 = out.shapes[0];
    const l1 = out.shapes[1];
    expect(l0.x1).toBeCloseTo(l0.x2); // vertical
    expect(l1.x1).toBeCloseTo(l0.x2); // neighbour followed
    expect(l1.y1).toBeCloseTo(l0.y2);
  });
});
