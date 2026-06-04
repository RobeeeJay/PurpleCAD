// Curve detection: hovering one line highlights the smooth chain of connected
// lines whose bend is within the configured angle.  computeLineChain is the
// pure walker behind that.

import { describe, it, expect } from "vitest";
import { computeLineChain } from "../cameraControls/sketchHover.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const sorted = (a) => [...a].sort((x, y) => x - y);

describe("computeLineChain", () => {
  it("chains gently-bending connected lines (<= angle)", () => {
    // Three segments each turning ~3° — a smooth curve.
    const shapes = [
      line(0, 0, 10, 0),
      line(10, 0, 20, 0.5), // ~2.9° bend
      line(20, 0.5, 30, 1.5), // ~2.8° bend
    ];
    expect(sorted(computeLineChain(shapes, 1, 5))).toEqual([0, 1, 2]);
  });

  it("stops at a sharp corner (> angle)", () => {
    // A right-angle corner: 90° bend, far over 5°.
    const shapes = [line(0, 0, 10, 0), line(10, 0, 10, 10)];
    expect(computeLineChain(shapes, 0, 5)).toEqual([0]);
  });

  it("does not chain a non-line shape", () => {
    const shapes = [{ type: "circle", cx: 0, cy: 0, r: 5 }, line(0, 0, 10, 0)];
    expect(computeLineChain(shapes, 0, 5)).toEqual([0]);
  });

  it("walks both directions from the hovered segment", () => {
    const shapes = [
      line(0, 0, 10, 0.3),
      line(10, 0.3, 20, 0), // hovered middle
      line(20, 0, 30, -0.3),
    ];
    expect(sorted(computeLineChain(shapes, 1, 5))).toEqual([0, 1, 2]);
  });

  it("respects a larger angle threshold", () => {
    const shapes = [line(0, 0, 10, 0), line(10, 0, 18, 4)]; // ~26.6° bend
    expect(computeLineChain(shapes, 0, 5)).toEqual([0]);
    expect(sorted(computeLineChain(shapes, 0, 30))).toEqual([0, 1]);
  });
});
