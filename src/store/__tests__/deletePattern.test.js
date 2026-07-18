// Deleting a mirror / circular / rectangular pattern constraint removes the
// WHOLE operation — every copy shape and its constraint — leaving the source.
// (Deleting one copy's constraint used to strand the copy geometry, so a
// rectangular pattern had no way to be deleted.)

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

const C = (cx, cy) => ({ type: "circle", cx, cy, r: 0.3 });

describe("delete a rectangular pattern", () => {
  // Source circle (0) + a 2x2 grid: three copies (1,2,3), each carrying a
  // rectangularPattern constraint, plus an unrelated line (4) with an H lock.
  const makeSketch = () => ({
    id: 1,
    type: "sketch",
    shapes: [
      C(0, 0),
      C(2, 0),
      C(0, 2),
      C(2, 2),
      { type: "line", x1: -5, y1: 9, x2: 5, y2: 9 },
    ],
    constraints: [
      {
        type: "rectangularPattern",
        shapeIdx: 1,
        origIdx: 0,
        i: 1,
        j: 0,
        dx: 2,
        dy: 2,
        countX: 2,
        countY: 2,
      },
      {
        type: "rectangularPattern",
        shapeIdx: 2,
        origIdx: 0,
        i: 0,
        j: 1,
        dx: 2,
        dy: 2,
        countX: 2,
        countY: 2,
      },
      {
        type: "rectangularPattern",
        shapeIdx: 3,
        origIdx: 0,
        i: 1,
        j: 1,
        dx: 2,
        dy: 2,
        countX: 2,
        countY: 2,
      },
      { type: "horizontal", shapeIdx: 4 },
    ],
  });

  it("removes every copy + constraint, keeps the source and reindexes others", () => {
    const store = makeStore([makeSketch()]);
    // Delete via any of the pattern's constraints (index 0).
    store.getState().deleteSketchConstraint(1, 0);
    const item = store.getState().items[0];
    // Only the source circle and the unrelated line remain.
    expect(item.shapes).toHaveLength(2);
    expect(item.shapes[0]).toMatchObject({ type: "circle", cx: 0, cy: 0 });
    expect(item.constraints.some((c) => c.type === "rectangularPattern")).toBe(
      false,
    );
    // The unrelated horizontal followed its shape from idx 4 -> 1.
    const hv = item.constraints.find((c) => c.type === "horizontal");
    expect(hv.shapeIdx).toBe(1);
  });
});

describe("delete a mirror keeps the source", () => {
  it("removes the copy + its mirror constraint", () => {
    const store = makeStore([
      {
        id: 1,
        type: "sketch",
        shapes: [
          { type: "line", x1: 0, y1: -5, x2: 0, y2: 5 }, // axis
          C(1, 0), // source
          C(-1, 0), // mirror copy
        ],
        constraints: [{ type: "mirror", shapeIdx: 2, origIdx: 1, lineIdx: 0 }],
      },
    ]);
    store.getState().deleteSketchConstraint(1, 0);
    const item = store.getState().items[0];
    expect(item.shapes).toHaveLength(2); // axis + source
    expect(item.constraints.some((c) => c.type === "mirror")).toBe(false);
  });
});
