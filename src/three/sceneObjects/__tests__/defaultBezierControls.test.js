// The endpoint-only bezier tool seeds its two control points from the chord:
// 1/3 along, bowed ~22% of the chord length to one side.

import { describe, it, expect } from "vitest";
import { defaultBezierControls, getShapePoint } from "../sketchShapes.js";

describe("defaultBezierControls", () => {
  it("places the handles 1/3 along the chord with a perpendicular bow", () => {
    const { p1, p2 } = defaultBezierControls({ x: 0, y: 0 }, { x: 3, y: 0 });
    // chord along +x, len 3 → handles at x=1 and x=2, bowed +y by 3*0.22.
    expect(p1.x).toBeCloseTo(1, 6);
    expect(p2.x).toBeCloseTo(2, 6);
    expect(p1.y).toBeCloseTo(0.66, 6);
    expect(p2.y).toBeCloseTo(0.66, 6);
  });

  it("is symmetric — the two handles bow to the same side", () => {
    const { p1, p2 } = defaultBezierControls({ x: 0, y: 0 }, { x: 0, y: 4 });
    // chord along +y → left perpendicular is -x, so both handles go negative x.
    expect(Math.sign(p1.x)).toBe(Math.sign(p2.x));
    expect(p1.x).toBeLessThan(0);
    expect(p1.y).toBeCloseTo(4 / 3, 6);
    expect(p2.y).toBeCloseTo((2 * 4) / 3, 6);
  });

  it("handles a degenerate (zero-length) chord without NaNs", () => {
    const { p1, p2 } = defaultBezierControls({ x: 2, y: 2 }, { x: 2, y: 2 });
    expect(Number.isFinite(p1.x) && Number.isFinite(p1.y)).toBe(true);
    expect(Number.isFinite(p2.x) && Number.isFinite(p2.y)).toBe(true);
  });

  it("getShapePoint exposes the control points for handle dragging", () => {
    const bez = {
      type: "bezier",
      p0: { x: 0, y: 0 },
      p1: { x: 1, y: 1 },
      p2: { x: 2, y: 1 },
      p3: { x: 3, y: 0 },
    };
    expect(getShapePoint(bez, "p1")).toEqual({ x: 1, y: 1 });
    expect(getShapePoint(bez, "p2")).toEqual({ x: 2, y: 1 });
  });
});
