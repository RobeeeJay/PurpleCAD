// Circular pattern: rotating a shape by 360°/count around a centre point is an
// exact isometry, so `rotateShapeGeometry` should reproduce the original after
// `count` repeated applications, and `applyCircularPatternConstraints` should
// keep copies live-following their original + centre.

import { describe, it, expect } from "vitest";
import {
  rotatePoint,
  rotateShapeGeometry,
  applyCircularPatternConstraints,
} from "../sketchCircularPattern.js";

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

describe("rotatePoint", () => {
  it("rotates 90° around the origin", () => {
    const p = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(near(p.x, 0)).toBe(true);
    expect(near(p.y, 1)).toBe(true);
  });

  it("rotates around an arbitrary centre", () => {
    const p = rotatePoint({ x: 2, y: 1 }, { x: 1, y: 1 }, Math.PI);
    expect(near(p.x, 0)).toBe(true);
    expect(near(p.y, 1)).toBe(true);
  });
});

describe("rotateShapeGeometry", () => {
  it("rotates a line's endpoints around the centre", () => {
    const line = { type: "line", x1: 1, y1: 0, x2: 2, y2: 0 };
    const rotated = rotateShapeGeometry(line, { x: 0, y: 0 }, Math.PI / 2);
    expect(near(rotated.x1, 0) && near(rotated.y1, 1)).toBe(true);
    expect(near(rotated.x2, 0) && near(rotated.y2, 2)).toBe(true);
  });

  it("rotates a circle's centre and preserves its radius", () => {
    const circle = { type: "circle", cx: 1, cy: 0, r: 0.5 };
    const rotated = rotateShapeGeometry(circle, { x: 0, y: 0 }, Math.PI / 2);
    expect(near(rotated.cx, 0) && near(rotated.cy, 1)).toBe(true);
    expect(rotated.r).toBe(0.5);
  });

  it("rotates an arc's centre and adds the angle to start/end", () => {
    const arc = {
      type: "arc",
      cx: 1,
      cy: 0,
      r: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const rotated = rotateShapeGeometry(arc, { x: 0, y: 0 }, Math.PI / 2);
    expect(near(rotated.cx, 0) && near(rotated.cy, 1)).toBe(true);
    expect(near(rotated.startAngle, Math.PI / 2)).toBe(true);
    expect(near(rotated.endAngle, Math.PI)).toBe(true);
  });

  it("applying the rotation `count` times returns to the original", () => {
    const line = { type: "line", x1: 3, y1: 1, x2: 5, y2: 4 };
    const center = { x: 0, y: 0 };
    const count = 6;
    let cur = line;
    for (let i = 0; i < count; i++) {
      cur = rotateShapeGeometry(cur, center, (2 * Math.PI) / count);
    }
    expect(near(cur.x1, line.x1) && near(cur.y1, line.y1)).toBe(true);
    expect(near(cur.x2, line.x2) && near(cur.y2, line.y2)).toBe(true);
  });
});

describe("applyCircularPatternConstraints", () => {
  it("recomputes the copy as a rotation of the original around the centre shape's point", () => {
    // shapes[0] is the centre (a point shape via a zero-length line's start),
    // shapes[1] is the original, shapes[2] is the copy (1 of 4 around shapes[0]).
    const shapes = [
      { type: "circle", cx: 0, cy: 0, r: 0.1 }, // centre shape: "center" -> (0,0)
      { type: "line", x1: 1, y1: 0, x2: 2, y2: 0 },
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 0 }, // stale copy, recomputed below
    ];
    const constraints = [
      {
        type: "circularPattern",
        shapeIdx: 2,
        origIdx: 1,
        centerShapeIdx: 0,
        centerPointKey: "center",
        count: 4,
        index: 1,
      },
    ];
    const out = applyCircularPatternConstraints(shapes, constraints);
    // index 1 of 4 -> 90° rotation
    expect(near(out[2].x1, 0) && near(out[2].y1, 1)).toBe(true);
    expect(near(out[2].x2, 0) && near(out[2].y2, 2)).toBe(true);
  });

  it("follows the original when it moves", () => {
    const shapes = [
      { type: "circle", cx: 0, cy: 0, r: 0.1 },
      { type: "line", x1: 1, y1: 0, x2: 3, y2: 0 },
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 0 },
    ];
    const constraints = [
      {
        type: "circularPattern",
        shapeIdx: 2,
        origIdx: 1,
        centerShapeIdx: 0,
        centerPointKey: "center",
        count: 4,
        index: 1,
      },
    ];
    const out = applyCircularPatternConstraints(shapes, constraints);
    expect(near(out[2].x1, 0) && near(out[2].y1, 1)).toBe(true);
    expect(near(out[2].x2, 0) && near(out[2].y2, 3)).toBe(true);
  });

  it("returns the same array reference when there are no circularPattern constraints", () => {
    const shapes = [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 0 }];
    const out = applyCircularPatternConstraints(shapes, [
      { type: "mirror", shapeIdx: 0, origIdx: 0, lineIdx: 0 },
    ]);
    expect(out).toBe(shapes);
  });
});
