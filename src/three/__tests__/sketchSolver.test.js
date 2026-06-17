import { describe, it, expect } from "vitest";
import {
  solveConstraints,
  fieldsForPoint,
  shapeHopDistance,
} from "../sketchSolver.js";
import { buildChamferEdit } from "../sketchGeometry.js";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const coin = (ai, pa, bi, pb) => ({
  type: "coincident",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
});
const ang = (ai, bi) => ({
  type: "angle",
  shapeAIdx: ai,
  pointA: "end",
  shapeBIdx: bi,
  pointB: "start",
  angle: 90,
});
const fixed = (ai, pa, bi, pb, d) => ({
  type: "distance",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
  distance: d,
});

// Unit square, CW: top, right, bottom, left, with coincident corners and a 90°
// angle at each corner (the rect tool's constraint set).
function squareWithAngles(extra = []) {
  const shapes = [L(0, 1, 1, 1), L(1, 1, 1, 0), L(1, 0, 0, 0), L(0, 0, 0, 1)];
  const constraints = [
    coin(0, "end", 1, "start"),
    coin(1, "end", 2, "start"),
    coin(2, "end", 3, "start"),
    coin(3, "end", 0, "start"),
    ang(0, 1),
    ang(1, 2),
    ang(2, 3),
    ang(3, 0),
    ...extra,
  ];
  return { shapes, constraints };
}

const sideLen = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

describe("solveConstraints", () => {
  it("resizes one side of an angle-constrained square into a clean rectangle", () => {
    const { shapes, constraints } = squareWithAngles([
      fixed(0, "start", 0, "end", 2), // top length 2
    ]);
    const { shapes: r, ok } = solveConstraints(shapes, constraints);
    expect(ok).toBe(true);
    // Top & bottom = 2, sides = 1 (height preserved); all corners stay joined.
    expect(sideLen(r[0])).toBeCloseTo(2, 4);
    expect(sideLen(r[2])).toBeCloseTo(2, 4);
    expect(sideLen(r[1])).toBeCloseTo(1, 4);
    expect(sideLen(r[3])).toBeCloseTo(1, 4);
    // Right angle at TR: top horizontal-ish ⟂ right.
    const dot =
      (r[0].x2 - r[0].x1) * (r[1].x2 - r[1].x1) +
      (r[0].y2 - r[0].y1) * (r[1].y2 - r[1].y1);
    expect(dot).toBeCloseTo(0, 3);
  });

  it("anchors the dimension's reference point when it is fixed", () => {
    const { shapes, constraints } = squareWithAngles([
      fixed(0, "start", 0, "end", 2),
    ]);
    const fixedSet = new Set(
      fieldsForPoint(shapes[0], "start").map((f) => `0:${f}`),
    );
    const { shapes: r, ok } = solveConstraints(shapes, constraints, {
      fixed: fixedSet,
    });
    expect(ok).toBe(true);
    // top.start (the anchored reference) hasn't moved.
    expect(r[0].x1).toBeCloseTo(0, 5);
    expect(r[0].y1).toBeCloseTo(1, 5);
    // top.end is 2 away from it.
    expect(Math.hypot(r[0].x2 - 0, r[0].y2 - 1)).toBeCloseTo(2, 4);
  });

  it("resizes a ROTATED square just as cleanly (angles are rotation-invariant)", () => {
    // Rotate the unit square 30° about the origin, then dimension a side to 2.
    const a = Math.PI / 6,
      ca = Math.cos(a),
      sa = Math.sin(a);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const base = squareWithAngles([fixed(0, "start", 0, "end", 2)]);
    const shapes = base.shapes.map((s) => {
      const [x1, y1] = rot(s.x1, s.y1);
      const [x2, y2] = rot(s.x2, s.y2);
      return { type: "line", x1, y1, x2, y2 };
    });
    const { shapes: r, ok } = solveConstraints(shapes, base.constraints);
    expect(ok).toBe(true);
    expect(sideLen(r[0])).toBeCloseTo(2, 4);
    expect(sideLen(r[1])).toBeCloseTo(1, 4);
  });

  it("applying a horizontal constraint to a side resolves the angles", () => {
    // A 30°-rotated angle-square: making one side horizontal must rotate the
    // whole square axis-aligned while keeping every corner at 90°.
    const a = Math.PI / 6,
      ca = Math.cos(a),
      sa = Math.sin(a);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const base = squareWithAngles();
    const shapes = base.shapes.map((s) => {
      const [x1, y1] = rot(s.x1, s.y1);
      const [x2, y2] = rot(s.x2, s.y2);
      return L(x1, y1, x2, y2);
    });
    const my = (shapes[0].y1 + shapes[0].y2) / 2;
    shapes[0] = { ...shapes[0], y1: my, y2: my };
    const constraints = [
      ...base.constraints,
      { type: "horizontal", shapeIdx: 0 },
    ];
    const { shapes: r, ok } = solveConstraints(shapes, constraints);
    expect(ok).toBe(true);
    expect(r[0].y2 - r[0].y1).toBeCloseTo(0, 4); // top is horizontal
    const dot =
      (r[0].x2 - r[0].x1) * (r[1].x2 - r[1].x1) +
      (r[0].y2 - r[0].y1) * (r[1].y2 - r[1].y1);
    expect(dot).toBeCloseTo(0, 3); // top ⟂ right
  });

  it("reports failure for a contradictory system", () => {
    // The two endpoints are coincident (distance 0) AND constrained to distance
    // 5 — impossible, so the solver must report not-ok.
    const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0)];
    const constraints = [
      coin(0, "end", 1, "start"),
      fixed(0, "end", 1, "start", 5),
    ];
    const { ok } = solveConstraints(shapes, constraints);
    expect(ok).toBe(false);
  });
});

describe("chamfering a square corner then dragging a side", () => {
  // Build the chamfered sketch from a square's constraint set, mirroring what
  // applySketchModify commits: apply the leg trims, append the bridge, drop the
  // removed constraints, append the new joins.
  const chamfer = (junc, dist = 0.2) => {
    const { shapes, constraints } = squareWithAngles();
    const edit = buildChamferEdit(shapes, junc, "chamfer", dist, constraints);
    const cShapes = shapes.map((s, i) => {
      const u = edit.updates.find(([idx]) => idx === i);
      return u ? u[1] : s;
    });
    cShapes.push(edit.newShape);
    const rm = new Set(edit.removeConstraints);
    const cCons = [
      ...constraints.filter((c) => !rm.has(c)),
      ...edit.newConstraints,
    ];
    return { edit, shapes: cShapes, constraints: cCons, bridge: shapes.length };
  };

  it("drops the corner's coincident AND its stale 90° angle lock", () => {
    // Chamfer the BR corner (L1.end ↔ L2.start). The rectangle's 90° angle at
    // that corner must go too — once the corner splits, an angle between two
    // now-separate points corrupts later solves.
    const { edit } = chamfer({ aIdx: 1, aKey: "end", bIdx: 2, bKey: "start" });
    expect(edit.removeConstraints).toContainEqual(coin(1, "end", 2, "start"));
    expect(edit.removeConstraints).toContainEqual(ang(1, 2));
    // a coincident at a different corner is untouched
    expect(edit.removeConstraints).not.toContainEqual(
      coin(0, "end", 1, "start"),
    );
  });

  it("keeps the chamfer joined to both legs when a far side is dragged", () => {
    const { shapes, constraints, bridge } = chamfer({
      aIdx: 1,
      aKey: "end",
      bIdx: 2,
      bKey: "start",
    });
    // Drag the top edge (idx 0) up by pinning both its endpoints higher.
    const dragged = shapes.slice();
    dragged[0] = L(0, 1.5, 1, 1.5);
    const fixedSet = new Set([
      ...fieldsForPoint(dragged[0], "start").map((f) => `0:${f}`),
      ...fieldsForPoint(dragged[0], "end").map((f) => `0:${f}`),
    ]);
    const { shapes: r, ok } = solveConstraints(dragged, constraints, {
      fixed: fixedSet,
    });
    expect(ok).toBe(true);
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3;
    // bridge.start ↔ L1.end and bridge.end ↔ L2.start both still hold.
    expect(
      near({ x: r[bridge].x1, y: r[bridge].y1 }, { x: r[1].x2, y: r[1].y2 }),
    ).toBe(true);
    expect(
      near({ x: r[bridge].x2, y: r[bridge].y2 }, { x: r[2].x1, y: r[2].y1 }),
    ).toBe(true);
  });
});

describe("drag locality (nearest connected points absorb the change)", () => {
  // A free-jointed chain of three unit bars: A–B–C–D, each length 1, joints
  // coincident.  Dragging end A should be taken up mostly by the near bar; the
  // far end D should move least.
  const chain = () => {
    const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0), L(2, 0, 3, 0)];
    const constraints = [
      coin(0, "end", 1, "start"),
      coin(1, "end", 2, "start"),
      fixed(0, "start", 0, "end", 1),
      fixed(1, "start", 1, "end", 1),
      fixed(2, "start", 2, "end", 1),
    ];
    return { shapes, constraints };
  };

  it("shapeHopDistance grows with constraint hops from the dragged shape", () => {
    const { constraints } = chain();
    expect(shapeHopDistance(3, constraints, new Set([0]))).toEqual([0, 1, 2]);
    // unreachable geometry is Infinity (maximally stiff)
    expect(
      shapeHopDistance(4, [coin(0, "end", 1, "start")], new Set([0])),
    ).toEqual([0, 1, Infinity, Infinity]);
  });

  it("a dragged end's near point moves more than the far point", () => {
    const { shapes, constraints } = chain();
    const dragged = shapes.slice();
    dragged[0] = { ...dragged[0], x1: 0.5, y1: 0 }; // pull A toward the chain
    const fixedSet = new Set(
      fieldsForPoint(dragged[0], "start").map((f) => `0:${f}`),
    );
    const { shapes: r, ok } = solveConstraints(dragged, constraints, {
      fixed: fixedSet,
    });
    expect(ok).toBe(true);
    const disp = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const dB = disp({ x: r[0].x2, y: r[0].y2 }, { x: 1, y: 0 });
    const dC = disp({ x: r[1].x2, y: r[1].y2 }, { x: 2, y: 0 });
    const dD = disp({ x: r[2].x2, y: r[2].y2 }, { x: 3, y: 0 });
    // Strictly decreasing with distance from the drag.
    expect(dB).toBeGreaterThan(dC);
    expect(dC).toBeGreaterThan(dD);
    // and a clear gap end-to-end, not a near-uniform shift.
    expect(dB - dD).toBeGreaterThan(0.1);
  });
});
