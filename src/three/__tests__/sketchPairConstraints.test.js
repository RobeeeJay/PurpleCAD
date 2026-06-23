// Parallel / colinear / tangent two-shape constraints resolve through the solver.

import { describe, it, expect } from "vitest";
import { solveConstraints } from "../sketchSolver.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const circle = (cx, cy, r) => ({ type: "circle", cx, cy, r });
const dir = (l) => ({ x: l.x2 - l.x1, y: l.y2 - l.y1 });
const sinAngle = (a, b) => {
  const da = dir(a),
    db = dir(b);
  const la = Math.hypot(da.x, da.y),
    lb = Math.hypot(db.x, db.y);
  return (da.x * db.y - da.y * db.x) / (la * lb);
};
const distPointLine = (cx, cy, ln) => {
  const dx = ln.x2 - ln.x1,
    dy = ln.y2 - ln.y1,
    len = Math.hypot(dx, dy);
  return Math.abs((cx - ln.x1) * dy - (cy - ln.y1) * dx) / len;
};

describe("pair constraints", () => {
  it("parallel makes two lines parallel", () => {
    const { shapes, ok } = solveConstraints(
      [line(0, 0, 4, 0), line(0, 2, 4, 3)],
      [{ type: "parallel", shapeAIdx: 0, shapeBIdx: 1 }],
    );
    expect(ok).toBe(true);
    expect(Math.abs(sinAngle(shapes[0], shapes[1]))).toBeLessThan(0.02);
  });

  it("colinear makes two lines parallel AND on the same line", () => {
    const { shapes, ok } = solveConstraints(
      [line(0, 0, 4, 0), line(6, 1, 10, 1.5)],
      [{ type: "colinear", shapeAIdx: 0, shapeBIdx: 1 }],
    );
    expect(ok).toBe(true);
    expect(Math.abs(sinAngle(shapes[0], shapes[1]))).toBeLessThan(0.02);
    // B's start must lie on A's (infinite) line.
    expect(distPointLine(shapes[1].x1, shapes[1].y1, shapes[0])).toBeLessThan(
      0.02,
    );
  });

  it("tangent sets a line's distance to a circle equal to the radius", () => {
    const { shapes, ok } = solveConstraints(
      [line(0, 0, 4, 0), circle(2, 3, 2)],
      [{ type: "tangent", shapeAIdx: 0, shapeBIdx: 1 }],
    );
    expect(ok).toBe(true);
    const c = shapes[1];
    expect(distPointLine(c.cx, c.cy, shapes[0])).toBeCloseTo(c.r, 1);
  });

  it("tangent sets two circles' centre distance to the radius sum", () => {
    const { shapes, ok } = solveConstraints(
      [circle(0, 0, 2), circle(5, 0, 2)],
      [{ type: "tangent", shapeAIdx: 0, shapeBIdx: 1 }],
    );
    expect(ok).toBe(true);
    const [a, b] = shapes;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    // External tangency: centre distance ≈ r1 + r2 (started at 5, target 4).
    expect(d).toBeCloseTo(a.r + b.r, 1);
  });
});
