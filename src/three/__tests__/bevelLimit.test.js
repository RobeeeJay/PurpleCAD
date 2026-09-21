// The Chamfer dialog's hint: the largest bevel a flat face's rim could take,
// from its outline.  It must be a true upper bound -- a bevel bigger than it
// cannot exist -- so the dialog never discourages a size that would work.
import { describe, it, expect } from "vitest";
import { rimBevelLimit } from "../bevelLimit.js";
import { cogOutline } from "../cogGeometry.js";

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const circle = (r, n) =>
  Array.from({ length: n }, (_, i) => ({
    x: r * Math.cos((2 * Math.PI * i) / n),
    y: r * Math.sin((2 * Math.PI * i) / n),
  }));

describe("the largest bevel a face's rim could take", () => {
  it("is half the narrower side of a rectangle", () => {
    expect(rimBevelLimit(rect(20, 20))).toBeCloseTo(10, 9);
    expect(rimBevelLimit(rect(20, 4))).toBeCloseTo(2, 9);
  });

  it("doesn't depend on which way round the outline is drawn", () => {
    expect(rimBevelLimit([...rect(20, 4)].reverse())).toBeCloseTo(2, 9);
  });

  it("is half a ring's wall, where the outline and the hole meet", () => {
    expect(rimBevelLimit(circle(3, 64), [circle(2, 64)])).toBeCloseTo(0.5, 3);
  });

  it("is half a neck's width, even when the rest of the face is wide", () => {
    // Two 10 x 10 squares joined by a 10-long bridge 1 wide.
    const dumbbell = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4.5 },
      { x: 20, y: 4.5 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 5.5 },
      { x: 10, y: 5.5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(rimBevelLimit(dumbbell)).toBeCloseTo(0.5, 9);
  });

  it("is set by a gear's tooth tips, not its many short outline segments", () => {
    // 40 mm pitch diameter, 20 teeth: the tips are about 1.4 mm across.
    const [outline, hole] = cogOutline({
      pitchDiameter: 40,
      teeth: 20,
      backlash: 0,
      rootFillet: 0.5,
      holeDiameter: 8,
    }).contours;
    const limit = rimBevelLimit(outline, [hole]);
    expect(limit).toBeGreaterThan(0.6);
    expect(limit).toBeLessThan(0.8);
  });

  it("stays above sizes OCC was measured to manage", () => {
    // Measured: the ring's rim bevels at 0.49 and is refused at 0.6; the cog
    // (scene units: 0.1 = 1 mm) chamfers at 0.3 mm.
    expect(rimBevelLimit(circle(3, 64), [circle(2, 64)])).toBeGreaterThan(0.49);
    expect(rimBevelLimit(circle(3, 64), [circle(2, 64)])).toBeLessThan(0.6);
    const [outline, hole] = cogOutline({
      pitchDiameter: 4,
      teeth: 20,
      backlash: 0,
      rootFillet: 0.05,
      holeDiameter: 0.8,
    }).contours;
    expect(rimBevelLimit(outline, [hole])).toBeGreaterThan(0.03);
  });
});
