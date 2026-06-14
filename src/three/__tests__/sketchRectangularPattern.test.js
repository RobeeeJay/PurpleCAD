// Unit tests for the rectangular-pattern geometry helpers — the pure module
// behind the sketch Rectangular Pattern tool.  Translation is an exact
// isometry, so each shape type gets an exact translated copy (centres shift;
// radii / angles / rotation are unchanged).

import { describe, it, expect } from "vitest";
import {
  translateShapeGeometry,
  applyRectangularPatternConstraints,
} from "../sketchRectangularPattern.js";

describe("translateShapeGeometry", () => {
  it("translates a line by (dx, dy)", () => {
    const out = translateShapeGeometry(
      { type: "line", x1: 0, y1: 0, x2: 2, y2: 1 },
      10,
      -5,
    );
    expect(out).toEqual({ type: "line", x1: 10, y1: -5, x2: 12, y2: -4 });
  });

  it("shifts a circle's centre but keeps its radius", () => {
    const out = translateShapeGeometry(
      { type: "circle", cx: 1, cy: 1, r: 3 },
      4,
      4,
    );
    expect(out).toEqual({ type: "circle", cx: 5, cy: 5, r: 3 });
  });

  it("shifts an arc's centre, leaving radius and angles unchanged", () => {
    const out = translateShapeGeometry(
      { type: "arc", cx: 0, cy: 0, r: 2, startAngle: 0.5, endAngle: 2.1 },
      3,
      0,
    );
    expect(out).toEqual({
      type: "arc",
      cx: 3,
      cy: 0,
      r: 2,
      startAngle: 0.5,
      endAngle: 2.1,
    });
  });

  it("shifts an ellipse's centre, leaving radii and rotation unchanged", () => {
    const out = translateShapeGeometry(
      { type: "ellipse", cx: 0, cy: 0, rx: 2, ry: 1, rotation: 0.7 },
      -2,
      5,
    );
    expect(out).toEqual({
      type: "ellipse",
      cx: -2,
      cy: 5,
      rx: 2,
      ry: 1,
      rotation: 0.7,
    });
  });

  it("translates all four bezier control points", () => {
    const out = translateShapeGeometry(
      {
        type: "bezier",
        p0: { x: 0, y: 0 },
        p1: { x: 1, y: 2 },
        p2: { x: 3, y: 2 },
        p3: { x: 4, y: 0 },
      },
      1,
      1,
    );
    expect(out.p0).toEqual({ x: 1, y: 1 });
    expect(out.p3).toEqual({ x: 5, y: 1 });
  });

  it("preserves the dashed flag", () => {
    const out = translateShapeGeometry(
      { type: "line", x1: 0, y1: 0, x2: 1, y2: 0, dashed: true },
      1,
      0,
    );
    expect(out.dashed).toBe(true);
  });

  it("returns null for an unsupported shape type", () => {
    expect(
      translateShapeGeometry({ type: "point", x: 0, y: 0 }, 1, 1),
    ).toBeNull();
  });
});

describe("applyRectangularPatternConstraints", () => {
  // Original at index 0; one copy at index 1 offset by (i*dx, j*dy).
  const base = () => [
    { type: "line", x1: 0, y1: 0, x2: 1, y2: 0 },
    { type: "line", x1: 999, y1: 999, x2: 999, y2: 999 }, // stale copy
  ];
  const constraint = {
    type: "rectangularPattern",
    shapeIdx: 1,
    origIdx: 0,
    i: 2,
    j: 1,
    dx: 10,
    dy: 5,
    countX: 3,
    countY: 2,
  };

  it("recomputes a copy from its original and grid offset", () => {
    const out = applyRectangularPatternConstraints(base(), [constraint]);
    // i*dx = 20, j*dy = 5.
    expect(out[1]).toEqual({ type: "line", x1: 20, y1: 5, x2: 21, y2: 5 });
  });

  it("follows the original live when it moves", () => {
    const shapes = base();
    shapes[0] = { type: "line", x1: 1, y1: 1, x2: 2, y2: 1 };
    const out = applyRectangularPatternConstraints(shapes, [constraint]);
    expect(out[1]).toEqual({ type: "line", x1: 21, y1: 6, x2: 22, y2: 6 });
  });

  it("returns the same array reference when there are no pattern constraints", () => {
    const shapes = base();
    const out = applyRectangularPatternConstraints(shapes, [
      { type: "coincident" },
    ]);
    expect(out).toBe(shapes);
  });
});
