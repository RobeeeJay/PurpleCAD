// An angle dimension holds two lines at a typed angle.  A line has no direction
// of its own, so these pin which of an angle and its supplement is meant, and
// that the solver really keeps it while the rest of the sketch moves.
import { describe, it, expect, beforeEach } from "vitest";
import { angleSense, linesAngleDeg, turnLineToAngle } from "../sketchAngle.js";
import { solveConstraints, varFields } from "../sketchSolver.js";
import { conflictingDimensions } from "../sketchDimensionConflicts.js";
import { useStore } from "../../store";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const dim = (a, b, sense, angle) => ({
  type: "angleDimension",
  shapeAIdx: a,
  shapeBIdx: b,
  sense,
  angle,
});
const coin = (a, pa, b, pb) => ({
  type: "coincident",
  shapeAIdx: a,
  pointA: pa,
  shapeBIdx: b,
  pointB: pb,
});

describe("which angle two lines mean", () => {
  it("reads the corner's angle where they share an endpoint", () => {
    // 45 degrees at the corner, whichever way round each line was drawn: the
    // stored directions alone would call some of these 135.
    const out = L(0, 0, 2, 0);
    const back = L(2, 0, 0, 0);
    const up = L(0, 0, 2, 2);
    const down = L(2, 2, 0, 0);
    for (const [a, b] of [
      [out, up],
      [out, down],
      [back, up],
      [back, down],
    ])
      expect(linesAngleDeg(a, b, angleSense(a, b))).toBeCloseTo(45, 9);
  });

  it("reads the acute angle between lines that don't touch", () => {
    const a = L(0, 0, 2, 0);
    const b = L(5, 5, 3, 3);
    expect(linesAngleDeg(a, b, angleSense(a, b))).toBeCloseTo(45, 9);
  });
});

describe("turning a line to an angle", () => {
  it("turns about the shared endpoint and keeps the length", () => {
    const other = L(0, 0, 4, 0);
    const line = L(0, 0, 2, 2);
    const t = turnLineToAngle(line, other, 1, 30);
    expect(t.x1).toBeCloseTo(0, 9);
    expect(t.y1).toBeCloseTo(0, 9);
    expect(Math.hypot(t.x2, t.y2)).toBeCloseTo(Math.hypot(2, 2), 9);
    expect(linesAngleDeg(t, other, 1)).toBeCloseTo(30, 9);
  });

  it("stays on the side of the other line it started on", () => {
    const t = turnLineToAngle(L(0, 0, 2, -2), L(0, 0, 4, 0), 1, 30);
    expect(t.y2, `end at y ${t.y2}`).toBeLessThan(0);
  });

  it("turns a line touching nothing about its own middle", () => {
    const t = turnLineToAngle(L(5, 5, 7, 5), L(0, 0, 4, 0), 1, 60);
    expect((t.x1 + t.x2) / 2).toBeCloseTo(6, 9);
    expect((t.y1 + t.y2) / 2).toBeCloseTo(5, 9);
    expect(linesAngleDeg(t, L(0, 0, 4, 0), 1)).toBeCloseTo(60, 9);
  });
});

describe("the solver and an angle dimension", () => {
  it("holds the angle when one line is dragged round", () => {
    // The drag pins the moved end; the other line has to swing to keep 60.
    const shapes = [L(0, 0, 3, 0), L(0, 0, 1.5, 2.598)];
    const constraints = [coin(0, "start", 1, "start"), dim(0, 1, 1, "60")];
    const moved = shapes.slice();
    moved[0] = L(0, 0, 2.5, 1.5);
    const { shapes: out, ok } = solveConstraints(moved, constraints, {
      fixed: new Set(["0:x1", "0:y1", "0:x2", "0:y2"]),
    });
    expect(ok).toBe(true);
    expect(linesAngleDeg(out[0], out[1], 1)).toBeCloseTo(60, 2);
  });

  it("follows a variable the angle is written in", () => {
    const shapes = [L(0, 0, 3, 0), L(0, 0, 1.5, 2.598)];
    const free = new Set(varFields(shapes[0]).map((f) => `0:${f}`));
    const { shapes: out, ok } = solveConstraints(
      shapes,
      [coin(0, "start", 1, "start"), dim(0, 1, 1, "Tilt + 5")],
      { variables: { Tilt: 40 }, fixed: free },
    );
    expect(ok).toBe(true);
    expect(linesAngleDeg(out[0], out[1], 1)).toBeCloseTo(45, 2);
  });

  it("reports an angle its variable asks for but the lines don't make", () => {
    // What turns the dimension red when a variable change is refused.
    const shapes = [L(0, 0, 3, 0), L(0, 0, 0, 3)];
    const held = dim(0, 1, 1, "Tilt");
    expect(conflictingDimensions(shapes, [held], { Tilt: 90 })).toEqual([]);
    expect(conflictingDimensions(shapes, [held], { Tilt: 30 })).toEqual([held]);
  });
});

describe("applying an angle from the field", () => {
  const ID = 9001;
  const sketch = () => useStore.getState().items.find((i) => i.id === ID);
  const place = (shapes, constraints = []) =>
    useStore.setState({
      notification: null,
      sketchAngleInput: null,
      items: [{ id: ID, type: "sketch", shapes, constraints }],
    });
  const apply = (a, b, raw) => {
    const s = useStore.getState();
    s.beginSketchAngle(ID, a, b);
    useStore.getState().applySketchAngle(ID, raw);
  };

  beforeEach(() => place([]));

  it("offers the angle the lines make now", () => {
    place([L(0, 0, 2, 0), L(0, 0, 2, 2)]);
    useStore.getState().beginSketchAngle(ID, 0, 1);
    expect(useStore.getState().sketchAngleInput).toMatchObject({
      shapeAIdx: 0,
      shapeBIdx: 1,
      defaultAngle: "45.00",
    });
  });

  it("moves only the first line picked when it can", () => {
    place([L(0, 0, 2, 0), L(0, 0, 2, 2)], [coin(0, "start", 1, "start")]);
    apply(0, 1, "70");
    const it = sketch();
    expect(linesAngleDeg(it.shapes[0], it.shapes[1], 1)).toBeCloseTo(70, 2);
    expect(it.shapes[1], "the second line stayed").toEqual(L(0, 0, 2, 2));
    expect(it.constraints.at(-1)).toMatchObject({
      type: "angleDimension",
      angle: "70",
    });
  });

  it("turns the other line when the first is pinned to an axis", () => {
    place(
      [L(0, 0, 2, 0), L(0, 0, 2, 2)],
      [coin(0, "start", 1, "start"), { type: "horizontal", shapeIdx: 0 }],
    );
    apply(0, 1, "30");
    const it = sketch();
    expect(it.shapes[0], "the horizontal line stayed").toEqual(L(0, 0, 2, 0));
    expect(linesAngleDeg(it.shapes[0], it.shapes[1], 1)).toBeCloseTo(30, 2);
  });

  it("refuses an angle the other constraints rule out, leaving the sketch", () => {
    const shapes = [L(0, 0, 2, 0), L(0, 0, 0, 2)];
    place(shapes, [
      coin(0, "start", 1, "start"),
      { type: "horizontal", shapeIdx: 0 },
      { type: "vertical", shapeIdx: 1 },
    ]);
    apply(0, 1, "30");
    expect(sketch().shapes).toEqual(shapes);
    expect(sketch().constraints.map((c) => c.type)).not.toContain(
      "angleDimension",
    );
    expect(useStore.getState().notification).toMatch(/break another/);
  });

  it("refuses 0 and 180, which are parallel rather than an angle", () => {
    for (const raw of ["0", "180", "200", "Nope"]) {
      place([L(0, 0, 2, 0), L(0, 0, 2, 2)]);
      apply(0, 1, raw);
      expect(sketch().constraints, raw).toEqual([]);
      expect(useStore.getState().notification, raw).toMatch(
        /between 0 and 180/,
      );
    }
  });

  it("edits an existing dimension in place, keeping which angle it means", () => {
    place(
      [L(0, 0, 2, 0), L(2, 2, 0, 0)],
      [coin(0, "start", 1, "end"), dim(0, 1, -1, "45")],
    );
    useStore.setState({
      sketchAngleInput: {
        shapeAIdx: 0,
        shapeBIdx: 1,
        defaultAngle: "45",
        constraintIdx: 1,
      },
    });
    useStore.getState().applySketchAngle(ID, "60");
    const it = sketch();
    expect(it.constraints).toHaveLength(2);
    expect(it.constraints[1]).toMatchObject({ angle: "60", sense: -1 });
    expect(linesAngleDeg(it.shapes[0], it.shapes[1], -1)).toBeCloseTo(60, 2);
  });
});
