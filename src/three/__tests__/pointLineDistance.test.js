// Point-to-line distance dimension: perpendicular distance from a point
// (standalone shape or a keyed point of another shape) to an infinite line —
// solver residual, satisfied-check, and the fast drag-follow path.
import { describe, it, expect } from "vitest";
import { solveConstraints } from "../sketchSolver.js";
import {
  allConstraintsSatisfied,
  enforceConstraints,
} from "../sketchConstraints.js";

const fixLine = (idx) =>
  new Set([`${idx}:x1`, `${idx}:y1`, `${idx}:x2`, `${idx}:y2`]);

describe("solver", () => {
  it("moves the point to the set perpendicular distance, keeping its side", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 1, y: 1.5 }, // above the line
    ];
    const constraints = [
      // Legacy numeric distances are scene units (like "distance").
      {
        type: "pointLineDistance",
        pointShapeIdx: 1,
        lineShapeIdx: 0,
        distance: 2,
      },
    ];
    const { shapes: solved, ok } = solveConstraints(shapes, constraints, {
      fixed: fixLine(0),
    });
    expect(ok).toBe(true);
    expect(solved[1].y).toBeCloseTo(2, 3); // stayed above
    expect(allConstraintsSatisfied(solved, constraints)).toBe(true);
  });

  it("a line ENDPOINT works as the measured point", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "line", x1: 1, y1: 0.8, x2: 5, y2: 4 },
    ];
    const constraints = [
      {
        type: "pointLineDistance",
        pointShapeIdx: 1,
        pointKey: "start",
        lineShapeIdx: 0,
        distance: 1.5,
      },
    ];
    const { shapes: solved, ok } = solveConstraints(shapes, constraints, {
      fixed: fixLine(0),
    });
    expect(ok).toBe(true);
    expect(solved[1].y1).toBeCloseTo(1.5, 3);
  });

  it("mm formula strings resolve like other dimensions", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 1, y: 2.9 },
    ];
    const constraints = [
      {
        type: "pointLineDistance",
        pointShapeIdx: 1,
        lineShapeIdx: 0,
        distance: "30", // 30 mm = 3 scene units
      },
    ];
    const { shapes: solved, ok } = solveConstraints(shapes, constraints, {
      fixed: fixLine(0),
    });
    expect(ok).toBe(true);
    expect(solved[1].y).toBeCloseTo(3, 3);
  });
});

describe("satisfied-check", () => {
  const line = { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 };
  const c = (d) => [
    {
      type: "pointLineDistance",
      pointShapeIdx: 1,
      lineShapeIdx: 0,
      distance: d,
    },
  ];
  it("accepts the right distance on either side, rejects the wrong one", () => {
    expect(
      allConstraintsSatisfied([line, { type: "point", x: 3, y: 2 }], c(2)),
    ).toBe(true);
    expect(
      allConstraintsSatisfied([line, { type: "point", x: 3, y: -2 }], c(2)),
    ).toBe(true);
    expect(
      allConstraintsSatisfied([line, { type: "point", x: 3, y: 1.2 }], c(2)),
    ).toBe(false);
  });
});

describe("fast drag path", () => {
  it("the point rides along when the line moves, preserving distance + side", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 2, y: 2 },
    ];
    const constraints = [
      {
        type: "pointLineDistance",
        pointShapeIdx: 1,
        lineShapeIdx: 0,
        distance: 2,
      },
    ];
    const moved = { type: "line", x1: 0, y1: 1, x2: 4, y2: 1 };
    const updated = enforceConstraints(shapes, constraints, 0, moved);
    const pt = updated.get(1);
    expect(pt).toBeTruthy();
    expect(pt.y).toBeCloseTo(3, 9); // followed up by the same offset, same side
    expect(pt.x).toBeCloseTo(2, 9);
  });

  it("a below-the-line point stays below", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 2, y: -2 },
    ];
    const constraints = [
      {
        type: "pointLineDistance",
        pointShapeIdx: 1,
        lineShapeIdx: 0,
        distance: 2,
      },
    ];
    const moved = { type: "line", x1: 0, y1: -0.5, x2: 4, y2: -0.5 };
    const updated = enforceConstraints(shapes, constraints, 0, moved);
    expect(updated.get(1).y).toBeCloseTo(-2.5, 9);
  });
});
