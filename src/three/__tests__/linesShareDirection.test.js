// A gap can only be dimensioned between lines the constraints keep parallel, or
// the "distance" would change along their length as the sketch moves.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({ useStore: { getState: () => ({}) } }));

import {
  lineGapInput,
  linesShareDirection,
  parallelGap,
} from "../sketchModifyActions.js";

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

// Lines that are parallel on screen but not held so by any constraint are
// what users draw (two sides placed by eye, a pair snapped at the same angle):
// the distance tool used to ignore them and open a length on the second line.
// They get the gap too, with a parallel constraint added, so it stays a gap.
describe("which pairs the distance tool takes as a gap", () => {
  const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
  const deg = (d) => (d * Math.PI) / 180;
  const at = (angle, y) =>
    line(0, y, 10 * Math.cos(deg(angle)), y + 10 * Math.sin(deg(angle)));

  it("takes a pair held parallel, adding nothing", () => {
    const shapes = [line(0, 0, 4, 0), line(0, 3, 4, 3)];
    expect(parallelGap(shapes, [h(0), h(1)], 0, 1)).toEqual({
      holdParallel: false,
    });
  });

  it("takes a pair that only looks parallel, and asks for a parallel constraint", () => {
    expect(parallelGap([at(30, 0), at(30, 3)], [], 0, 1)).toEqual({
      holdParallel: true,
    });
    expect(parallelGap([at(30, 0), at(30.9, 3)], [], 0, 1)).toEqual({
      holdParallel: true,
    });
  });

  it("leaves a pair more than a degree apart to the length of each line", () => {
    expect(parallelGap([at(30, 0), at(31.5, 3)], [], 0, 1)).toBe(null);
    expect(parallelGap([at(0, 0), at(90, 3)], [], 0, 1)).toBe(null);
  });

  it("takes lines drawn in opposite directions", () => {
    const shapes = [line(0, 0, 4, 0), line(4, 3, 0, 3)];
    expect(parallelGap(shapes, [], 0, 1)).toEqual({ holdParallel: true });
  });

  it("refuses a pair held at an angle, however close it is drawn", () => {
    const shapes = [line(0, 0, 4, 0), line(0, 3, 4, 3)];
    const held = [{ type: "angleDimension", shapeAIdx: 0, shapeBIdx: 1 }];
    expect(parallelGap(shapes, held, 0, 1)).toBe(null);
  });

  it("carries the flag on the gap input", () => {
    const shapes = [line(0, 0, 4, 0), line(0, 3, 4, 3)];
    expect(lineGapInput(shapes, 0, 1, true).holdParallel).toBe(true);
    expect(lineGapInput(shapes, 0, 1).holdParallel).toBeUndefined();
  });
});
