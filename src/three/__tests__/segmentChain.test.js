// Curve detection: hovering a tessellated curved edge highlights the whole
// smooth chain of connected feature-edge segments.  computeSegmentChain is the
// pure walker behind that.

import { describe, it, expect } from "vitest";
import { computeSegmentChain } from "../segmentChain.js";

const seg = (ax, ay, az, bx, by, bz) => ({ ax, ay, az, bx, by, bz });
const sorted = (a) => [...a].sort((x, y) => x - y);

describe("computeSegmentChain", () => {
  it("chains gently-bending connected segments (<= angle)", () => {
    const segs = [
      seg(0, 0, 0, 10, 0, 0),
      seg(10, 0, 0, 20, 0.5, 0), // ~2.9° bend
      seg(20, 0.5, 0, 30, 1.5, 0), // ~2.8° bend
    ];
    expect(sorted(computeSegmentChain(segs, 1, 5))).toEqual([0, 1, 2]);
  });

  it("stops at a sharp corner (> angle)", () => {
    const segs = [seg(0, 0, 0, 10, 0, 0), seg(10, 0, 0, 10, 10, 0)];
    expect(computeSegmentChain(segs, 0, 5)).toEqual([0]);
  });

  it("closes a tessellated loop (e.g. a cylinder rim) into one chain", () => {
    // Octagon approximating a circle — each turn is 45°, so it only chains
    // when the threshold allows it.
    const n = 8;
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const b = ((i + 1) / n) * Math.PI * 2;
      segs.push(seg(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0));
    }
    // 45° corners: not a chain at 5°, the whole loop at 50°.
    expect(computeSegmentChain(segs, 0, 5)).toEqual([0]);
    expect(computeSegmentChain(segs, 0, 50).length).toBe(n);
  });

  it("works in 3D (z varying)", () => {
    // Second segment bends ~7° out of the z axis (tan 7° ≈ 0.1228).
    const segs = [seg(0, 0, 0, 0, 0, 10), seg(0, 0, 10, 1.228, 0, 20)];
    expect(computeSegmentChain(segs, 0, 5)).toEqual([0]);
    expect(sorted(computeSegmentChain(segs, 0, 10))).toEqual([0, 1]);
  });
});
