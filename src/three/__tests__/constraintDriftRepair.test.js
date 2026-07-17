// Regression: a saved sketch whose geometry VIOLATES its own constraints
// (drift — e.g. corner ops trimmed a line without re-solving dependents)
// froze every drag: solveDrag started from the bad seed, stalled above its
// residual guard, and held the last state.  The system itself is healthy —
// an unpinned solve converges — so drag-start repairs first (interaction
// side), and this pins the solver facts that make that repair valid.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { solveConstraints } from "../sketchSolver.js";
import { allConstraintsSatisfied } from "../sketchConstraints.js";

const doc = JSON.parse(
  fs.readFileSync("test-files/undraggable-sketch-bug.pcad", "utf8"),
);
const item = doc.history[1].instruction.item;
const varsMap = new Map(doc.variables.map((v) => [v.name, v.formula]));

describe("constraint-drift repair (undraggable-sketch-bug.pcad)", () => {
  it("the file is saved in a constraint-violating state", () => {
    expect(
      allConstraintsSatisfied(item.shapes, item.constraints, varsMap),
    ).toBe(false);
  });

  it("an unpinned repair solve converges, and a drag from the repaired state works", () => {
    const repaired = solveConstraints(item.shapes, item.constraints, {
      maxIter: 200,
      variables: varsMap,
    });
    expect(repaired.ok).toBe(true);
    // Drag the top border down 3 units, pinned — from the repaired seed the
    // whole constrained network translates.
    const rs = repaired.shapes;
    const input = rs.slice();
    input[0] = { ...rs[0], y1: rs[0].y1 + 3, y2: rs[0].y2 + 3 };
    const res = solveConstraints(input, item.constraints, {
      fixed: new Set(["0:x1", "0:y1", "0:x2", "0:y2"]),
      maxIter: 60,
      variables: varsMap,
    });
    expect(res.ok).toBe(true);
  });
});
