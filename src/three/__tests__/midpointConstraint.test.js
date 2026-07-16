// Midpoint constraint: a point shape pinned to the geometric middle of a
// line, arc or bezier — solver residuals, drag-follow via the fast enforce
// path, and the store action's validation rules.
import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { solveConstraints } from "../sketchSolver.js";
import {
  shapeMidpoint,
  allConstraintsSatisfied,
  enforceConstraints,
} from "../sketchConstraints.js";
import { createSketchSlice } from "../../store/sketchSlice.js";

describe("shapeMidpoint", () => {
  it("line: endpoint average", () => {
    expect(shapeMidpoint({ type: "line", x1: 0, y1: 0, x2: 4, y2: 2 })).toEqual(
      { x: 2, y: 1 },
    );
  });
  it("arc: the angular middle of the drawn sweep", () => {
    const m = shapeMidpoint({
      type: "arc",
      cx: 0,
      cy: 0,
      r: 2,
      startAngle: 0,
      endAngle: Math.PI,
    });
    expect(m.x).toBeCloseTo(0, 9);
    expect(m.y).toBeCloseTo(2, 9);
  });
  it("bezier: the curve point at t = 0.5", () => {
    const m = shapeMidpoint({
      type: "bezier",
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 4 },
      p2: { x: 4, y: 4 },
      p3: { x: 4, y: 0 },
    });
    expect(m.x).toBeCloseTo(2, 9);
    expect(m.y).toBeCloseTo(3, 9);
  });
  it("unsupported shapes return null", () => {
    expect(shapeMidpoint({ type: "circle", cx: 0, cy: 0, r: 1 })).toBe(null);
  });
});

describe("solver", () => {
  it("moves the point onto a line's middle and tracks a moved line", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 9, y: 9 },
    ];
    const constraints = [
      { type: "midpoint", pointShapeIdx: 1, targetShapeIdx: 0 },
    ];
    const fixLine = (idx) =>
      new Set([`${idx}:x1`, `${idx}:y1`, `${idx}:x2`, `${idx}:y2`]);
    const { shapes: solved, ok } = solveConstraints(shapes, constraints, {
      fixed: fixLine(0),
    });
    expect(ok).toBe(true);
    expect(solved[1].x).toBeCloseTo(2, 5);
    expect(solved[1].y).toBeCloseTo(0, 5);
    expect(allConstraintsSatisfied(solved, constraints)).toBe(true);

    // Move the line (pin its endpoints with the solver's fixed indices by
    // just re-solving from the new geometry).
    solved[0] = { type: "line", x1: 2, y1: 2, x2: 6, y2: 4 };
    const again = solveConstraints(solved, constraints, {
      fixed: fixLine(0),
    });
    expect(again.ok).toBe(true);
    expect(again.shapes[1].x).toBeCloseTo(4, 2);
    expect(again.shapes[1].y).toBeCloseTo(3, 2);
  });

  it("pins to an arc's angular middle and a bezier's t=0.5", () => {
    const shapes = [
      { type: "arc", cx: 0, cy: 0, r: 3, startAngle: 0, endAngle: Math.PI / 2 },
      // Points seed NEAR their targets — every real entry path (the store
      // action's pre-seed, the drag path's enforce snap) guarantees this;
      // the numeric solver converges slowly from far-away starts.
      { type: "point", x: 2, y: 2 },
      {
        type: "bezier",
        p0: { x: 10, y: 0 },
        p1: { x: 10, y: 2 },
        p2: { x: 14, y: 2 },
        p3: { x: 14, y: 0 },
      },
      { type: "point", x: 11.8, y: 1.3 },
    ];
    const constraints = [
      { type: "midpoint", pointShapeIdx: 1, targetShapeIdx: 0 },
      { type: "midpoint", pointShapeIdx: 3, targetShapeIdx: 2 },
    ];
    // Hold the targets still (arc fields; the bezier has no solver DOF).
    const { shapes: solved, ok } = solveConstraints(shapes, constraints, {
      fixed: new Set(["0:cx", "0:cy", "0:r", "0:startAngle", "0:endAngle"]),
    });
    expect(ok).toBe(true);
    const quarter = Math.PI / 4;
    expect(solved[1].x).toBeCloseTo(3 * Math.cos(quarter), 3);
    expect(solved[1].y).toBeCloseTo(3 * Math.sin(quarter), 3);
    expect(solved[3].x).toBeCloseTo(12, 3);
    expect(solved[3].y).toBeCloseTo(1.5, 3);
  });
});

describe("fast drag path", () => {
  it("enforceConstraints snaps the point when its target line moves", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 2, y: 0 },
    ];
    const constraints = [
      { type: "midpoint", pointShapeIdx: 1, targetShapeIdx: 0 },
    ];
    const moved = { type: "line", x1: 0, y1: 2, x2: 4, y2: 2 };
    const updated = enforceConstraints(shapes, constraints, 0, moved);
    const pt = updated.get(1);
    expect(pt).toBeTruthy();
    expect(pt.x).toBeCloseTo(2, 9);
    expect(pt.y).toBeCloseTo(2, 9);
  });
});

describe("store action validation", () => {
  const makeStore = (shapes, constraints = []) =>
    create((set) => ({
      items: [
        {
          id: 1,
          type: "sketch",
          shapes,
          constraints,
          position: {},
          rotation: {},
        },
      ],
      history: [
        {
          id: 0,
          instruction: {
            type: "create",
            item: { id: 1, type: "sketch", shapes, constraints },
          },
        },
      ],
      activeHistoryId: null,
      undoStack: [],
      redoStack: [],
      ...createSketchSlice(set),
    }));

  it("applies point + line in either order; rejects wrong types", () => {
    const s1 = makeStore([
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "point", x: 9, y: 9 },
    ]);
    s1.getState().applySketchPairConstraint(1, 1, 0, "midpoint");
    const item = s1.getState().items[0];
    expect(item.constraints).toEqual([
      { type: "midpoint", pointShapeIdx: 1, targetShapeIdx: 0 },
    ]);
    expect(item.shapes[1].x).toBeCloseTo(2, 5);
    expect(item.shapes[1].y).toBeCloseTo(0, 5);

    const s2 = makeStore([
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "circle", cx: 0, cy: 0, r: 1 },
    ]);
    s2.getState().applySketchPairConstraint(1, 0, 1, "midpoint");
    expect(s2.getState().notification).toMatch(/point and a line/i);
    expect(s2.getState().items[0].constraints).toEqual([]);
  });

  it("a point can't be midpoint-bound twice", () => {
    const store = makeStore(
      [
        { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
        { type: "line", x1: 0, y1: 2, x2: 4, y2: 2 },
        { type: "point", x: 2, y: 0 },
      ],
      [{ type: "midpoint", pointShapeIdx: 2, targetShapeIdx: 0 }],
    );
    store.getState().applySketchPairConstraint(1, 2, 1, "midpoint");
    expect(store.getState().notification).toMatch(/already has a midpoint/i);
    expect(store.getState().items[0].constraints.length).toBe(1);
  });
});
