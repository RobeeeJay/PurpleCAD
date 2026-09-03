import { describe, it, expect } from "vitest";
import { measure, shapeMetrics, loopArea } from "../measure.js";

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

  it("two parallel lines measure centre to centre", () => {
    const r = measure([
      {
        kind: "polyline",
        pts: [
          [0, 0, 0],
          [4, 0, 0],
        ],
      },
      {
        kind: "polyline",
        pts: [
          [0, 2, 0],
          [4, 2, 0],
        ],
      },
    ]);
    // Both lines span the same x, so their mid-points sit directly across from
    // each other and the reading is the 2-unit gap.
    expect(r).toEqual({ type: "distance", value: 2 });
  });

  it("a line's anchor is its mid-point, not the end nearest the other", () => {
    // Offset along their own direction: nearest-point would say 2 (straight
    // across the gap), centre-to-centre says the mid-points are also 3 apart
    // in x.
    const r = measure([
      { kind: "segment", a: [0, 0, 0], b: [4, 0, 0] }, // mid (2,0,0)
      { kind: "segment", a: [6, 2, 0], b: [10, 2, 0] }, // mid (8,2,0)
    ]);
    expect(r.value).toBeCloseTo(Math.hypot(6, 2));
  });

  it("a curved line anchors half way ALONG it, not on its chord", () => {
    // A right-angled elbow: the mid-point by arc length is the corner itself.
    const r = measure([
      {
        kind: "polyline",
        pts: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 2, 0],
        ],
      },
      { kind: "point", p: [2, 0, 0] },
    ]);
    expect(r.value).toBeCloseTo(0);
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

  it("distance from a point to a segment runs to the segment's mid-point", () => {
    const r = measure([
      { kind: "point", p: [1, 5, 0] },
      { kind: "segment", a: [0, 0, 0], b: [2, 0, 0] }, // mid (1,0,0)
    ]);
    expect(r.value).toBeCloseTo(5);
  });

  it("distance between two parallel edges (segment-segment)", () => {
    const r = measure([
      { kind: "segment", a: [0, 0, 0], b: [10, 0, 0] },
      { kind: "segment", a: [0, 3, 0], b: [10, 3, 0] },
    ]);
    expect(r.value).toBeCloseTo(3);
  });

  it("an object measures from the centre of its extent", () => {
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
    // Extent centres: (0.5,0.5,0) and (5.5,0,0).
    expect(r.value).toBeCloseTo(Math.hypot(5, 0.5));
  });

  it("a face measures from the centre of its extent, wherever it was clicked", () => {
    // Two plates on different levels AND offset sideways, so the nearest
    // corners (2 apart in x) and the centres (6 apart) give different answers.
    // Clicked near OPPOSITE corners, so a click-point reading differs from a
    // centre reading instead of shifting both by the same amount.
    const face = (y, x0, at) => ({
      kind: "face",
      normal: [0, 1, 0],
      pts: [
        [x0, y, 0],
        [x0 + 4, y, 0],
        [x0 + 4, y, 2],
        [x0, y, 2],
      ],
      at,
    });
    const r = measure([face(0, 0, [3.9, 0, 1.9]), face(3, 6, [6.1, 3, 0.1])]);
    // Centres (2,0,1) and (8,3,1); the nearest corners would say hypot(2,3).
    expect(r.value).toBeCloseTo(Math.hypot(6, 3));
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

  it("loopArea: four lines form a unit square", () => {
    const square = [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
      [
        [1, 1],
        [0, 1],
      ],
      [
        [0, 1],
        [0, 0],
      ],
    ];
    expect(loopArea(square)).toBeCloseTo(1);
  });

  it("loopArea: independent of piece order and direction", () => {
    const shuffled = [
      [
        [1, 1],
        [0, 1],
      ],
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [0, 1],
      ], // reversed
      [
        [1, 0],
        [1, 1],
      ],
    ];
    expect(loopArea(shuffled)).toBeCloseTo(1);
  });

  it("loopArea: accepts {x,y}/Vector3-like points", () => {
    const tri = [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      [
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
      [
        { x: 0, y: 2 },
        { x: 0, y: 0 },
      ],
    ];
    expect(loopArea(tri)).toBeCloseTo(2);
  });

  it("loopArea: open chain or disconnected pieces give null", () => {
    expect(
      loopArea([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [1, 1],
        ],
      ]),
    ).toBeNull();
    expect(
      loopArea([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [5, 5],
          [6, 5],
        ],
        [
          [1, 0],
          [0, 0],
        ],
      ]),
    ).toBeNull();
  });
});
