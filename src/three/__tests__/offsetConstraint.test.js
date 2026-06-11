// Parametric offset: an `offset` constraint keeps a copied line parallel to its
// original at a fixed perpendicular distance; coincident constraints reconnect
// the copies at shared corners, so corner positions (and line lengths) settle to
// the new intersections.

import { describe, it, expect } from "vitest";
import { solveConstraints } from "../sketchSolver.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const near = (a, b, t = 1e-3) => Math.abs(a - b) < t;
// Pin the given original line indices (so only the copies move), like the
// offsetSketchGeometry reducer does.
const pin = (...idxs) => {
  const f = new Set();
  for (const i of idxs)
    for (const k of ["x1", "y1", "x2", "y2"]) f.add(`${i}:${k}`);
  return f;
};

describe("offset constraint", () => {
  it("offsets an L of two lines and reconnects the corner", () => {
    // Originals: L0 (0,0)->(10,0) horizontal, L1 (10,0)->(10,10) vertical,
    // sharing the corner (10,0).  Offset 1 unit to the right normal:
    //   L0' starts at y=-1, L1' at x=11.  The new corner is their
    //   intersection (11,-1), so both copies stretch to meet there.
    const shapes = [
      line(0, 0, 10, 0),
      line(10, 0, 10, 10),
      line(0, -1, 10, -1), // L0' initial
      line(11, 0, 11, 10), // L1' initial
    ];
    const constraints = [
      { type: "horizontal", shapeIdx: 0 },
      { type: "vertical", shapeIdx: 1 },
      {
        type: "coincident",
        shapeAIdx: 0,
        pointA: "end",
        shapeBIdx: 1,
        pointB: "start",
      },
      { type: "offset", shapeIdx: 2, origIdx: 0, distance: "10" }, // 10mm = 1 unit
      { type: "offset", shapeIdx: 3, origIdx: 1, distance: "10" },
      {
        type: "coincident",
        shapeAIdx: 2,
        pointA: "end",
        shapeBIdx: 3,
        pointB: "start",
      },
    ];
    const { shapes: s, ok } = solveConstraints(shapes, constraints, {
      variables: {},
      fixed: pin(0, 1),
    });
    expect(ok).toBe(true);
    // Originals untouched.
    expect(near(s[0].x2, 10) && near(s[0].y2, 0)).toBe(true);
    // L0' stays horizontal at y=-1; L1' stays vertical at x=11.
    expect(near(s[2].y1, -1) && near(s[2].y2, -1)).toBe(true);
    expect(near(s[3].x1, 11) && near(s[3].x2, 11)).toBe(true);
    // The copies meet at the new corner (11,-1).
    expect(near(s[2].x2, 11) && near(s[2].y2, -1)).toBe(true);
    expect(near(s[3].x1, 11) && near(s[3].y1, -1)).toBe(true);
  });

  it("a single offset line stays parallel at the set distance", () => {
    const shapes = [line(0, 0, 10, 0), line(0, -1, 10, -1)];
    const constraints = [
      { type: "horizontal", shapeIdx: 0 },
      { type: "offset", shapeIdx: 1, origIdx: 0, distance: "20" }, // 2 units
    ];
    const { shapes: s, ok } = solveConstraints(shapes, constraints, {
      variables: {},
      fixed: pin(0),
    });
    expect(ok).toBe(true);
    // Parallel (horizontal) and 2 units below.
    expect(near(s[1].y1, s[1].y2)).toBe(true);
    expect(near((s[1].y1 + s[1].y2) / 2, -2)).toBe(true);
  });
});
