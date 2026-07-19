// The Mirror tool may reference mirror-DERIVED geometry (a mirror copy) as a
// source, so a copy can be mirrored across a second line.  The new mirror's
// constraint is appended after the source's, so applyMirrorConstraints resolves
// the copy before the copy-of-a-copy — and moving the ORIGINAL propagates
// through both.

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

describe("mirror a mirror copy across a second line", () => {
  // lineY (idx 0, the Y axis), source (1) at x=1..3, its X-mirror copy (2) at
  // x=-1..-3, and a second axis lineX (3, the X axis).
  const makeSketch = () => ({
    id: 1,
    type: "sketch",
    shapes: [L(0, -5, 0, 5), L(1, 2, 3, 2), L(-1, 2, -3, 2), L(-5, 0, 5, 0)],
    constraints: [{ type: "mirror", shapeIdx: 2, origIdx: 1, lineIdx: 0 }],
  });

  it("confirm creates a copy of the copy, reflected across the second line", () => {
    const store = makeStore([makeSketch()]);
    const s = store.getState();
    s.startMirrorTool();
    s.setMirrorLine(3); // the X axis
    s.toggleMirrorShape(2); // the DERIVED copy
    store.getState().confirmMirror(1);

    const item = store.getState().items[0];
    // A fourth shape (idx 4) was created, mirror of copy(2) across lineX(3):
    // copy(2) is at y=2, so its X-reflection is at y=-2.
    expect(item.shapes).toHaveLength(5);
    const c = item.constraints.find((k) => k.shapeIdx === 4);
    expect(c).toMatchObject({ type: "mirror", origIdx: 2, lineIdx: 3 });
    expect(item.shapes[4].y1).toBeCloseTo(-2, 6);
    expect(item.shapes[4].x1).toBeCloseTo(-1, 6);
  });

  it("moving the ORIGINAL propagates through both mirrors", () => {
    const store = makeStore([makeSketch()]);
    const s = store.getState();
    s.startMirrorTool();
    s.setMirrorLine(3);
    s.toggleMirrorShape(2);
    store.getState().confirmMirror(1);

    // Drag the original (idx 1) up by 3 (y 2 -> 5).
    store
      .getState()
      .updateSketchShape(1, 1, { type: "line", x1: 1, y1: 5, x2: 3, y2: 5 });
    const item = store.getState().items[0];
    // copy(2) = X-mirror of original -> y stays 5, x negated.
    expect(item.shapes[2].y1).toBeCloseTo(5, 6);
    // copy-of-copy(4) = Y(X-axis) mirror of copy(2) -> y negated to -5.
    expect(item.shapes[4].y1).toBeCloseTo(-5, 6);
    expect(item.shapes[4].x1).toBeCloseTo(-1, 6);
  });
});
