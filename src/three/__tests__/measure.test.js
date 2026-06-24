import { describe, it, expect } from "vitest";
import { measure, shapeMetrics } from "../measure.js";

describe("measure", () => {
  it("segment length", () => {
    const r = measure([{ kind: "segment", a: [0, 0, 0], b: [3, 4, 0] }]);
    expect(r).toEqual({ type: "length", value: 5 });
  });

  it("polyline length sums segments", () => {
    const r = measure([
      {
        kind: "polyline",
        pts: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 2, 0],
        ],
      },
    ]);
    expect(r.type).toBe("length");
    expect(r.value).toBeCloseTo(4);
  });

  it("closed polyline includes the closing edge", () => {
    const r = measure([
      {
        kind: "polyline",
        pts: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 2, 0],
          [0, 2, 0],
        ],
        closed: true,
      },
    ]);
    expect(r.value).toBeCloseTo(8);
  });

  it("face dimensions report the rectangle's own sides (even rotated)", () => {
    // A 6×2 rectangle rotated 30° in the XY plane.
    const c = Math.cos(Math.PI / 6),
      s = Math.sin(Math.PI / 6);
    const rot = ([x, y]) => [x * c - y * s, x * s + y * c, 0];
    const r = measure([
      {
        kind: "face",
        normal: [0, 0, 1],
        pts: [rot([-3, -1]), rot([3, -1]), rot([3, 1]), rot([-3, 1])],
      },
    ]);
    expect(r.type).toBe("faceDims");
    expect(r.width).toBeCloseTo(6, 1);
    expect(r.height).toBeCloseTo(2, 1);
  });

  it("distance between two vertices is exact", () => {
    const r = measure([
      { kind: "point", p: [0, 0, 0] },
      { kind: "point", p: [0, 0, 10] },
    ]);
    expect(r).toEqual({ type: "distance", value: 10 });
  });

  it("distance from a point to a segment uses the nearest point on it", () => {
    const r = measure([
      { kind: "point", p: [1, 5, 0] },
      { kind: "segment", a: [0, 0, 0], b: [2, 0, 0] },
    ]);
    expect(r.value).toBeCloseTo(5); // foot of perpendicular at (1,0,0)
  });

  it("distance between two skew/parallel edges (segment-segment)", () => {
    const r = measure([
      { kind: "segment", a: [0, 0, 0], b: [10, 0, 0] },
      { kind: "segment", a: [0, 3, 0], b: [10, 3, 0] },
    ]);
    expect(r.value).toBeCloseTo(3);
  });

  it("nearest distance between two objects' sampled points", () => {
    const r = measure([
      {
        kind: "object",
        pts: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
      {
        kind: "object",
        pts: [
          [5, 0, 0],
          [6, 0, 0],
        ],
      },
    ]);
    expect(r.value).toBeCloseTo(4); // (1,0,0) → (5,0,0)
  });

  it("shapeMetrics: circle has radius and area", () => {
    const m = shapeMetrics({ type: "circle", cx: 0, cy: 0, r: 2 });
    expect(m.radius).toBe(2);
    expect(m.area).toBeCloseTo(Math.PI * 4);
  });

  it("shapeMetrics: arc has a radius but no area", () => {
    const m = shapeMetrics({ type: "arc", cx: 0, cy: 0, r: 3, startAngle: 0 });
    expect(m.radius).toBe(3);
    expect(m.area).toBeNull();
  });

  it("shapeMetrics: rect/ellipse have area but no radius", () => {
    expect(shapeMetrics({ type: "rect", x1: 0, y1: 0, x2: 2, y2: 3 })).toEqual({
      radius: null,
      area: 6,
    });
    const e = shapeMetrics({ type: "ellipse", cx: 0, cy: 0, rx: 2, ry: 4 });
    expect(e.radius).toBeNull();
    expect(e.area).toBeCloseTo(Math.PI * 8);
  });

  it("shapeMetrics: a plain line has neither", () => {
    expect(shapeMetrics({ type: "line", x1: 0, y1: 0, x2: 1, y2: 0 })).toEqual({
      radius: null,
      area: null,
    });
  });
});
