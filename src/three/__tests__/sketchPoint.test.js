// Standalone sketch point support: the shape helpers expose its coordinate as
// a snap point / draggable node, and the solver treats {x,y} as variables so an
// onLine constraint keeps the point riding its line.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));
vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import {
  getShapePoint,
  getSnapPoints,
  moveShapePoint,
} from "../sceneObjects/sketchShapes.js";
import { solveConstraints } from "../sketchSolver.js";

const P = (x, y) => ({ type: "point", x, y });

describe("point shape helpers", () => {
  it("reports its coordinate as a snap point and via getShapePoint", () => {
    expect(getShapePoint(P(3, 4), "p")).toEqual({ x: 3, y: 4 });
    expect(getSnapPoints([P(3, 4)])).toEqual([
      { x: 3, y: 4, shapeIdx: 0, pointKey: "p" },
    ]);
  });

  it("moves to a new position", () => {
    expect(moveShapePoint(P(3, 4), "p", { x: 7, y: 1 })).toEqual(P(7, 1));
  });
});

describe("onLine keeps a standalone point on its line", () => {
  it("pulls a point that's off the line back onto it", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 }, // horizontal line at y=0
      P(5, 5), // point 5 units above it
    ];
    const constraints = [
      { type: "onLine", pointShapeIdx: 1, pointKey: "p", lineShapeIdx: 0 },
    ];
    // Pin the line so only the point is free to move.
    const { shapes: out, ok } = solveConstraints(shapes, constraints, {
      fixed: new Set(["0:x1", "0:y1", "0:x2", "0:y2"]),
    });
    expect(ok).toBe(true);
    expect(out[1].type).toBe("point");
    // The point dropped onto the line (y → 0); it stays within the segment.
    expect(out[1].y).toBeCloseTo(0, 3);
    expect(out[1].x).toBeGreaterThan(0);
    expect(out[1].x).toBeLessThan(10);
    // The line stayed put (pinned softly, so within solver tolerance).
    expect(out[0].x1).toBeCloseTo(0, 6);
    expect(out[0].y1).toBeCloseTo(0, 6);
    expect(out[0].x2).toBeCloseTo(10, 6);
    expect(out[0].y2).toBeCloseTo(0, 6);
  });
});
