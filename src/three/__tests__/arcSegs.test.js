// arcSegsN drives how finely a curved sketch shape is flattened for the active
// resolution.  Beziers (no radius) must respond to the precision toggle too.

import { describe, it, expect } from "vitest";
import { arcSegsN } from "../sceneObjects/loopIntersect.js";

// A bulged cubic bezier: chord p0→p3 along x, controls lifted in y (dev ≈ 1).
const bezier = {
  type: "bezier",
  p0: { x: 0, y: 0 },
  p1: { x: 0.5, y: 1 },
  p2: { x: 1.5, y: 1 },
  p3: { x: 2, y: 0 },
};

describe("arcSegsN — bezier responds to precision", () => {
  it("uses more segments at a finer (print) precision than a coarse one", () => {
    const coarse = arcSegsN(bezier, Math.PI, 32, 0.5); // preview-like mm
    const fine = arcSegsN(bezier, Math.PI, 32, 0.01); // print-like mm
    expect(fine).toBeGreaterThan(coarse);
  });

  it("still respects the min/max clamp", () => {
    expect(arcSegsN(bezier, Math.PI, 32, 0.5)).toBeGreaterThanOrEqual(8);
    expect(arcSegsN(bezier, Math.PI, 32, 1e-6)).toBeLessThanOrEqual(512);
  });

  it("a straight (zero-deviation) bezier stays at the minimum", () => {
    const straight = {
      type: "bezier",
      p0: { x: 0, y: 0 },
      p1: { x: 1, y: 0 },
      p2: { x: 2, y: 0 },
      p3: { x: 3, y: 0 },
    };
    expect(arcSegsN(straight, Math.PI, 32, 0.01)).toBe(8);
  });

  it("falls back to curveSegments/2 when precision is null", () => {
    expect(arcSegsN(bezier, Math.PI, 32, null)).toBe(16);
  });
});
