// Double-clicking a rectangularPattern constraint re-opens the tool to edit the
// pattern; confirming replaces the old copies (reindexing every surviving
// constraint) instead of appending a second pattern.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import {
  createSketchSlice,
  remapConstraintShapeIndices,
} from "../sketchSlice.js";

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

describe("remapConstraintShapeIndices", () => {
  it("remaps every shape-index field and drops constraints on a deleted shape", () => {
    const map = new Map([
      [0, 0],
      [1, -1],
      [2, 1],
      [3, 2],
    ]);
    expect(
      remapConstraintShapeIndices(
        { type: "coincident", shapeAIdx: 0, shapeBIdx: 2, pointA: "end" },
        map,
      ),
    ).toEqual({
      type: "coincident",
      shapeAIdx: 0,
      shapeBIdx: 1,
      pointA: "end",
    });
    // References the removed shape (1) → dropped.
    expect(
      remapConstraintShapeIndices({ type: "horizontal", shapeIdx: 1 }, map),
    ).toBeNull();
    // mirror carries origIdx + lineIdx; offsetGroup-style scalars are untouched.
    expect(
      remapConstraintShapeIndices(
        { type: "mirror", shapeIdx: 3, origIdx: 2, lineIdx: 0 },
        map,
      ),
    ).toEqual({ type: "mirror", shapeIdx: 2, origIdx: 1, lineIdx: 0 });
  });
});

describe("rectangular pattern edit (begin + replace on confirm)", () => {
  // Layout: source line at 0, its pattern copy at 1 (a 2x1 grid, dx=10), and an
  // unrelated horizontal line at 2 — so removing the copy reindexes line 2.
  const makeSketch = () => ({
    id: 1,
    type: "sketch",
    shapes: [L(0, 0, 2, 0), L(10, 0, 12, 0), L(0, 5, 2, 5)],
    constraints: [
      {
        type: "rectangularPattern",
        shapeIdx: 1,
        origIdx: 0,
        i: 1,
        j: 0,
        dx: 10,
        dy: 0,
        countX: 2,
        countY: 1,
      },
      { type: "horizontal", shapeIdx: 2 },
    ],
  });

  it("seeds the tool state from the double-clicked constraint", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginRectangularPatternEdit(1, 0);
    const st = store.getState();
    expect(st.activeSketchTool).toBe("rectangularPattern");
    // Tool-state offsets are mm; the constraint's dx of 10 units seeds 100.
    expect(st.sketchRectangularPatternState).toMatchObject({
      shapeIndices: [0],
      countX: 2,
      countY: 1,
      offsetX: 100,
      offsetY: 0,
      editCopyIndices: [1],
    });
  });

  it("replaces the old copies with a new count and reindexes other constraints", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginRectangularPatternEdit(1, 0);
    store.getState().setRectangularPatternCountX(3); // 2 -> 3 columns
    store.getState().confirmRectangularPattern(1);

    const sketch = store.getState().items.find((i) => i.id === 1);
    // Source (0) + reindexed unrelated line + two new copies (i=1, i=2).
    expect(sketch.shapes).toHaveLength(4);

    // The unrelated horizontal line moved from index 2 to 1, and its constraint
    // followed it.
    const hv = sketch.constraints.find((c) => c.type === "horizontal");
    expect(hv.shapeIdx).toBe(1);
    expect(sketch.shapes[1]).toMatchObject({ x1: 0, y1: 5 });

    // Exactly one pattern now (the old single-copy one was removed), with the
    // new count and two copies translated by 10 and 20 in X.
    const pat = sketch.constraints.filter(
      (c) => c.type === "rectangularPattern",
    );
    expect(pat).toHaveLength(2);
    expect(pat.every((c) => c.countX === 3)).toBe(true);
    const copies = pat
      .map((c) => sketch.shapes[c.shapeIdx])
      .sort((a, b) => a.x1 - b.x1);
    expect(copies[0]).toMatchObject({ x1: 10, x2: 12 });
    expect(copies[1]).toMatchObject({ x1: 20, x2: 22 });
  });

  it("deleting an unrelated shape reindexes a pattern constraint (no corruption)", () => {
    // A leading unrelated line at 0, source at 1, its copy at 2. Deleting the
    // unrelated line shifts source 1→0 and copy 2→1; the pattern constraint's
    // origIdx/shapeIdx must follow (the old per-type delete logic left these
    // untouched and corrupted the pattern).
    const store = makeStore([
      {
        id: 1,
        type: "sketch",
        shapes: [L(0, 9, 2, 9), L(0, 0, 2, 0), L(10, 0, 12, 0)],
        constraints: [
          {
            type: "rectangularPattern",
            shapeIdx: 2,
            origIdx: 1,
            i: 1,
            j: 0,
            dx: 10,
            dy: 0,
            countX: 2,
            countY: 1,
          },
        ],
      },
    ]);
    store.getState().deleteSketchShapes(1, [0]);
    const sketch = store.getState().items.find((i) => i.id === 1);
    expect(sketch.shapes).toHaveLength(2);
    const pat = sketch.constraints.find((c) => c.type === "rectangularPattern");
    expect(pat).toMatchObject({ origIdx: 0, shapeIdx: 1 });
  });

  it("editing to a 1x1 grid removes the pattern entirely", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginRectangularPatternEdit(1, 0);
    store.getState().setRectangularPatternCountX(1); // 1x1 → no copies
    store.getState().confirmRectangularPattern(1);

    const sketch = store.getState().items.find((i) => i.id === 1);
    // Source + unrelated line remain; the copy is gone.
    expect(sketch.shapes).toHaveLength(2);
    expect(
      sketch.constraints.some((c) => c.type === "rectangularPattern"),
    ).toBe(false);
    expect(
      sketch.constraints.find((c) => c.type === "horizontal").shapeIdx,
    ).toBe(1);
  });
});
