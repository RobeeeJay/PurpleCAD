import { describe, it, expect } from "vitest";
import { rotateShape } from "../sketchGeometry.js";

describe("rotateShape", () => {
  it("rotates a line's endpoints about a pivot by 90°", () => {
    // Line from (1,0) to (2,0), pivot at origin, +90° → (0,1) to (0,2).
    const r = rotateShape(
      { type: "line", x1: 1, y1: 0, x2: 2, y2: 0 },
      0,
      0,
      Math.PI / 2,
    );
    expect(r.x1).toBeCloseTo(0, 6);
    expect(r.y1).toBeCloseTo(1, 6);
    expect(r.x2).toBeCloseTo(0, 6);
    expect(r.y2).toBeCloseTo(2, 6);
  });

  it("rotates a circle's centre but keeps its radius", () => {
    const r = rotateShape(
      { type: "circle", cx: 2, cy: 0, r: 0.5 },
      0,
      0,
      Math.PI,
    );
    expect(r.cx).toBeCloseTo(-2, 6);
    expect(r.cy).toBeCloseTo(0, 6);
    expect(r.r).toBe(0.5);
  });

  it("preserves a line's length under rotation", () => {
    const s = { type: "line", x1: -3, y1: 1, x2: 4, y2: 5 };
    const r = rotateShape(s, 1, 1, 0.37);
    const lenBefore = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const lenAfter = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
    expect(lenAfter).toBeCloseTo(lenBefore, 6);
  });
});
