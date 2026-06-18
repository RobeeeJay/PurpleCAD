import { describe, it, expect } from "vitest";
import { explodeTextShape } from "../sketchGeometry.js";

describe("explodeTextShape", () => {
  it("turns each glyph contour into a closed coincident-joined line loop", () => {
    const textShape = {
      type: "text",
      x: 10,
      y: 20,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: -2 },
        ],
      ],
    };
    const { shapes, constraints } = explodeTextShape(textShape, 5);
    expect(shapes).toHaveLength(3);
    expect(shapes.every((s) => s.type === "line")).toBe(true);
    expect({ x: shapes[0].x1, y: shapes[0].y1 }).toEqual({ x: 10, y: 20 });
    expect({ x: shapes[0].x2, y: shapes[0].y2 }).toEqual({ x: 12, y: 20 });
    expect(constraints).toHaveLength(3);
    expect(constraints[0]).toEqual({
      type: "coincident",
      shapeAIdx: 5,
      pointA: "end",
      shapeBIdx: 6,
      pointB: "start",
    });
    expect(constraints[2]).toMatchObject({ shapeAIdx: 7, shapeBIdx: 5 });
  });

  it("drops a duplicated closing point and skips degenerate contours", () => {
    const textShape = {
      type: "text",
      x: 0,
      y: 0,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 1, y: -2 },
          { x: 0, y: 0 },
        ],
        [{ x: 5, y: 5 }],
      ],
    };
    const { shapes } = explodeTextShape(textShape, 0);
    expect(shapes).toHaveLength(3);
  });
});
