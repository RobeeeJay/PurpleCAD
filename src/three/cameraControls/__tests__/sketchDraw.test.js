// axisAlignLine: a freshly-drawn near-axis line snaps onto the axis and gets a
// horizontal/vertical constraint, but only by moving an un-pinned endpoint.

import { describe, it, expect, vi } from "vitest";

// sketchDraw pulls THREE + sceneObjects at import; stub the heavy deps so the
// pure helper can be exercised in node.
vi.mock("../../../store", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../sceneObjects.js", () => ({
  buildSketchShape: () => null,
  getSketchShapePoints: () => [],
  sketchDimText: () => "",
  snapUnitToIntervalMm: (v) => v,
}));
vi.mock("../theme.js", () => ({ SKETCH_DRAW_PREVIEW_COLOR: 0 }));

import { axisAlignLine } from "../sketchDraw.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

describe("axisAlignLine", () => {
  it("adds a horizontal constraint and levels a near-horizontal line", () => {
    const r = axisAlignLine(line(0, 0, 10, 0.05), 3, false, false);
    expect(r.constraint).toEqual({ type: "horizontal", shapeIdx: 3 });
    expect(r.shape.y2).toBe(0); // free end snapped onto the start's y
  });

  it("adds a vertical constraint and levels a near-vertical line", () => {
    const r = axisAlignLine(line(0, 0, 0.05, 10), 1, false, false);
    expect(r.constraint).toEqual({ type: "vertical", shapeIdx: 1 });
    expect(r.shape.x2).toBe(0);
  });

  it("moves the start when the end is pinned to existing geometry", () => {
    // end snapped → keep (x2,y2), bring the start onto the axis instead
    const r = axisAlignLine(line(0, 0.05, 10, 0), 2, false, true);
    expect(r.constraint.type).toBe("horizontal");
    expect(r.shape.y1).toBe(0); // start moved to the end's y
    expect(r.shape.y2).toBe(0);
  });

  it("does nothing when both endpoints are pinned", () => {
    expect(axisAlignLine(line(0, 0, 10, 0), 0, true, true)).toBeNull();
  });

  it("does nothing for a clearly diagonal line", () => {
    expect(axisAlignLine(line(0, 0, 10, 10), 0, false, false)).toBeNull();
  });

  it("ignores degenerate zero-length lines", () => {
    expect(axisAlignLine(line(5, 5, 5, 5), 0, false, false)).toBeNull();
  });
});
