// Centre constraint: the centre of one connected shape held on the centre of
// another, plus an X/Y offset in mm.  Covers where "the centre" is, the solver
// residual that keeps it there, the index bookkeeping that keeps it pointing at
// the right geometry, and the store's pick / confirm / edit flow.
import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { shapeSetCentre } from "../sketchGeometry.js";
import { solveConstraints, varFields } from "../sketchSolver.js";
import { allConstraintsSatisfied } from "../sketchConstraints.js";
import {
  createSketchSlice,
  remapConstraintShapeIndices,
} from "../../store/sketchSlice.js";

// A square whose corners are joined, sides kept horizontal/vertical, and whose
// size is dimensioned -- a well-defined shape, as a user would draw it.
// Coordinates are scene units; the dimension is a mm formula (1 unit = 10 mm).
const square = (x0, y0, size, base) => ({
  shapes: [
    { type: "line", x1: x0, y1: y0, x2: x0 + size, y2: y0 },
    { type: "line", x1: x0 + size, y1: y0, x2: x0 + size, y2: y0 + size },
    { type: "line", x1: x0 + size, y1: y0 + size, x2: x0, y2: y0 + size },
    { type: "line", x1: x0, y1: y0 + size, x2: x0, y2: y0 },
  ],
  constraints: [
    ...[0, 1, 2, 3].map((k) => ({
      type: "coincident",
      shapeAIdx: base + k,
      pointA: "end",
      shapeBIdx: base + ((k + 1) % 4),
      pointB: "start",
    })),
    { type: "horizontal", shapeIdx: base },
    { type: "vertical", shapeIdx: base + 1 },
    { type: "horizontal", shapeIdx: base + 2 },
    { type: "vertical", shapeIdx: base + 3 },
    {
      type: "distance",
      shapeAIdx: base,
      pointA: "start",
      shapeBIdx: base,
      pointB: "end",
      distance: String(size * 10),
    },
    {
      type: "distance",
      shapeAIdx: base + 1,
      pointA: "start",
      shapeBIdx: base + 1,
      pointB: "end",
      distance: String(size * 10),
    },
  ],
});

// Shape A: a 2x2 square at the origin (indices 0-3).  Shape B: a 6x6 square
// well away from it (indices 4-7).
const A = [0, 1, 2, 3];
const B = [4, 5, 6, 7];
const twoSquares = () => {
  const a = square(0, 0, 2, 0);
  const b = square(10, 4, 6, 4);
  return {
    shapes: [...a.shapes, ...b.shapes],
    constraints: [...a.constraints, ...b.constraints],
  };
};
const sideLength = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const fixAll = (shapes, idxs) =>
  new Set(idxs.flatMap((i) => varFields(shapes[i]).map((f) => `${i}:${f}`)));

describe("where the centre of a shape is", () => {
  it("is the middle of a rectangle made of lines", () => {
    const { shapes } = square(1, 2, 4, 0);
    expect(shapeSetCentre(shapes, A)).toEqual({ x: 3, y: 4 });
  });

  it("is a circle's centre", () => {
    expect(
      shapeSetCentre([{ type: "circle", cx: -3, cy: 5, r: 2 }], [0]),
    ).toEqual({ x: -3, y: 5 });
  });

  it("spans an arc's drawn curve, not its whole circle", () => {
    // The upper half of a unit circle: x spans -1..1, y spans 0..1.
    const c = shapeSetCentre(
      [{ type: "arc", cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: Math.PI }],
      [0],
    );
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
  });

  it("spans a bezier's curve, not its control points", () => {
    // Control points reach y = 4, the curve itself only y = 3.
    const c = shapeSetCentre(
      [
        {
          type: "bezier",
          p0: { x: 0, y: 0 },
          p1: { x: 0, y: 4 },
          p2: { x: 4, y: 4 },
          p3: { x: 4, y: 0 },
        },
      ],
      [0],
    );
    expect(c.x).toBeCloseTo(2, 6);
    expect(c.y).toBeCloseTo(1.5, 6);
  });

  it("has no centre when the shape has no geometry", () => {
    expect(shapeSetCentre([], [0])).toBeNull();
  });
});

describe("the solver keeps the centres together", () => {
  it("brings A's centre onto B's plus the offset, and A keeps its size", () => {
    const { shapes, constraints } = twoSquares();
    const withCentre = [
      ...constraints,
      {
        type: "centre",
        shapesA: A,
        shapesB: B,
        offsetX: "5",
        offsetY: "-10",
      },
    ];
    const res = solveConstraints(shapes, withCentre, {
      fixed: fixAll(shapes, B),
    });
    expect(res.ok).toBe(true);
    const a = shapeSetCentre(res.shapes, A);
    const b = shapeSetCentre(res.shapes, B);
    // 5 mm and -10 mm are 0.5 and -1 scene units.
    expect(a.x - b.x).toBeCloseTo(0.5, 3);
    expect(a.y - b.y).toBeCloseTo(-1, 3);
    for (const i of A) expect(sideLength(res.shapes[i])).toBeCloseTo(2, 3);
    expect(allConstraintsSatisfied(res.shapes, withCentre)).toBe(true);
  });

  it("drags A along when B moves later", () => {
    const { shapes, constraints } = twoSquares();
    const centre = {
      type: "centre",
      shapesA: A,
      shapesB: B,
      offsetX: "0",
      offsetY: "0",
    };
    const all = [...constraints, centre];
    const first = solveConstraints(shapes, all, { fixed: fixAll(shapes, B) });
    // Move B 3 units right and hold it there, as a drag would.
    const moved = first.shapes.map((s, i) =>
      B.includes(i) ? { ...s, x1: s.x1 + 3, x2: s.x2 + 3 } : s,
    );
    const res = solveConstraints(moved, all, { fixed: fixAll(moved, B) });
    expect(res.ok).toBe(true);
    const a = shapeSetCentre(res.shapes, A);
    const b = shapeSetCentre(res.shapes, B);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
    for (const i of A) expect(sideLength(res.shapes[i])).toBeCloseTo(2, 3);
  });

  it("reports a centre that isn't where the constraint says as broken", () => {
    const { shapes, constraints } = twoSquares();
    expect(
      allConstraintsSatisfied(shapes, [
        ...constraints,
        {
          type: "centre",
          shapesA: A,
          shapesB: B,
          offsetX: "0",
          offsetY: "0",
        },
      ]),
    ).toBe(false);
  });
});

describe("the constraint follows its shapes through edits", () => {
  const centre = {
    type: "centre",
    shapesA: [0, 1],
    shapesB: [2, 3],
    offsetX: "0",
    offsetY: "0",
  };

  it("renumbers both shapes when earlier geometry is removed", () => {
    const map = new Map([
      [0, 0],
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
    expect(remapConstraintShapeIndices(centre, map)).toMatchObject({
      shapesA: [0, 1],
      shapesB: [3, 4],
    });
  });

  it("survives losing one piece of a shape -- the rest is still that shape", () => {
    const map = new Map([
      [0, -1],
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
    expect(remapConstraintShapeIndices(centre, map)).toMatchObject({
      shapesA: [0],
      shapesB: [1, 2],
    });
  });

  it("goes when a whole shape is deleted", () => {
    const map = new Map([
      [0, 0],
      [1, 1],
      [2, -1],
      [3, -1],
    ]);
    expect(remapConstraintShapeIndices(centre, map)).toBeNull();
  });
});

describe("the Centre tool in the store", () => {
  const makeStore = () => {
    const { shapes, constraints } = twoSquares();
    return create((set) => ({
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
  };
  const sketch = (store) => store.getState().items[0];

  it("opens on Shape A, moves on to B, and stops once both are picked", () => {
    const store = makeStore();
    store.getState().startCentreTool();
    expect(store.getState().activeSketchTool).toBe("centre");
    expect(store.getState().sketchCentreState.picking).toBe("A");
    store.getState().pickCentreShape(A);
    expect(store.getState().sketchCentreState.picking).toBe("B");
    store.getState().pickCentreShape(B);
    expect(store.getState().sketchCentreState).toMatchObject({
      picking: null,
      shapesA: A,
      shapesB: B,
    });
  });

  it("re-picking A leaves B as it was", () => {
    const store = makeStore();
    store.getState().startCentreTool();
    store.getState().pickCentreShape(A);
    store.getState().pickCentreShape(B);
    store.getState().setCentrePicking("A");
    store.getState().pickCentreShape([0, 1]);
    expect(store.getState().sketchCentreState).toMatchObject({
      picking: null,
      shapesA: [0, 1],
      shapesB: B,
    });
  });

  it("confirm centres A on B with the offset, keeps A's shape and leaves B alone", () => {
    const store = makeStore();
    const bBefore = B.map((i) => sketch(store).shapes[i]);
    store.getState().startCentreTool();
    store.getState().pickCentreShape(A);
    store.getState().pickCentreShape(B);
    // Offsets arrive from the dialog as mm: a typed number, or a formula.
    store.getState().setCentreOffset("x", 10);
    store.getState().setCentreOffset("y", "-5");
    store.getState().confirmCentre(1);

    const { shapes, constraints } = sketch(store);
    const a = shapeSetCentre(shapes, A);
    const b = shapeSetCentre(shapes, B);
    expect(a.x - b.x).toBeCloseTo(1, 3); // 10 mm
    expect(a.y - b.y).toBeCloseTo(-0.5, 3); // -5 mm
    for (const i of A) expect(sideLength(shapes[i])).toBeCloseTo(2, 3);
    expect(B.map((i) => shapes[i])).toEqual(bBefore);
    // Stored as mm TEXT: a bare number on a constraint means scene units.
    expect(constraints.at(-1)).toEqual({
      type: "centre",
      shapesA: A,
      shapesB: B,
      offsetX: "10",
      offsetY: "-5",
    });
    expect(store.getState().activeSketchTool).toBe(null);
    expect(store.getState().sketchCentreState).toBe(null);
  });

  it("editing re-opens the same constraint and updates it in place", () => {
    const store = makeStore();
    store.getState().startCentreTool();
    store.getState().pickCentreShape(A);
    store.getState().pickCentreShape(B);
    store.getState().confirmCentre(1);
    const idx = sketch(store).constraints.length - 1;
    const count = sketch(store).constraints.length;

    store.getState().beginCentreEdit(1, idx);
    expect(store.getState().sketchCentreState).toMatchObject({
      picking: null,
      shapesA: A,
      shapesB: B,
      editIdx: idx,
    });
    store.getState().setCentreOffset("x", "20");
    store.getState().confirmCentre(1);

    const { shapes, constraints } = sketch(store);
    expect(constraints.length).toBe(count);
    expect(constraints[idx].offsetX).toBe("20");
    const a = shapeSetCentre(shapes, A);
    const b = shapeSetCentre(shapes, B);
    expect(a.x - b.x).toBeCloseTo(2, 3);
  });

  it("refuses the same shape as both A and B", () => {
    const store = makeStore();
    store.getState().startCentreTool();
    store.getState().pickCentreShape(A);
    store.getState().pickCentreShape(A);
    const before = sketch(store);
    store.getState().confirmCentre(1);
    expect(store.getState().notification).toMatch(/same shape/i);
    expect(sketch(store)).toBe(before);
  });

  it("refuses a centring that would break another constraint, and changes nothing", () => {
    const store = makeStore();
    // Pin A's corner a fixed distance from B's: centring A on B contradicts it.
    const pinned = [
      ...sketch(store).constraints,
      {
        type: "distance",
        shapeAIdx: 0,
        pointA: "start",
        shapeBIdx: 4,
        pointB: "start",
        distance: "200",
      },
    ];
    store.setState({
      items: [{ ...sketch(store), constraints: pinned }],
    });
    const before = sketch(store);
    store.getState().startCentreTool();
    store.getState().pickCentreShape(A);
    store.getState().pickCentreShape(B);
    store.getState().confirmCentre(1);
    expect(store.getState().notification).toMatch(/break another constraint/);
    expect(sketch(store)).toBe(before);
  });
});
