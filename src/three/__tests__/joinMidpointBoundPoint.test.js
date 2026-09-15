// Joining two points with the coincident tool, when a point is pinned to its
// own shape by a midpoint constraint.
//
// The real document behind this: two rectangles, each with a construction
// diagonal, each with a point held at that diagonal's midpoint. Making those
// two midpoints coincident used to move the POINT alone -- it tore off the
// rectangle it belonged to, and the sketch was left breaking its own midpoint
// constraint -- because the fast propagation rules cannot move a point that is
// pinned to its own shape, and the tool wrote the moved point regardless.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { solveJoinPoints } from "../sketchSolver.js";
import { allConstraintsSatisfied } from "../sketchConstraints.js";

const doc = JSON.parse(
  fs.readFileSync("test-files/broken-constraint.pcad", "utf8"),
);
const sketch = doc.history[1].instruction.item;
const variables = doc.variables;

// 22: the point held at the midpoint of the cable rectangle's diagonal (21).
// 15: the point held at the midpoint of the base rectangle's centre line (14).
const CABLE_MIDPOINT = 22;
const BASE_MIDPOINT = 15;
const CABLE_RECT = [17, 18, 19, 20];
const BASE_RECT = [0, 1, 2, 3];

const asPoint = (shapes, idx) => ({ x: shapes[idx].x, y: shapes[idx].y });
const corner = (shapes, idx) => ({ x: shapes[idx].x1, y: shapes[idx].y1 });

describe("coincident onto a point pinned to its own shape", () => {
  const shapes = sketch.shapes;
  const constraints = sketch.constraints;
  const join = () =>
    solveJoinPoints(
      shapes,
      constraints,
      { shapeIdx: CABLE_MIDPOINT, pointKey: "p" },
      { shapeIdx: BASE_MIDPOINT, pointKey: "p" },
      { variables },
    );

  it("carries the whole shape to the point, instead of tearing the point off", () => {
    const solved = join();
    expect(solved).not.toBeNull();
    const after = shapes.slice();
    solved.forEach((s, i) => (after[i] = s));

    const target = asPoint(shapes, BASE_MIDPOINT);
    const moved = asPoint(after, CABLE_MIDPOINT);
    expect(moved.x).toBeCloseTo(target.x, 6);
    expect(moved.y).toBeCloseTo(target.y, 6);

    // Every corner of the cable rectangle travels by the SAME offset as the
    // point: the rectangle moved as one piece and kept its shape.
    const dx = target.x - asPoint(shapes, CABLE_MIDPOINT).x;
    const dy = target.y - asPoint(shapes, CABLE_MIDPOINT).y;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(0.5); // a real move, not noise
    for (const idx of CABLE_RECT) {
      const was = corner(shapes, idx);
      const now = corner(after, idx);
      expect(now.x - was.x).toBeCloseTo(dx, 3);
      expect(now.y - was.y).toBeCloseTo(dy, 3);
    }
  });

  it("leaves the second pick, and everything hanging off it, where it was", () => {
    const after = shapes.slice();
    join().forEach((s, i) => (after[i] = s));
    for (const idx of BASE_RECT) {
      expect(corner(after, idx).x).toBeCloseTo(corner(shapes, idx).x, 6);
      expect(corner(after, idx).y).toBeCloseTo(corner(shapes, idx).y, 6);
    }
    expect(asPoint(after, BASE_MIDPOINT)).toEqual(
      asPoint(shapes, BASE_MIDPOINT),
    );
  });

  it("keeps every other constraint true, the midpoint ones included", () => {
    const after = shapes.slice();
    join().forEach((s, i) => (after[i] = s));
    const withJoin = constraints.concat([
      {
        type: "coincident",
        shapeAIdx: CABLE_MIDPOINT,
        pointA: "p",
        shapeBIdx: BASE_MIDPOINT,
        pointB: "p",
      },
    ]);
    expect(allConstraintsSatisfied(after, withJoin, variables)).toBe(true);
  });

  it("refuses a join nothing can satisfy, rather than moving geometry", () => {
    // Both points pinned to their own shapes AND to each other's lines: the
    // second point is also fixed where it is, so a contradictory distance
    // makes the join impossible.
    const impossible = constraints.concat([
      {
        type: "distance",
        shapeAIdx: CABLE_MIDPOINT,
        pointA: "p",
        shapeBIdx: BASE_MIDPOINT,
        pointB: "p",
        distance: "5",
      },
    ]);
    expect(
      solveJoinPoints(
        shapes,
        impossible,
        { shapeIdx: CABLE_MIDPOINT, pointKey: "p" },
        { shapeIdx: BASE_MIDPOINT, pointKey: "p" },
        { variables },
      ),
    ).toBeNull();
  });
});
