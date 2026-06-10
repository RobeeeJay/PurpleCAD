// Regression: the Offset modify tool copies selected lines parallel to
// themselves, links each copy to its source with an `offset` constraint, and
// tags the batch with an offsetGroup so its dimension can be edited as a unit.
// updateSketchOffsetDistance then re-solves, moving only the copies.

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
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });

describe("offsetSketchGeometry + updateSketchOffsetDistance", () => {
  it("offsets a line and groups its constraint, then edits the distance", () => {
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [L(0, 0, 10, 0)], constraints: [] },
    ]);
    // 20mm = 2 scene units to the right-normal (below, +y down convention).
    store.getState().offsetSketchGeometry(1, [0], "20");

    let item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes).toHaveLength(2);
    const off = item.constraints.find((c) => c.type === "offset");
    expect(off).toBeTruthy();
    expect(off.offsetGroup).toBe(1);
    // The copy sits 2 units off the original.
    const copy = item.shapes[off.shapeIdx];
    expect(Math.abs((copy.y1 + copy.y2) / 2)).toBeCloseTo(2, 2);

    // Edit the group's distance to 50mm = 5 units; original stays put.
    store.getState().updateSketchOffsetDistance(1, off.offsetGroup, null, "50");
    item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes[0].y1).toBeCloseTo(0);
    expect(item.shapes[0].y2).toBeCloseTo(0);
    const moved = item.shapes[off.shapeIdx];
    expect(Math.abs((moved.y1 + moved.y2) / 2)).toBeCloseTo(5, 2);
  });

  it("offsets a circle into a concentric copy and edits the radius gap", () => {
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [C(0, 0, 3)], constraints: [] },
    ]);
    // +20mm = +2 scene units → a larger concentric circle (r = 3 + 2 = 5).
    store.getState().offsetSketchGeometry(1, [0], "20");

    let item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes).toHaveLength(2);
    const off = item.constraints.find((c) => c.type === "offset");
    expect(off).toBeTruthy();
    const copy = item.shapes[off.shapeIdx];
    expect(copy.type).toBe("circle");
    expect(copy.cx).toBeCloseTo(0);
    expect(copy.cy).toBeCloseTo(0);
    expect(copy.r).toBeCloseTo(5, 2);
    // No corners to chain — the only new constraint is the offset itself.
    expect(
      item.constraints.filter((c) => c.type === "coincident"),
    ).toHaveLength(0);

    // Editing the gap re-solves the copy's radius; the original is untouched.
    store
      .getState()
      .updateSketchOffsetDistance(1, off.offsetGroup, null, "-10");
    item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes[0].r).toBeCloseTo(3, 2);
    expect(item.shapes[off.shapeIdx].r).toBeCloseTo(2, 2); // 3 + (-1)
  });
});
