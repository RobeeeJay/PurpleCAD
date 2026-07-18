// A negative fillet radius flips the arc: a concave scoop into the corner
// instead of a convex round.  The magnitude still sets the trim, the flip is
// remembered on the bevel data, and a re-derive (post-solve) preserves it.
import { describe, it, expect } from "vitest";
import {
  buildChamferEdit,
  resizeCorner,
  rederiveCornerFromLegs,
  buildBevelArc,
  norm2,
} from "../sketchGeometry.js";

// An L: leg 0 along -X from the corner (-1,0), leg 1 up +Y.
const legs = () => [
  { type: "line", x1: -6, y1: 0, x2: -1, y2: 0 },
  { type: "line", x1: -1, y1: 0, x2: -1, y2: 5 },
];
const junc = { aIdx: 0, aKey: "end", bIdx: 1, bKey: "start" };

describe("buildBevelArc flip", () => {
  it("flip reflects the arc centre across the chord", () => {
    const P = { x: 0, y: 0 };
    const uA = norm2({ x: -1, y: 0 });
    const uB = norm2({ x: 0, y: 1 });
    const trimA = { x: -2, y: 0 };
    const trimB = { x: 0, y: 2 };
    const normal = buildBevelArc(P, uA, uB, trimA, trimB, false);
    const flipped = buildBevelArc(P, uA, uB, trimA, trimB, true);
    // Normal fillet centre sits inside the corner at (-2, 2); flipped reflects
    // across the chord to the corner itself.
    expect(normal.cx).toBeCloseTo(-2, 6);
    expect(normal.cy).toBeCloseTo(2, 6);
    expect(flipped.cx).toBeCloseTo(0, 6);
    expect(flipped.cy).toBeCloseTo(0, 6);
    expect(flipped.r).toBeCloseTo(normal.r, 6);
  });
});

describe("negative radius through the corner recipe", () => {
  it("buildChamferEdit marks the bevel flipped and stores a positive setback", () => {
    const pos = buildChamferEdit(legs(), junc, "bevel", 3);
    const neg = buildChamferEdit(legs(), junc, "bevel", -3);
    expect(pos.newShape.bevelData.flip).toBeUndefined();
    expect(neg.newShape.bevelData.flip).toBe(true);
    // Same magnitude of trim / radius either way.
    expect(neg.newShape.r).toBeCloseTo(pos.newShape.r, 6);
    expect(neg.newShape.bevelData.dist).toBeCloseTo(
      pos.newShape.bevelData.dist,
      6,
    );
  });

  it("a re-derive (post-solve) preserves the flip", () => {
    const neg = buildChamferEdit(legs(), junc, "bevel", -3);
    const shapes = legs().map((s, i) => {
      const u = neg.updates.find(([idx]) => idx === i);
      return u ? u[1] : s;
    });
    shapes.push(neg.newShape);
    const bridgeIdx = shapes.length - 1;
    const res = rederiveCornerFromLegs(shapes, bridgeIdx);
    const rebuilt = res.updates.find(([i]) => i === bridgeIdx)[1];
    expect(rebuilt.bevelData.flip).toBe(true);
    expect(rebuilt.cx).toBeCloseTo(neg.newShape.cx, 6);
    expect(rebuilt.cy).toBeCloseTo(neg.newShape.cy, 6);
  });

  it("resizeCorner keeps a positive value convex and a negative one flipped", () => {
    const neg = buildChamferEdit(legs(), junc, "bevel", -3);
    const shapes = legs().map((s, i) => {
      const u = neg.updates.find(([idx]) => idx === i);
      return u ? u[1] : s;
    });
    shapes.push(neg.newShape);
    const bridgeIdx = shapes.length - 1;
    // Resize to a POSITIVE radius: the flip clears.
    const toConvex = resizeCorner(shapes, bridgeIdx, 0.4);
    expect(
      toConvex.updates.find(([i]) => i === bridgeIdx)[1].bevelData.flip,
    ).toBeUndefined();
    // Resize to another NEGATIVE radius: still flipped.
    const toConcave = resizeCorner(shapes, bridgeIdx, -0.5);
    expect(
      toConcave.updates.find(([i]) => i === bridgeIdx)[1].bevelData.flip,
    ).toBe(true);
  });
});
