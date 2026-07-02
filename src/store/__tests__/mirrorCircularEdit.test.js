// Double-clicking a mirror or circularPattern constraint re-opens its tool to
// edit the operation; confirming replaces the old copies (reindexing every
// surviving constraint) rather than appending a second mirror/pattern.

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

describe("mirror edit", () => {
  // Mirror line at index 0 (the Y axis), source at 1, its reflected copy at 2,
  // plus an unrelated horizontal line at 3.
  const makeSketch = () => ({
    id: 1,
    type: "sketch",
    shapes: [L(0, -5, 0, 5), L(1, 0, 3, 0), L(-1, 0, -3, 0), L(0, 9, 2, 9)],
    constraints: [
      { type: "mirror", shapeIdx: 2, origIdx: 1, lineIdx: 0 },
      { type: "horizontal", shapeIdx: 3 },
    ],
  });

  it("seeds the tool state from the double-clicked constraint", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginMirrorEdit(1, 0);
    const st = store.getState();
    expect(st.activeSketchTool).toBe("mirror");
    expect(st.sketchMirrorState).toMatchObject({
      lineIdx: 0,
      shapeIndices: [1],
      editCopyIndices: [2],
    });
  });

  it("replaces the copy and reindexes other constraints on confirm", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginMirrorEdit(1, 0);
    store.getState().confirmMirror(1);

    const sketch = store.getState().items.find((i) => i.id === 1);
    // line(0), source(1), unrelated(was 3 → 2), fresh copy(3).
    expect(sketch.shapes).toHaveLength(4);
    const mir = sketch.constraints.filter((c) => c.type === "mirror");
    expect(mir).toHaveLength(1);
    expect(mir[0]).toMatchObject({ origIdx: 1, lineIdx: 0 });
    // The fresh copy is the reflection of the source across x=0.
    expect(sketch.shapes[mir[0].shapeIdx]).toMatchObject({
      x1: -1,
      x2: -3,
    });
    // The unrelated horizontal line followed its reindex (3 → 2).
    const hv = sketch.constraints.find((c) => c.type === "horizontal");
    expect(hv.shapeIdx).toBe(2);
    expect(sketch.shapes[2]).toMatchObject({ y1: 9 });
  });
});

describe("circular pattern edit", () => {
  // Centre point at index 0, source at 1, two rotated copies at 2 & 3 (count 3).
  const makeSketch = () => ({
    id: 1,
    type: "sketch",
    shapes: [
      { type: "point", x: 0, y: 0 },
      L(2, 0, 3, 0),
      L(-1, 1.7, -1.5, 2.6),
      L(-1, -1.7, -1.5, -2.6),
    ],
    constraints: [
      {
        type: "circularPattern",
        shapeIdx: 2,
        origIdx: 1,
        centerShapeIdx: 0,
        centerPointKey: "p",
        count: 3,
        index: 1,
      },
      {
        type: "circularPattern",
        shapeIdx: 3,
        origIdx: 1,
        centerShapeIdx: 0,
        centerPointKey: "p",
        count: 3,
        index: 2,
      },
    ],
  });

  it("seeds the tool state from the double-clicked constraint", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginCircularPatternEdit(1, 0);
    const st = store.getState();
    expect(st.activeSketchTool).toBe("circularPattern");
    expect(st.sketchCircularPatternState).toMatchObject({
      centerShapeIdx: 0,
      centerPointKey: "p",
      count: 3,
      shapeIndices: [1],
      editCopyIndices: [2, 3],
    });
  });

  it("a higher count yields more copies, replacing the old ones", () => {
    const store = makeStore([makeSketch()]);
    store.getState().beginCircularPatternEdit(1, 0);
    store.getState().setCircularPatternCount(5); // 3 → 5 instances
    store.getState().confirmCircularPattern(1);

    const sketch = store.getState().items.find((i) => i.id === 1);
    // centre(0) + source(1) + (count-1)=4 fresh copies.
    expect(sketch.shapes).toHaveLength(6);
    const pat = sketch.constraints.filter((c) => c.type === "circularPattern");
    expect(pat).toHaveLength(4);
    expect(pat.every((c) => c.count === 5)).toBe(true);
  });
});
