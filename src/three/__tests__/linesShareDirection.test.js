// A gap can only be dimensioned between lines the constraints keep parallel, or
// the "distance" would change along their length as the sketch moves.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({ useStore: { getState: () => ({}) } }));

import { lineGapInput, linesShareDirection } from "../sketchModifyActions.js";

const parallel = (a, b) => ({ type: "parallel", shapeAIdx: a, shapeBIdx: b });
const h = (i) => ({ type: "horizontal", shapeIdx: i });
const v = (i) => ({ type: "vertical", shapeIdx: i });

describe("lines held parallel by constraints", () => {
  it("includes two lines with a parallel constraint between them", () => {
    expect(linesShareDirection([parallel(1, 0)], 0, 1)).toBe(true);
  });

  it("includes two lines that are both horizontal, or both vertical", () => {
    expect(linesShareDirection([h(0), h(3)], 0, 3)).toBe(true);
    expect(linesShareDirection([v(0), v(3)], 3, 0)).toBe(true);
  });

  it("includes two lines each parallel to a third", () => {
    expect(linesShareDirection([parallel(0, 2), parallel(1, 2)], 0, 1)).toBe(
      true,
    );
  });

  it("includes a line parallel to one sharing the other's axis", () => {
    expect(linesShareDirection([parallel(0, 1), h(1), h(2)], 0, 2)).toBe(true);
  });

  it("includes a colinear pair, which is parallel too", () => {
    expect(
      linesShareDirection(
        [{ type: "colinear", shapeAIdx: 0, shapeBIdx: 1 }],
        0,
        1,
      ),
    ).toBe(true);
  });

  it("excludes a horizontal line and a vertical one", () => {
    expect(linesShareDirection([h(0), v(1)], 0, 1)).toBe(false);
  });

  it("excludes lines that belong to separate parallel pairs", () => {
    expect(linesShareDirection([parallel(0, 1), parallel(2, 3)], 0, 2)).toBe(
      false,
    );
  });

  it("excludes lines with no constraints, even if they look parallel", () => {
    expect(linesShareDirection([], 0, 1)).toBe(false);
  });
});

describe("the gap input for two parallel lines", () => {
  it("seeds the perpendicular distance and moves the first line first", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 4 },
      { type: "line", x1: 3, y1: 0, x2: 7, y2: 4 },
    ];
    const di = lineGapInput(shapes, 0, 1);
    expect(di.pointLine).toEqual({
      pointShapeIdx: 0,
      pointKey: "start",
      lineShapeIdx: 1,
    });
    expect(di.defaultDistance, `gap ${di.defaultDistance}`).toBeCloseTo(
      3 / Math.SQRT2,
      9,
    );
  });
});
