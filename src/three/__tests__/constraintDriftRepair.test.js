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
    // Drag the top border up 3 units, pinned — the whole constrained network
    // translates with it (bevel corners re-derive at the destination).
    const rs = repaired.shapes;
    const bottomBefore = rs[2].y1;
    const input = rs.slice();
    input[0] = { ...rs[0], y1: rs[0].y1 + 3, y2: rs[0].y2 + 3 };
    const res = solveConstraints(input, item.constraints, {
      fixed: new Set(["0:x1", "0:y1", "0:x2", "0:y2"]),
      maxIter: 60,
      variables: varsMap,
    });
    // solveDrag accepts the result below a 1e-2 residual (a converged solve is
    // ~1e-3; the drifted file's redundant H/V + leg-angle locks leave a
    // negligible ~2e-3 floor).  What matters is the geometry moved as a rigid
    // body: the bottom edge follows the top by the full 3 units and the fillets
    // keep their radius.
    expect(res.maxResidual).toBeLessThan(1e-2);
    expect(res.shapes[2].y1).toBeCloseTo(bottomBefore + 3, 1);
    for (const s of res.shapes)
      if (s.kind === "bevel") expect(s.r).toBeCloseTo(0.3, 2);
  });
});
