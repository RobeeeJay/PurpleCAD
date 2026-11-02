// axisAlignLine: a freshly-drawn near-axis line snaps onto the axis and gets a
// horizontal/vertical constraint, but only by moving an un-pinned endpoint.

import { describe, it, expect, vi } from "vitest";

// sketchDraw pulls THREE + sceneObjects at import; stub the heavy deps so the
// pure helper can be exercised in node.
vi.mock("../../../store", () => ({ useStore: { getState: () => ({}) } }));
vi.mock("../sceneObjects.js", () => ({
  buildSketchShape: () => null,
  getSketchShapePoints: () => [],
  sketchDimText: () => "",
  snapUnitToIntervalMm: (v) => v,
}));
vi.mock("../theme.js", () => ({ SKETCH_DRAW_PREVIEW_COLOR: 0 }));

import {
  axisAlignLine,
  drawLengthConstraint,
  pointAtReach,
  snapAngleTo45,
  typedDrawLength,
} from "../sketchDraw.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

describe("axisAlignLine", () => {
  it("adds a horizontal constraint and levels a near-horizontal line", () => {
    const r = axisAlignLine(line(0, 0, 10, 0.05), 3, false, false);
    expect(r.constraint).toEqual({ type: "horizontal", shapeIdx: 3 });
    expect(r.shape.y2).toBe(0); // free end snapped onto the start's y
  });

  it("adds a vertical constraint and levels a near-vertical line", () => {
    const r = axisAlignLine(line(0, 0, 0.05, 10), 1, false, false);
    expect(r.constraint).toEqual({ type: "vertical", shapeIdx: 1 });
    expect(r.shape.x2).toBe(0);
  });

  it("moves the start when the end is pinned to existing geometry", () => {
    // end snapped → keep (x2,y2), bring the start onto the axis instead
    const r = axisAlignLine(line(0, 0.05, 10, 0), 2, false, true);
    expect(r.constraint.type).toBe("horizontal");
    expect(r.shape.y1).toBe(0); // start moved to the end's y
    expect(r.shape.y2).toBe(0);
  });

  it("does nothing when both endpoints are pinned", () => {
    expect(axisAlignLine(line(0, 0, 10, 0), 0, true, true)).toBeNull();
  });

  it("does nothing for a clearly diagonal line", () => {
    expect(axisAlignLine(line(0, 0, 10, 10), 0, false, false)).toBeNull();
  });

  it("ignores degenerate zero-length lines", () => {
    expect(axisAlignLine(line(5, 5, 5, 5), 0, false, false)).toBeNull();
  });
});

describe("snapAngleTo45 (shift-lock)", () => {
  const S = { x: 2, y: 3 };
  it("locks a near-horizontal drag to exactly horizontal", () => {
    const p = snapAngleTo45(S, { x: 9, y: 3.4 });
    expect(p.y).toBeCloseTo(3, 9); // exactly horizontal
    expect(p.x).toBeGreaterThan(S.x);
  });
  it("locks a near-vertical drag to exactly vertical", () => {
    const p = snapAngleTo45(S, { x: 2.3, y: -5 });
    expect(p.x).toBeCloseTo(2, 9);
  });
  it("locks a near-diagonal drag to 45°, preserving distance", () => {
    const cur = { x: 6, y: 6.5 }; // ~44° from S
    const p = snapAngleTo45(S, cur);
    expect(p.x - S.x).toBeCloseTo(p.y - S.y, 9); // 45°
    const d0 = Math.hypot(cur.x - S.x, cur.y - S.y);
    expect(Math.hypot(p.x - S.x, p.y - S.y)).toBeCloseTo(d0, 9);
  });
  it("a shift-locked horizontal line then gets a horizontal constraint", () => {
    const p = snapAngleTo45(S, { x: 9, y: 3.4 });
    const hv = axisAlignLine(line(S.x, S.y, p.x, p.y), 0, false, false);
    expect(hv.constraint.type).toBe("horizontal");
  });
  it("a shift-locked 45° line gets NO axis constraint", () => {
    const p = snapAngleTo45(S, { x: 6, y: 6.5 });
    expect(axisAlignLine(line(S.x, S.y, p.x, p.y), 0, false, false)).toBeNull();
  });
});

describe("typing a size while drawing", () => {
  it("treats an empty field as following the cursor", () => {
    expect(typedDrawLength("line", "  ", {})).toBeNull();
  });

  it("reads a line's length in mm and a circle's diameter as its radius", () => {
    // 10 mm is one scene unit; getting either conversion wrong draws a shape
    // that contradicts the dimension stored on it.
    expect(typedDrawLength("line", "40", {}).reach).toBeCloseTo(4, 9);
    expect(typedDrawLength("circle", "30", {}).reach).toBeCloseTo(1.5, 9);
  });

  it("evaluates a formula against the variables", () => {
    const got = typedDrawLength("line", "Wid * 2", { Wid: 15 });
    expect(got.raw).toBe("Wid * 2");
    expect(got.reach, `reach ${got.reach}`).toBeCloseTo(3, 9);
  });

  it("marks text that is not a positive length as having no reach", () => {
    for (const text of ["0", "-5", "Nope"])
      expect(typedDrawLength("line", text, {}).reach, text).toBeNull();
  });

  it("lands at the typed distance in the cursor's direction", () => {
    const p = pointAtReach({ x: 1, y: 1 }, { x: 4, y: 5 }, 10);
    expect(p.x, `x ${p.x}`).toBeCloseTo(7, 9);
    expect(p.y, `y ${p.y}`).toBeCloseTo(9, 9);
  });

  it("runs along +x when the cursor has not left the start point", () => {
    expect(pointAtReach({ x: 2, y: 3 }, { x: 2, y: 3 }, 4)).toEqual({
      x: 6,
      y: 3,
    });
  });

  it("stores the dimension the distance tool would: start to end on a line", () => {
    expect(drawLengthConstraint("line", 7, "Wid")).toEqual({
      type: "distance",
      shapeAIdx: 7,
      pointA: "start",
      shapeBIdx: 7,
      pointB: "end",
      distance: "Wid",
    });
  });

  it("stores a circle's typed diameter as the radius every file format keeps", () => {
    expect(drawLengthConstraint("circle", 2, "30")).toEqual({
      type: "distance",
      shapeAIdx: 2,
      pointA: "center",
      shapeBIdx: 2,
      pointB: "edge",
      distance: "15",
    });
  });
});
