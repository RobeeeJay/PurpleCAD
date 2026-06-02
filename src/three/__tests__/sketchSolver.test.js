import { describe, it, expect } from "vitest";
import { solveConstraints, fieldsForPoint } from "../sketchSolver.js";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const coin = (ai, pa, bi, pb) => ({
  type: "coincident",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
});
const ang = (ai, bi) => ({
  type: "angle",
  shapeAIdx: ai,
  pointA: "end",
  shapeBIdx: bi,
  pointB: "start",
  angle: 90,
});
const fixed = (ai, pa, bi, pb, d) => ({
  type: "distance",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
  distance: d,
});

// Unit square, CW: top, right, bottom, left, with coincident corners and a 90°
// angle at each corner (the rect tool's constraint set).
function squareWithAngles(extra = []) {
  const shapes = [L(0, 1, 1, 1), L(1, 1, 1, 0), L(1, 0, 0, 0), L(0, 0, 0, 1)];
  const constraints = [
    coin(0, "end", 1, "start"),
    coin(1, "end", 2, "start"),
    coin(2, "end", 3, "start"),
    coin(3, "end", 0, "start"),
    ang(0, 1),
    ang(1, 2),
    ang(2, 3),
    ang(3, 0),
    ...extra,
  ];
  return { shapes, constraints };
}

const sideLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

describe("solveConstraints", () => {
  it("resizes one side of an angle-constrained square into a clean rectangle", () => {
    const { shapes, constraints } = squareWithAngles([
      fixed(0, "start", 0, "end", 2), // top length 2
    ]);
    const { shapes: r, ok } = solveConstraints(shapes, constraints);
    expect(ok).toBe(true);
    // Top & bottom = 2, sides = 1 (height preserved); all corners stay joined.
    expect(sideLen(r[0])).toBeCloseTo(2, 4);
    expect(sideLen(r[2])).toBeCloseTo(2, 4);
    expect(sideLen(r[1])).toBeCloseTo(1, 4);
    expect(sideLen(r[3])).toBeCloseTo(1, 4);
    // Right angle at TR: top horizontal-ish ⟂ right.
    const dot =
      (r[0].x2 - r[0].x1) * (r[1].x2 - r[1].x1) +
      (r[0].y2 - r[0].y1) * (r[1].y2 - r[1].y1);
    expect(dot).toBeCloseTo(0, 3);
  });

  it("anchors the dimension's reference point when it is fixed", () => {
    const { shapes, constraints } = squareWithAngles([
      fixed(0, "start", 0, "end", 2),
    ]);
    const fixedSet = new Set(
      fieldsForPoint(shapes[0], "start").map((f) => `0:${f}`),
    );
    const { shapes: r, ok } = solveConstraints(shapes, constraints, {
      fixed: fixedSet,
    });
    expect(ok).toBe(true);
    // top.start (the anchored reference) hasn't moved.
    expect(r[0].x1).toBeCloseTo(0, 5);
    expect(r[0].y1).toBeCloseTo(1, 5);
    // top.end is 2 away from it.
    expect(Math.hypot(r[0].x2 - 0, r[0].y2 - 1)).toBeCloseTo(2, 4);
  });

  it("resizes a ROTATED square just as cleanly (angles are rotation-invariant)", () => {
    // Rotate the unit square 30° about the origin, then dimension a side to 2.
    const a = Math.PI / 6,
      ca = Math.cos(a),
      sa = Math.sin(a);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const base = squareWithAngles([fixed(0, "start", 0, "end", 2)]);
    const shapes = base.shapes.map((s) => {
      const [x1, y1] = rot(s.x1, s.y1);
      const [x2, y2] = rot(s.x2, s.y2);
      return { type: "line", x1, y1, x2, y2 };
    });
    const { shapes: r, ok } = solveConstraints(shapes, base.constraints);
    expect(ok).toBe(true);
    expect(sideLen(r[0])).toBeCloseTo(2, 4);
    expect(sideLen(r[1])).toBeCloseTo(1, 4);
  });

  it("reports failure for a contradictory system", () => {
    // The two endpoints are coincident (distance 0) AND constrained to distance
    // 5 — impossible, so the solver must report not-ok.
    const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0)];
    const constraints = [
      coin(0, "end", 1, "start"),
      fixed(0, "end", 1, "start", 5),
    ];
    const { ok } = solveConstraints(shapes, constraints);
    expect(ok).toBe(false);
  });
});
