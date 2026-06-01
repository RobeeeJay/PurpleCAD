import { describe, it, expect, vi, beforeEach } from "vitest";
import { getShapePoint, moveShapePoint } from "../sceneObjects.js";
import {
  enforceConstraints,
  applyHVEnforcement,
  computeChamfer,
  chamferConstraints,
} from "../sketchConstraints.js";

// ── Mock sceneObjects.js ─────────────────────────────────────────────────────
// Only getShapePoint and moveShapePoint are used by enforceConstraints; the
// rest of sceneObjects depends on THREE.js and the DOM which we skip entirely.

vi.mock("../sceneObjects.js", () => {
  const gsp = (shape, key) => {
    switch (shape.type) {
      case "line":
        if (key === "start") return { x: shape.x1, y: shape.y1 };
        if (key === "end") return { x: shape.x2, y: shape.y2 };
        return null;
      case "circle":
        if (key === "edge") return { x: shape.cx + shape.r, y: shape.cy };
        return { x: shape.cx, y: shape.cy }; // center (default)
      case "rect":
        if (key === "tl") return { x: shape.x1, y: shape.y1 };
        if (key === "tr") return { x: shape.x2, y: shape.y1 };
        if (key === "br") return { x: shape.x2, y: shape.y2 };
        if (key === "bl") return { x: shape.x1, y: shape.y2 };
        return null;
      default:
        return null;
    }
  };

  const msp = (shape, key, { x, y }) => {
    switch (shape.type) {
      case "line":
        if (key === "start") return { ...shape, x1: x, y1: y };
        if (key === "end") return { ...shape, x2: x, y2: y };
        return null;
      case "circle":
        if (key === "center") return { ...shape, cx: x, cy: y };
        if (key === "edge")
          return { ...shape, r: Math.hypot(x - shape.cx, y - shape.cy) };
        return null;
      case "rect":
        if (key === "tl") return { ...shape, x1: x, y1: y };
        if (key === "tr") return { ...shape, x2: x, y1: y };
        if (key === "br") return { ...shape, x2: x, y2: y };
        if (key === "bl") return { ...shape, x1: x, y2: y };
        return null;
      default:
        return null;
    }
  };

  return { getShapePoint: gsp, moveShapePoint: msp };
});

// ── Test utilities ───────────────────────────────────────────────────────────

// Apply enforceConstraints and return the merged final shapes array.
function apply(
  shapes,
  constraints,
  primaryIdx,
  pointKey,
  newPos,
  preSeeded = null,
) {
  const movedShape = moveShapePoint(shapes[primaryIdx], pointKey, newPos);
  const updated = enforceConstraints(
    shapes,
    constraints,
    primaryIdx,
    movedShape,
    pointKey,
    preSeeded,
  );
  const result = shapes.slice();
  for (const [idx, s] of updated) result[idx] = s;
  return result;
}

// applyBody: whole-shape translate — primaryPointKey is null.
function applyBody(
  shapes,
  constraints,
  primaryIdx,
  primaryShape,
  preSeeded = null,
) {
  const updated = enforceConstraints(
    shapes,
    constraints,
    primaryIdx,
    primaryShape,
    null,
    preSeeded,
  );
  const result = shapes.slice();
  for (const [idx, s] of updated) result[idx] = s;
  return result;
}

function assertCoincidesHold(result, constraints) {
  for (const c of constraints) {
    if (c.type !== "coincident") continue;
    const a = getShapePoint(result[c.shapeAIdx], c.pointA);
    const b = getShapePoint(result[c.shapeBIdx], c.pointB);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    expect(
      dist,
      `coincident ${c.shapeAIdx}.${c.pointA} = ${c.shapeBIdx}.${c.pointB}`,
    ).toBeLessThan(1e-6);
  }
}

function assertDistancesHold(result, constraints) {
  for (const c of constraints) {
    if (c.type !== "distance") continue;
    const a = getShapePoint(result[c.shapeAIdx], c.pointA);
    const b = getShapePoint(result[c.shapeBIdx], c.pointB);
    expect(
      Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - c.distance),
      `distance ${c.shapeAIdx}.${c.pointA}↔${c.shapeBIdx}.${c.pointB} = ${c.distance}`,
    ).toBeLessThan(1e-6);
  }
}

function pt(result, idx, key) {
  return getShapePoint(result[idx], key);
}

// ── Shape / constraint shorthand factories ───────────────────────────────────

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });

const coin = (ai, pa, bi, pb) => ({
  type: "coincident",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
});
const fixed = (ai, pa, bi, pb, d) => ({
  type: "distance",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
  distance: d,
});
const hvC = (idx, t) => ({ type: t, shapeIdx: idx });

// ── Fixture factories ────────────────────────────────────────────────────────

// Two lines sharing one endpoint: L0.end = L1.start at (1, 0)
function twoLinesH() {
  return {
    shapes: [L(0, 0, 1, 0), L(1, 0, 2, 0)],
    constraints: [coin(0, "end", 1, "start")],
  };
}

// Three collinear lines chained: L0.end=L1.start, L1.end=L2.start
function threeLines() {
  return {
    shapes: [L(0, 0, 1, 0), L(1, 0, 2, 0), L(2, 0, 3, 0)],
    constraints: [coin(0, "end", 1, "start"), coin(1, "end", 2, "start")],
  };
}

// T-junction: L0.end = L1.start = L2.start at (1, 0)
function tJunction() {
  return {
    shapes: [L(0, 0, 1, 0), L(1, 0, 2, 0), L(1, 0, 1, 2)],
    constraints: [coin(0, "end", 1, "start"), coin(0, "end", 2, "start")],
  };
}

// Rectangle: 4 lines, corners coincident.
// 0=top(TL→TR), 1=right(TR→BR), 2=bottom(BR→BL), 3=left(BL→TL)
//   TL=(0,2)  TR=(2,2)
//   BL=(0,0)  BR=(2,0)
function makeRect() {
  return {
    shapes: [L(0, 2, 2, 2), L(2, 2, 2, 0), L(2, 0, 0, 0), L(0, 0, 0, 2)],
    constraints: [
      coin(3, "end", 0, "start"), // TL: left.end = top.start
      coin(0, "end", 1, "start"), // TR: top.end  = right.start
      coin(1, "end", 2, "start"), // BR: right.end= bottom.start
      coin(2, "end", 3, "start"), // BL: bottom.end= left.start
    ],
  };
}

// Rectangle + diagonal TL→BR.
// Shapes same as makeRect() plus:
//   4=diag TL→BR  (0,2)→(2,0)
// Extra coincidents chain TL and BR through the diagonal:
//   left.end(TL) = diag.start,  bottom.start(BR) = diag.end
function makeRectDiag() {
  const { shapes, constraints } = makeRect();
  shapes.push(L(0, 2, 2, 0)); // shape 4
  constraints.push(
    coin(3, "end", 4, "start"), // TL: left.end = diag.start
    coin(2, "start", 4, "end"), // BR: bottom.start = diag.end
  );
  return { shapes, constraints };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("enforceConstraints", () => {
  // ══ TWO-LINE JUNCTION ════════════════════════════════════════════════════

  describe("two-line junction (L0.end = L1.start)", () => {
    it("drag L0.end up-right → L1.start follows", () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 0, "end", { x: 1.5, y: 0.8 });
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1.5),
        y: expect.closeTo(0.8),
      });
      assertCoincidesHold(result, constraints);
      // L0.start unchanged
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      // L1.end unchanged
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("drag L1.start up-left → L0.end follows", () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 1, "start", { x: 0.5, y: 1 });
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(0.5),
        y: expect.closeTo(1),
      });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
    });

    it("drag L0.start (unconnected end) → L1 unchanged", () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 0, "start", {
        x: -0.5,
        y: 0.5,
      });
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(-0.5),
        y: expect.closeTo(0.5),
      });
      // junction should still hold
      assertCoincidesHold(result, constraints);
    });

    it("drag L0.end in multiple directions", () => {
      const moves = [
        { x: 2, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: -1 },
        { x: -0.5, y: 0.5 },
      ];
      for (const newPos of moves) {
        const { shapes, constraints } = twoLinesH();
        const result = apply(shapes, constraints, 0, "end", newPos);
        assertCoincidesHold(result, constraints);
        expect(pt(result, 0, "end")).toMatchObject({
          x: expect.closeTo(newPos.x),
          y: expect.closeTo(newPos.y),
        });
      }
    });
  });

  // ══ CHAIN OF THREE LINES ═════════════════════════════════════════════════

  describe("chain of three lines (L0→L1→L2)", () => {
    it("drag L0.end → L1.start follows, L1.end and L2 unaffected", () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 0, "end", { x: 1.2, y: 0.6 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1.2),
        y: expect.closeTo(0.6),
      });
      // L1.end was already matching L2.start and didn't move, so L2 is untouched
      expect(pt(result, 2, "end")).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(0),
      });
    });

    it("drag L1.end → L2.start follows, L0 untouched", () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 1, "end", { x: 2.5, y: -0.5 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(2.5),
        y: expect.closeTo(-0.5),
      });
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(0),
      });
    });

    it("drag L2.start → L1.end follows, L0 untouched", () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 2, "start", { x: 1.8, y: 0.4 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(1.8),
        y: expect.closeTo(0.4),
      });
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(0),
      });
    });
  });

  // ══ T-JUNCTION ═══════════════════════════════════════════════════════════

  describe("T-junction (L0.end = L1.start = L2.start)", () => {
    it("drag L0.end → both L1.start and L2.start follow", () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 0, "end", { x: 1.5, y: 0.5 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1.5),
        y: expect.closeTo(0.5),
      });
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(1.5),
        y: expect.closeTo(0.5),
      });
    });

    it("drag L1.start → L0.end and L2.start follow", () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 1, "start", {
        x: 0.8,
        y: -0.3,
      });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(0.8),
        y: expect.closeTo(-0.3),
      });
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(0.8),
        y: expect.closeTo(-0.3),
      });
    });

    it("drag L2.start → L0.end and L1.start follow", () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 2, "start", { x: 1, y: 1 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(1),
      });
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(1),
      });
    });

    it("drag L2.end (free end) → other shapes unaffected", () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 2, "end", { x: 2, y: 3 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 2, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(3),
      });
    });
  });

  // ══ RECTANGLE (CLOSED LOOP) ═══════════════════════════════════════════════

  describe("rectangle – drag each corner", () => {
    it.each([
      ["TL via left.end", 3, "end", { x: 0.5, y: 2.5 }],
      ["TL via top.start", 0, "start", { x: 0.5, y: 2.5 }],
      ["TR via top.end", 0, "end", { x: 2.5, y: 2 }],
      ["TR via right.start", 1, "start", { x: 2.5, y: 2 }],
      ["BR via right.end", 1, "end", { x: 2.5, y: -0.5 }],
      ["BR via bottom.start", 2, "start", { x: 2.5, y: -0.5 }],
      ["BL via bottom.end", 2, "end", { x: -0.5, y: 0 }],
      ["BL via left.start", 3, "start", { x: -0.5, y: 0 }],
    ])(
      "drag %s → all coincidents satisfied",
      (_, primaryIdx, pointKey, newPos) => {
        const { shapes, constraints } = makeRect();
        const result = apply(shapes, constraints, primaryIdx, pointKey, newPos);
        assertCoincidesHold(result, constraints);
        expect(pt(result, primaryIdx, pointKey)).toMatchObject({
          x: expect.closeTo(newPos.x),
          y: expect.closeTo(newPos.y),
        });
      },
    );

    it("dragging one corner does not move the diagonally opposite corner", () => {
      const { shapes, constraints } = makeRect();
      // Drag TL to (0.5, 2.5) — BR should stay at (2, 0)
      const result = apply(shapes, constraints, 0, "start", { x: 0.5, y: 2.5 });
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("moving a top-edge corner keeps the horizontal top edge level", () => {
      // Regression: applying a distance constraint that drags a corner of an
      // H/V-constrained edge used to tilt that edge — the placed-endpoint
      // primary shape was never re-levelled.  The top stays horizontal now.
      const { shapes, constraints } = makeRect();
      constraints.push(hvC(0, "horizontal")); // top edge
      const result = apply(shapes, constraints, 0, "end", { x: 3, y: 3 });
      expect(result[0].y1).toBeCloseTo(result[0].y2, 6);
      expect(result[0].y2).toBeCloseTo(3, 6);
      assertCoincidesHold(result, constraints);
    });

    it("whole-rectangle translate (preSeeded) preserves all constraints", () => {
      const { shapes, constraints } = makeRect();
      // Translate every shape by (+1, +1)
      const preSeeded = new Map(
        shapes.map((s, i) => [i, L(s.x1 + 1, s.y1 + 1, s.x2 + 1, s.y2 + 1)]),
      );
      const primaryShape = preSeeded.get(0);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        primaryShape,
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      // Verify actual translation happened
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(3),
      });
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(1),
      });
    });
  });

  // ══ RECTANGLE WITH DIAGONAL (COMPLEX) ════════════════════════════════════

  describe("rectangle with diagonal (TL→BR)", () => {
    // Shape indices: 0=top 1=right 2=bottom 3=left 4=diagonal
    // TL shared by: top.start, left.end, diag.start
    // TR shared by: top.end, right.start
    // BR shared by: right.end, bottom.start, diag.end
    // BL shared by: bottom.end, left.start

    it.each([
      // [label, primaryIdx, pointKey, newPos, unchangedCorner, unchangedCornerShapes]
      [
        "TL via left.end",
        3,
        "end",
        { x: 0.5, y: 2.5 },
        { x: 2, y: 0 },
        [1, "end"],
      ],
      [
        "TL via top.start",
        0,
        "start",
        { x: 0.5, y: 2.5 },
        { x: 2, y: 0 },
        [1, "end"],
      ],
      [
        "TL via diag.start",
        4,
        "start",
        { x: 0.5, y: 2.5 },
        { x: 2, y: 0 },
        [1, "end"],
      ],
      [
        "TR via top.end",
        0,
        "end",
        { x: 2.5, y: 2 },
        { x: 0, y: 0 },
        [2, "end"],
      ],
      [
        "TR via right.start",
        1,
        "start",
        { x: 2.5, y: 2 },
        { x: 0, y: 0 },
        [2, "end"],
      ],
      [
        "BR via right.end",
        1,
        "end",
        { x: 2.5, y: -0.5 },
        { x: 0, y: 2 },
        [3, "end"],
      ],
      [
        "BR via bottom.start",
        2,
        "start",
        { x: 2.5, y: -0.5 },
        { x: 0, y: 2 },
        [3, "end"],
      ],
      [
        "BR via diag.end",
        4,
        "end",
        { x: 2.5, y: -0.5 },
        { x: 0, y: 2 },
        [3, "end"],
      ],
      [
        "BL via bottom.end",
        2,
        "end",
        { x: -0.5, y: 0 },
        { x: 2, y: 2 },
        [0, "end"],
      ],
      [
        "BL via left.start",
        3,
        "start",
        { x: -0.5, y: 0 },
        { x: 2, y: 2 },
        [0, "end"],
      ],
    ])(
      "drag %s → coincidents hold, opposite diagonal corner unmoved",
      (_, primaryIdx, pointKey, newPos, stayPos, [stayIdx, stayKey]) => {
        const { shapes, constraints } = makeRectDiag();
        const result = apply(shapes, constraints, primaryIdx, pointKey, newPos);
        assertCoincidesHold(result, constraints);
        // Dragged point reached target
        expect(pt(result, primaryIdx, pointKey)).toMatchObject({
          x: expect.closeTo(newPos.x),
          y: expect.closeTo(newPos.y),
        });
        // Opposite corner (not connected through any chain to this corner) didn't move
        expect(pt(result, stayIdx, stayKey)).toMatchObject({
          x: expect.closeTo(stayPos.x),
          y: expect.closeTo(stayPos.y),
        });
      },
    );

    it("diagonal stretches when TL moves (diag.start = TL chain)", () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 0, "start", { x: 0, y: 3 }); // TL moves up
      // diagonal start follows TL
      expect(pt(result, 4, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(3),
      });
      // diagonal end stays at BR (no movement propagated there)
      expect(pt(result, 4, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("diagonal stretches when BR moves (diag.end = BR chain)", () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 1, "end", { x: 3, y: 0 }); // BR moves right
      expect(pt(result, 4, "end")).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(0),
      });
      expect(pt(result, 4, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(2),
      });
    });

    it("diagonal unaffected when only TR corner moves", () => {
      const { shapes, constraints } = makeRectDiag();
      // TR is not connected to the diagonal at all
      const result = apply(shapes, constraints, 0, "end", { x: 2.5, y: 2 });
      assertCoincidesHold(result, constraints);
      // diagonal start and end unchanged
      expect(pt(result, 4, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(2),
      });
      expect(pt(result, 4, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("diagonal unaffected when only BL corner moves", () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 2, "end", { x: -0.5, y: 0 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 4, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(2),
      });
      expect(pt(result, 4, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("dragging top edge keeps an onLine circle at its fixed distance from the corner", () => {
      // Regression: circle centre pinned onLine the diagonal AND a fixed
      // distance from the diagonal's top-left corner.  Dragging the top edge
      // moves that corner; the distance pass used to bail (both sides "moved")
      // and leave the circle at the wrong distance.
      const { shapes, constraints } = makeRectDiag();
      shapes.push(C(1, 1, 0.2)); // shape 5: centre on the diagonal midpoint
      constraints.push(
        {
          type: "onLine",
          lineShapeIdx: 4,
          pointShapeIdx: 5,
          pointKey: "center",
        },
        fixed(5, "center", 4, "start", Math.SQRT2),
      );
      // Drag the whole top edge up by (0, +1): TL→(0,3), TR→(2,3).
      const newTop = L(0, 3, 2, 3);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        newTop,
        null,
        new Map([[0, newTop]]),
      );
      const result = shapes.slice();
      for (const [i, s] of updated) result[i] = s;

      const ds = pt(result, 4, "start"); // diagonal TL after drag
      const de = pt(result, 4, "end"); // diagonal BR
      const cc = pt(result, 5, "center");
      expect(Math.hypot(cc.x - ds.x, cc.y - ds.y)).toBeCloseTo(Math.SQRT2, 5);
      // Centre still collinear with the diagonal (zero cross product).
      const cross =
        (cc.x - ds.x) * (de.y - ds.y) - (cc.y - ds.y) * (de.x - ds.x);
      expect(cross).toBeCloseTo(0, 5);
      assertCoincidesHold(result, constraints);
    });

    it("whole translate (preSeeded) preserves all coincidents", () => {
      const { shapes, constraints } = makeRectDiag();
      const dx = 3,
        dy = -1;
      const preSeeded = new Map(
        shapes.map((s, i) => [
          i,
          L(s.x1 + dx, s.y1 + dy, s.x2 + dx, s.y2 + dy),
        ]),
      );
      const primaryShape = preSeeded.get(0);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        primaryShape,
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });
  });

  // ══ HORIZONTAL / VERTICAL ENFORCEMENT ════════════════════════════════════
  // applyHVEnforcement is applied by cameraControls.js to the primaryShape *before*
  // calling enforceConstraints. enforceConstraints applies it internally only when a
  // shape is pulled via a coincident constraint.

  describe("applyHVEnforcement (direct)", () => {
    it("horizontal: drag start snaps both endpoints to start.y", () => {
      const shape = L(0, 0, 2, 1);
      const moved = moveShapePoint(shape, "start", { x: 0, y: 0.5 });
      const result = applyHVEnforcement(
        moved,
        "start",
        [hvC(0, "horizontal")],
        0,
      );
      expect(result.y1).toBeCloseTo(0.5);
      expect(result.y2).toBeCloseTo(0.5);
    });

    it("horizontal: drag end snaps both endpoints to end.y", () => {
      const shape = L(0, 0, 2, 0);
      const moved = moveShapePoint(shape, "end", { x: 3, y: 0.7 });
      const result = applyHVEnforcement(
        moved,
        "end",
        [hvC(0, "horizontal")],
        0,
      );
      expect(result.y2).toBeCloseTo(0.7);
      expect(result.y1).toBeCloseTo(0.7);
    });

    it("vertical: drag start snaps both endpoints to start.x", () => {
      const shape = L(0, 0, 0.3, 2);
      const moved = moveShapePoint(shape, "start", { x: 1, y: 0 });
      const result = applyHVEnforcement(
        moved,
        "start",
        [hvC(0, "vertical")],
        0,
      );
      expect(result.x1).toBeCloseTo(1);
      expect(result.x2).toBeCloseTo(1);
    });

    it("vertical: drag end snaps both endpoints to end.x", () => {
      const shape = L(1, 0, 1, 2);
      const moved = moveShapePoint(shape, "end", { x: 2.5, y: 3 });
      const result = applyHVEnforcement(moved, "end", [hvC(0, "vertical")], 0);
      expect(result.x2).toBeCloseTo(2.5);
      expect(result.x1).toBeCloseTo(2.5);
    });

    it("no matching constraint → shape unchanged", () => {
      const shape = L(0, 0, 2, 1);
      const moved = moveShapePoint(shape, "start", { x: 0, y: 0.5 });
      const result = applyHVEnforcement(
        moved,
        "start",
        [hvC(1, "horizontal")],
        0,
      ); // shapeIdx mismatch
      expect(result).toEqual(moved);
    });
  });

  describe("H/V via coincident pull", () => {
    it("pulling an H-constrained line via coincident keeps it horizontal", () => {
      // L0 is horizontal. L1.end=L0.start; drag L1.end → L0 pulled and stays horizontal.
      const shapes = [L(0, 0, 2, 0), L(-1, 0, 0, 0)];
      const constraints = [hvC(0, "horizontal"), coin(1, "end", 0, "start")];
      const result = apply(shapes, constraints, 1, "end", { x: 0, y: 1 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "start").y).toBeCloseTo(pt(result, 0, "end").y);
    });

    it("pulling a V-constrained line via coincident keeps it vertical", () => {
      const shapes = [L(1, 0, 1, 2), L(1, 0, 3, 0)];
      const constraints = [hvC(0, "vertical"), coin(1, "start", 0, "start")];
      const result = apply(shapes, constraints, 1, "start", { x: 2, y: 0 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "start").x).toBeCloseTo(pt(result, 0, "end").x);
    });

    it("H side-effect propagates: when H enforcement shifts the far end, connected shapes follow", () => {
      // L0 is horizontal, L1.start=L0.end (coincident).
      // Pull L0.start up → H enforcement shifts L0.end to same y → L1.start must follow.
      // Simulate cameraControls: pre-apply H/V to primary, then enforce.
      const shapes = [L(0, 0, 2, 0), L(2, 0, 3, -1)];
      const constraints = [hvC(0, "horizontal"), coin(0, "end", 1, "start")];
      const preEnforced = applyHVEnforcement(
        moveShapePoint(shapes[0], "start", { x: 0, y: 1 }),
        "start",
        constraints,
        0,
      );
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preEnforced,
        "start",
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "start").y).toBeCloseTo(1);
      expect(pt(result, 0, "end").y).toBeCloseTo(1); // H enforcement on primary
      expect(pt(result, 1, "start").y).toBeCloseTo(1); // coincident pulls L1
    });
  });

  // ══ DISTANCE – SAME SHAPE (line length / circle radius) ══════════════════

  describe("distance – line length", () => {
    // L0: (0,0)→(3,0), fixed length 3.
    const makeFixedLine = () => ({
      shapes: [L(0, 0, 3, 0)],
      constraints: [fixed(0, "start", 0, "end", 3)],
    });

    it("drag end further → start slides to keep length = 3", () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, "end", { x: 5, y: 0 });
      assertDistancesHold(result, constraints);
      // end should be at (5,0), start adjusted so length stays 3
      expect(pt(result, 0, "end").x).toBeCloseTo(5);
      expect(
        Math.hypot(
          pt(result, 0, "end").x - pt(result, 0, "start").x,
          pt(result, 0, "end").y - pt(result, 0, "start").y,
        ),
      ).toBeCloseTo(3);
    });

    it("drag start → end slides to keep length = 3", () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, "start", { x: 1, y: 0 });
      assertDistancesHold(result, constraints);
      expect(
        Math.hypot(
          pt(result, 0, "end").x - pt(result, 0, "start").x,
          pt(result, 0, "end").y - pt(result, 0, "start").y,
        ),
      ).toBeCloseTo(3);
    });

    it("drag end at angle → length stays 3, direction is preserved", () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, "end", { x: 3, y: 4 }); // dist from origin = 5
      assertDistancesHold(result, constraints);
    });

    it("whole-line translate (null pointKey) → length preserved without enforcement", () => {
      // When primaryPointKey is null (body drag), distance enforcement skips → still correct.
      const { shapes, constraints } = makeFixedLine();
      const movedShape = L(1, 0, 4, 0); // translated by +1, still length 3
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        movedShape,
        null,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertDistancesHold(result, constraints);
    });
  });

  describe("distance – circle radius", () => {
    // Circle at (0,0) with r=5, constrained radius = 3.
    const makeFixedCircle = () => ({
      shapes: [C(0, 0, 5)],
      constraints: [fixed(0, "center", 0, "edge", 3)],
    });

    it("drag center → radius maintained at 3", () => {
      const { shapes, constraints } = makeFixedCircle();
      const result = apply(shapes, constraints, 0, "center", { x: 2, y: 2 });
      assertDistancesHold(result, constraints);
      expect(result[0].r).toBeCloseTo(3);
      expect(result[0].cx).toBeCloseTo(2);
      expect(result[0].cy).toBeCloseTo(2);
    });

    it("drag center in multiple directions → radius stays 3", () => {
      for (const newCenter of [
        { x: 1, y: 0 },
        { x: -3, y: 2 },
        { x: 0, y: -5 },
        { x: 4, y: 4 },
      ]) {
        const { shapes, constraints } = makeFixedCircle();
        const result = apply(shapes, constraints, 0, "center", newCenter);
        assertDistancesHold(result, constraints);
        expect(result[0].r).toBeCloseTo(3);
      }
    });

    it("drag edge point → center slides to keep edge at dragged position, r clamped to constraint", () => {
      // Dragging edge to (7,0) with r_constraint=3: center should slide to (4,0) so that
      // center+(3,0) = edge = (7,0). r is explicitly set to 3 (not left as the raw 7).
      const { shapes, constraints } = makeFixedCircle();
      const result = apply(shapes, constraints, 0, "edge", { x: 7, y: 0 });
      assertDistancesHold(result, constraints);
      expect(result[0].r).toBeCloseTo(3);
      expect(pt(result, 0, "edge")).toMatchObject({
        x: expect.closeTo(7),
        y: expect.closeTo(0),
      });
      expect(pt(result, 0, "center")).toMatchObject({
        x: expect.closeTo(4),
        y: expect.closeTo(0),
      });
    });
  });

  // ══ DISTANCE – TWO SHAPES ════════════════════════════════════════════════

  describe("distance – point-to-point between two shapes", () => {
    it("drag one shape → other adjusts to maintain spacing", () => {
      // Two lines; fixed distance 2 between L0.end and L1.start.
      const shapes = [L(0, 0, 1, 0), L(3, 0, 4, 0)];
      const constraints = [fixed(0, "end", 1, "start", 2)];
      const result = apply(shapes, constraints, 0, "end", { x: 2, y: 0 });
      assertDistancesHold(result, constraints);
    });

    it("drag shape A → shape B shifts proportionally", () => {
      const shapes = [L(0, 0, 1, 0), L(5, 0, 6, 0)];
      const constraints = [fixed(0, "end", 1, "start", 2)];
      // Move L0.end to (3,0); L1.start should move to (5,0) to keep distance 2
      const result = apply(shapes, constraints, 0, "end", { x: 3, y: 0 });
      assertDistancesHold(result, constraints);
      expect(
        Math.hypot(
          pt(result, 1, "start").x - pt(result, 0, "end").x,
          pt(result, 1, "start").y - pt(result, 0, "end").y,
        ),
      ).toBeCloseTo(2);
    });
  });

  // ══ ONLINE CONSTRAINT ════════════════════════════════════════════════════

  // Returns true if `center` projects within the line segment [start, end] (t ∈ [0,1]).
  function isBetweenEndpoints(center, line) {
    const ABx = line.x2 - line.x1,
      ABy = line.y2 - line.y1;
    const len2 = ABx * ABx + ABy * ABy;
    if (len2 < 1e-10) return true;
    const t = ((center.x - line.x1) * ABx + (center.y - line.y1) * ABy) / len2;
    return t >= -1e-9 && t <= 1 + 1e-9;
  }

  describe("onLine constraint", () => {
    // L0 is the host line. Circle center is constrained to lie on L0.
    it("move line → circle center re-projects onto new line position", () => {
      // L0: (0,0)→(4,0) horizontal. Circle center at (2,0) — exactly on line.
      // Tilt line: drag L0.end to (4,1). New line is (0,0)→(4,1).
      // Circle center (2,0) must project onto new line.
      const shapes = [L(0, 0, 4, 0), C(2, 0, 0.5)];
      const constraints = [
        {
          type: "onLine",
          lineShapeIdx: 0,
          pointShapeIdx: 1,
          pointKey: "center",
        },
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 4, y: 1 });
      // Verify center is on the new line (0,0)→(4,1)
      const center = pt(result, 1, "center");
      const line = result[0];
      const ABx = line.x2 - line.x1,
        ABy = line.y2 - line.y1;
      const cross = (center.x - line.x1) * ABy - (center.y - line.y1) * ABx;
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    });

    it("center already on line → no movement", () => {
      const shapes = [L(0, 0, 4, 0), C(2, 0, 0.5)];
      const constraints = [
        {
          type: "onLine",
          lineShapeIdx: 0,
          pointShapeIdx: 1,
          pointKey: "center",
        },
      ];
      // Move line horizontally (center stays on it)
      const result = apply(shapes, constraints, 0, "end", { x: 6, y: 0 });
      // Circle center projected onto (0,0)→(6,0) — stays at (2,0)
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("move circle center off-line → projected back onto segment", () => {
      const shapes = [L(0, 0, 4, 0), C(2, 0, 0.5)];
      const constraints = [
        {
          type: "onLine",
          lineShapeIdx: 0,
          pointShapeIdx: 1,
          pointKey: "center",
        },
      ];
      const result = apply(shapes, constraints, 1, "center", { x: 2, y: 3 });
      // Center should be projected back onto the line
      const center = pt(result, 1, "center");
      const line = result[0];
      const ABx = line.x2 - line.x1,
        ABy = line.y2 - line.y1;
      const cross = (center.x - line.x1) * ABy - (center.y - line.y1) * ABx;
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    });
  });

  // ── onLine segment clamping ───────────────────────────────────────────────
  // The projected point must remain *between* the two line endpoints (t ∈ [0,1]).

  describe("onLine – circle center stays between line endpoints", () => {
    const onLine = (lineIdx, ptIdx) => ({
      type: "onLine",
      lineShapeIdx: lineIdx,
      pointShapeIdx: ptIdx,
      pointKey: "center",
    });

    it("drag circle center past the line end → snaps to line end", () => {
      // Line (0,0)→(4,0). Circle at (2,0). Drag circle to (6,2): t = 1.5 → clamp to end (4,0).
      const shapes = [L(0, 0, 4, 0), C(2, 0, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 1, "center", { x: 6, y: 2 });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(4),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("drag circle center before the line start → snaps to line start", () => {
      // t = -0.75 for projection of (-3,1) onto (0,0)→(4,0) → clamp to start (0,0).
      const shapes = [L(0, 0, 4, 0), C(2, 0, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 1, "center", {
        x: -3,
        y: 1,
      });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("drag line end past the circle center → circle snaps to new line end", () => {
      // Circle at (3,0). Drag line end from (4,0) to (2,0). t of (3,0) on new line = 1.5 → clamp to (2,0).
      const shapes = [L(0, 0, 4, 0), C(3, 0, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 0, "end", { x: 2, y: 0 });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("drag line start past the circle center → circle snaps to new line start", () => {
      // Circle at (1,0). Drag line start from (0,0) to (2,0). t of (1,0) on new line = -0.5 → clamp to (2,0).
      const shapes = [L(0, 0, 4, 0), C(1, 0, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 0, "start", { x: 2, y: 0 });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("circle within segment after move → projects normally (no clamping)", () => {
      // Circle above line midpoint at (2,1). Line (0,0)→(4,0). t = 0.5 → projects to (2,0).
      const shapes = [L(0, 0, 4, 0), C(2, 1, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 1, "center", { x: 2, y: 1 });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("diagonal line – drag circle past end → clamps to diagonal end", () => {
      // Line (0,0)→(3,4) (length 5). Circle at midpoint (1.5,2). Drag to (5,8): t=1.88 → clamp to (3,4).
      const shapes = [L(0, 0, 3, 4), C(1.5, 2, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 1, "center", { x: 5, y: 8 });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(4),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("diagonal line – drag circle before start → clamps to diagonal start", () => {
      // Line (0,0)→(3,4). Drag circle to (-3,-4): t = -1 → clamp to (0,0).
      const shapes = [L(0, 0, 3, 4), C(1.5, 2, 0.5)];
      const result = apply(shapes, [onLine(0, 1)], 1, "center", {
        x: -3,
        y: -4,
      });
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });

    it("translate entire line so circle falls outside → circle follows and clamps", () => {
      // Circle at (5,0) with onLine constraint to (3,0)→(6,0). Translate line to (6,0)→(9,0).
      // Circle center (5,0) projects onto new segment: t = (5-6)/3 = -0.333 → clamp to (6,0).
      const shapes = [L(3, 0, 6, 0), C(5, 0, 0.5)];
      const movedLine = L(6, 0, 9, 0);
      const updated = enforceConstraints(
        shapes,
        [onLine(0, 1)],
        0,
        movedLine,
        null,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      expect(pt(result, 1, "center")).toMatchObject({
        x: expect.closeTo(6),
        y: expect.closeTo(0),
      });
      expect(isBetweenEndpoints(pt(result, 1, "center"), result[0])).toBe(true);
    });
  });

  // ══ PRESEDED (RIGID-GROUP TRANSLATE) ═════════════════════════════════════

  describe("preSeeded rigid-group translate", () => {
    it("translate a coincident pair together → constraint still holds", () => {
      const { shapes, constraints } = twoLinesH();
      // Translate both lines up by 2
      const preSeeded = new Map([
        [0, L(0, 2, 1, 2)],
        [1, L(1, 2, 2, 2)],
      ]);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preSeeded.get(0),
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(2),
      });
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(2),
      });
    });

    it("translate 3-line chain → all coincidents preserved", () => {
      const { shapes, constraints } = threeLines();
      const dx = -1,
        dy = 2;
      const preSeeded = new Map(
        shapes.map((s, i) => [
          i,
          L(s.x1 + dx, s.y1 + dy, s.x2 + dx, s.y2 + dy),
        ]),
      );
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preSeeded.get(0),
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });

    it("translate full rectangle+diagonal → all coincidents preserved", () => {
      const { shapes, constraints } = makeRectDiag();
      const dx = 2,
        dy = 3;
      const preSeeded = new Map(
        shapes.map((s, i) => [
          i,
          L(s.x1 + dx, s.y1 + dy, s.x2 + dx, s.y2 + dy),
        ]),
      );
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preSeeded.get(0),
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });
  });

  // ══ STRESS / REGRESSION COVERAGE FOR COINCIDENT VIOLATIONS ═══════════════
  //
  // These tests target failure modes where a *coincident* constraint can be
  // silently circumvented during a drag operation. Each describes a real-world
  // scenario where naïve solvers (or buggy edits to enforceConstraints) tend
  // to leave one endpoint detached.

  // Helper for chaining: build N collinear lines with end-to-start coincidents.
  function chainOfLines(n) {
    const shapes = [];
    const constraints = [];
    for (let i = 0; i < n; i++) shapes.push(L(i, 0, i + 1, 0));
    for (let i = 0; i < n - 1; i++)
      constraints.push(coin(i, "end", i + 1, "start"));
    return { shapes, constraints };
  }

  // ── Incremental drag (simulate real cursor motion) ───────────────────────
  describe("incremental drag preserves coincidents at every step", () => {
    it("rectangle TL dragged through 50 tiny steps → no detachment ever", () => {
      let { shapes, constraints } = makeRect();
      // Walk TL from (0,2) → (3, 5) in 50 steps. At every step we must remain
      // structurally valid: a single missed propagation in any step would leave
      // an endpoint gap that persists for the rest of the drag.
      const startPos = { x: 0, y: 2 };
      const endPos = { x: 3, y: 5 };
      const N = 50;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const target = {
          x: startPos.x + t * (endPos.x - startPos.x),
          y: startPos.y + t * (endPos.y - startPos.y),
        };
        shapes = apply(shapes, constraints, 0, "start", target);
        assertCoincidesHold(shapes, constraints);
      }
      // Final position reached.
      expect(pt(shapes, 0, "start")).toMatchObject({
        x: expect.closeTo(endPos.x),
        y: expect.closeTo(endPos.y),
      });
    });

    it("rectangle+diagonal TL dragged through 30 steps → diagonal stays connected", () => {
      let { shapes, constraints } = makeRectDiag();
      const N = 30;
      for (let i = 1; i <= N; i++) {
        const target = { x: -i * 0.1, y: 2 + i * 0.15 };
        shapes = apply(shapes, constraints, 3, "end", target);
        assertCoincidesHold(shapes, constraints);
      }
    });

    it("3-line chain end-walk in steps → propagation never falls behind", () => {
      let { shapes, constraints } = threeLines();
      // Drag L0.end around a circular path. L1.start must stay glued at every
      // step. A bug that only fires on large jumps would survive a single
      // assertion but die here.
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * 2 * Math.PI;
        const target = { x: 1 + 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) };
        shapes = apply(shapes, constraints, 0, "end", target);
        assertCoincidesHold(shapes, constraints);
      }
    });
  });

  // ── Body drag (preSeeded primary only, neighbors NOT preseeded) ──────────
  // Real cameraControls.js path when the user drags a shape body without
  // pre-collecting a rigid group: only the dragged shape is preseeded, and
  // the coincident BFS must drag every neighbor along.
  describe("body drag with single-shape preSeeded → neighbors follow", () => {
    it("translate L0 only (preSeeded) → L1.start follows via coincident", () => {
      const { shapes, constraints } = twoLinesH();
      const movedL0 = L(0, 3, 1, 3); // L0 translated up by 3
      const preSeeded = new Map([[0, movedL0]]);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        movedL0,
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      // L1.start should be at L0.end = (1, 3)
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(3),
      });
      // L1.end stays at its original position (only L1.start was pulled)
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("translate middle of a chain (only L1 preSeeded) → both neighbors pull", () => {
      // Body-drag L1 by (+0.5, +1). L0.end and L2.start should both follow.
      const { shapes, constraints } = threeLines();
      const movedL1 = L(1.5, 1, 2.5, 1);
      const preSeeded = new Map([[1, movedL1]]);
      const updated = enforceConstraints(
        shapes,
        constraints,
        1,
        movedL1,
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      // L0.end pulled to L1.start = (1.5, 1)
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1.5),
        y: expect.closeTo(1),
      });
      // L2.start pulled to L1.end = (2.5, 1)
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(2.5),
        y: expect.closeTo(1),
      });
      // Free endpoints stayed
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      expect(pt(result, 2, "end")).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(0),
      });
    });
  });

  // ── Long coincident chains ───────────────────────────────────────────────
  describe("long chains – BFS terminates and constraints hold", () => {
    it.each([5, 8, 12])(
      "chain of %i lines: drag head end → next link follows, tail untouched",
      (n) => {
        const { shapes, constraints } = chainOfLines(n);
        const result = apply(shapes, constraints, 0, "end", { x: 1.5, y: 0.7 });
        assertCoincidesHold(result, constraints);
        expect(pt(result, 1, "start")).toMatchObject({
          x: expect.closeTo(1.5),
          y: expect.closeTo(0.7),
        });
        // The far tail (last line, free end) must not have moved.
        expect(pt(result, n - 1, "end")).toMatchObject({
          x: expect.closeTo(n),
          y: expect.closeTo(0),
        });
      },
    );

    it("chain of 10 lines: drag middle node → exactly the two adjacent shapes move", () => {
      const { shapes, constraints } = chainOfLines(10);
      // Drag L4.end (= L5.start junction).
      const result = apply(shapes, constraints, 4, "end", { x: 5, y: 2 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 5, "start")).toMatchObject({
        x: expect.closeTo(5),
        y: expect.closeTo(2),
      });
      // L3.end (the junction on the other side of L4) is untouched.
      expect(pt(result, 3, "end")).toMatchObject({
        x: expect.closeTo(4),
        y: expect.closeTo(0),
      });
      // Far ends of chain unchanged.
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(0),
        y: expect.closeTo(0),
      });
      expect(pt(result, 9, "end")).toMatchObject({
        x: expect.closeTo(10),
        y: expect.closeTo(0),
      });
    });
  });

  // ── Asymmetric / "backwards" coincident definitions ──────────────────────
  // The constraint may be authored as coin(A, ..., B, ...) or coin(B, ..., A, ...).
  // Both forms must propagate equally — `c.shapeAIdx === idx` and
  // `c.shapeBIdx === idx` branches must both be exercised correctly.
  describe("coincident constraint order independence", () => {
    it("backwards definition (B→A instead of A→B) still propagates", () => {
      const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0)];
      const constraints = [coin(1, "start", 0, "end")]; // reversed from twoLinesH()
      const result = apply(shapes, constraints, 0, "end", { x: 1.5, y: 0.8 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1.5),
        y: expect.closeTo(0.8),
      });
    });

    it("mixed ordering across a rectangle still solves", () => {
      // Same rectangle but every coincident defined "backwards" from makeRect.
      const shapes = [
        L(0, 2, 2, 2),
        L(2, 2, 2, 0),
        L(2, 0, 0, 0),
        L(0, 0, 0, 2),
      ];
      const constraints = [
        coin(0, "start", 3, "end"), // reversed
        coin(1, "start", 0, "end"), // reversed
        coin(2, "start", 1, "end"), // reversed
        coin(3, "start", 2, "end"), // reversed
      ];
      const result = apply(shapes, constraints, 0, "start", { x: 0.5, y: 2.5 });
      assertCoincidesHold(result, constraints);
    });

    it("driving from B-side (originally listed as B) still works", () => {
      // L0 listed as shapeB. Drag it directly — propagation still must reach L1.
      const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0)];
      const constraints = [coin(1, "start", 0, "end")];
      const result = apply(shapes, constraints, 1, "start", { x: 0.3, y: 1.2 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(0.3),
        y: expect.closeTo(1.2),
      });
    });
  });

  // ── 4-way and 5-way junctions (over-determined coincidents) ──────────────
  // Beyond the T-junction (3-way). Each extra branch adds another constraint
  // that must be propagated.
  describe("high-degree junctions", () => {
    it("4-way junction: drag hub → all 3 spokes follow", () => {
      // L0.end = L1.start = L2.start = L3.start, all meeting at (1, 0).
      const shapes = [
        L(0, 0, 1, 0),
        L(1, 0, 2, 0),
        L(1, 0, 1, 2),
        L(1, 0, 1, -2),
      ];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(0, "end", 2, "start"),
        coin(0, "end", 3, "start"),
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 1.7, y: 0.5 });
      assertCoincidesHold(result, constraints);
      for (const i of [1, 2, 3]) {
        expect(pt(result, i, "start")).toMatchObject({
          x: expect.closeTo(1.7),
          y: expect.closeTo(0.5),
        });
      }
    });

    it("5-way junction: drag one spoke → hub + other 3 spokes all coalesce", () => {
      // L0..L4 all meeting at (0,0) via their "start" endpoint.
      const shapes = [
        L(0, 0, 1, 0),
        L(0, 0, -1, 0),
        L(0, 0, 0, 1),
        L(0, 0, 0, -1),
        L(0, 0, 1, 1),
      ];
      const constraints = [
        coin(0, "start", 1, "start"),
        coin(1, "start", 2, "start"),
        coin(2, "start", 3, "start"),
        coin(3, "start", 4, "start"),
      ];
      const result = apply(shapes, constraints, 4, "start", { x: 2, y: 3 });
      assertCoincidesHold(result, constraints);
      for (const i of [0, 1, 2, 3]) {
        expect(pt(result, i, "start")).toMatchObject({
          x: expect.closeTo(2),
          y: expect.closeTo(3),
        });
      }
    });

    it("4-way junction with REDUNDANT closing constraint → still consistent", () => {
      // Same 4-way hub, but with an extra coincident already implied by the others.
      // A bad solver might oscillate or break under the over-determined system.
      const shapes = [
        L(0, 0, 1, 0),
        L(1, 0, 2, 0),
        L(1, 0, 1, 2),
        L(1, 0, 1, -2),
      ];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(0, "end", 2, "start"),
        coin(0, "end", 3, "start"),
        coin(1, "start", 2, "start"), // redundant
        coin(2, "start", 3, "start"), // redundant
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 2.5, y: -1 });
      assertCoincidesHold(result, constraints);
    });
  });

  // ── Closed cycles beyond rectangle ───────────────────────────────────────
  describe("closed polygon cycles", () => {
    it("pentagon (5 sides): drag one vertex → all coincidents hold", () => {
      // Regular-ish pentagon. Vertices V0..V4.
      const V = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2.6, y: 1.9 },
        { x: 1, y: 3 },
        { x: -0.6, y: 1.9 },
      ];
      const shapes = V.map((_, i) =>
        L(V[i].x, V[i].y, V[(i + 1) % 5].x, V[(i + 1) % 5].y),
      );
      const constraints = V.map((_, i) => coin(i, "end", (i + 1) % 5, "start"));
      const result = apply(shapes, constraints, 0, "start", {
        x: -0.5,
        y: -0.3,
      });
      assertCoincidesHold(result, constraints);
      // Verify other 4 vertices unchanged: a buggy cycle-walk could drag every
      // vertex in lock-step around the loop.
      for (let i = 1; i < 5; i++) {
        expect(pt(result, i, "start")).toMatchObject({
          x: expect.closeTo(V[i].x),
          y: expect.closeTo(V[i].y),
        });
      }
    });

    it("two triangles sharing an edge (5 lines, 4 vertices): drag shared-edge endpoint", () => {
      //          V2
      //         /  \
      //   V0 ──┼────V1     V2─V1 is the shared edge between △V0V1V2 and △V1V2V3
      //         \  /
      //          V3
      const V = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1.5 },
        { x: 1, y: -1.5 },
      ];
      // Edges: 0=V0V1, 1=V1V2, 2=V2V0, 3=V1V3, 4=V3V0  (shared edge V1V2 is line 1)
      const shapes = [
        L(V[0].x, V[0].y, V[1].x, V[1].y),
        L(V[1].x, V[1].y, V[2].x, V[2].y),
        L(V[2].x, V[2].y, V[0].x, V[0].y),
        L(V[1].x, V[1].y, V[3].x, V[3].y),
        L(V[3].x, V[3].y, V[0].x, V[0].y),
      ];
      const constraints = [
        // V1 shared by edges 0.end, 1.start, 3.start
        coin(0, "end", 1, "start"),
        coin(1, "start", 3, "start"),
        // V2 shared by 1.end, 2.start
        coin(1, "end", 2, "start"),
        // V0 shared by 0.start, 2.end, 4.end
        coin(0, "start", 2, "end"),
        coin(2, "end", 4, "end"),
        // V3 shared by 3.end, 4.start
        coin(3, "end", 4, "start"),
      ];
      // Drag V1 (a high-degree vertex: 3 edges meet here).
      const result = apply(shapes, constraints, 0, "end", { x: 2.4, y: 0.6 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(2.4),
        y: expect.closeTo(0.6),
      });
      expect(pt(result, 3, "start")).toMatchObject({
        x: expect.closeTo(2.4),
        y: expect.closeTo(0.6),
      });
      // V0 should NOT have moved (it's diagonally opposite).
      expect(pt(result, 0, "start")).toMatchObject({
        x: expect.closeTo(V[0].x),
        y: expect.closeTo(V[0].y),
      });
    });
  });

  // ── Multi-hop H/V side-effect propagation ────────────────────────────────
  // When dragging through a horizontal-constrained line, H enforcement shifts
  // the FAR endpoint, which must then propagate to *its* neighbor too.
  describe("H/V side-effect propagation across multiple hops", () => {
    it("H-line in middle of chain: drag one end → far end shifts AND its neighbor follows", () => {
      // L0 free, L1 horizontal, L2 free.
      //   L0.end = L1.start ; L1.end = L2.start
      //   Drag L0.start way up → propagates to L1.start → H enforcement
      //   shifts L1.end's y to match → must propagate to L2.start.
      const shapes = [L(-1, 0, 0, 0), L(0, 0, 2, 0), L(2, 0, 3, 0)];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(1, "end", 2, "start"),
        hvC(1, "horizontal"),
      ];
      // Simulate the cameraControls flow: pre-apply H/V to primary, then enforce.
      const moved0 = moveShapePoint(shapes[0], "end", { x: 0, y: 2 });
      const updated = enforceConstraints(shapes, constraints, 0, moved0, "end");
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      // L1 should now be horizontal at y=2.
      expect(pt(result, 1, "start").y).toBeCloseTo(2);
      expect(pt(result, 1, "end").y).toBeCloseTo(2);
      // L2.start must have followed L1.end up to y=2.
      expect(pt(result, 2, "start").y).toBeCloseTo(2);
    });

    it("V-line side-effect: pulled vertical line drags its far neighbor sideways", () => {
      // L0 vertical (x=0), L0.end coincident with L1.start.
      // Drag L0.start to x=1 → V enforces L0.end.x = 1 → L1.start must follow.
      const shapes = [L(0, 0, 0, 2), L(0, 2, 3, 2)];
      const constraints = [hvC(0, "vertical"), coin(0, "end", 1, "start")];
      const preEnforced = applyHVEnforcement(
        moveShapePoint(shapes[0], "start", { x: 1, y: 0 }),
        "start",
        constraints,
        0,
      );
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preEnforced,
        "start",
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, "start").x).toBeCloseTo(1);
      expect(pt(result, 0, "end").x).toBeCloseTo(1);
      expect(pt(result, 1, "start").x).toBeCloseTo(1);
    });
  });

  // ── Distance enforcement must not detach coincident neighbors ────────────
  // When a distance constraint moves a shape's endpoint, propagateCoincidentFrom
  // is supposed to pull connected neighbors. Easy to break by editing the
  // distance branch and forgetting that call.
  describe("distance enforcement preserves coincident neighbors", () => {
    it("same-shape length-constrained line drag → coincident neighbor follows", () => {
      // L0 length=3, L1.start coincident with L0.end.
      // Drag L0.start: L0.end slides to keep length=3, L1.start must follow.
      const shapes = [L(0, 0, 3, 0), L(3, 0, 5, 0)];
      const constraints = [
        fixed(0, "start", 0, "end", 3),
        coin(0, "end", 1, "start"),
      ];
      const result = apply(shapes, constraints, 0, "start", { x: 0, y: 1 });
      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);
      const e = pt(result, 0, "end");
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(e.x),
        y: expect.closeTo(e.y),
      });
    });

    it("two-shape distance constraint → coincident neighbor of the corrected shape follows", () => {
      // L0 free, L1 distance=2 from L0.end. L1.end has a coincident neighbor L2.start.
      // Drag L0.end → L1.start moves to satisfy distance → L2 must NOT detach
      // from L1.end (L2.start stays at L1.end since L1.end was not the moved key).
      const shapes = [L(0, 0, 1, 0), L(3, 0, 4, 0), L(4, 0, 5, 0)];
      const constraints = [
        fixed(0, "end", 1, "start", 2),
        coin(1, "end", 2, "start"),
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 2, y: 1 });
      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);
    });

    it("length-constrained line in a rectangle: dragging adjacent corner → all coincidents hold", () => {
      // Rectangle with the top side length-locked. Drag TR → top.length triggers
      // distance adjustment of TL via the anchor relationship, which must
      // propagate via TL's coincident to left.end.
      const { shapes, constraints } = makeRect();
      constraints.push(fixed(0, "start", 0, "end", 2)); // top side length = 2
      const result = apply(shapes, constraints, 0, "end", { x: 2.7, y: 2 });
      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);
    });
  });

  // ── Both endpoints of one shape in different chains ──────────────────────
  // L1 acts as a "bridge" between two independent chains. Dragging one side
  // must not allow the other end of L1 to drift away from its own neighbor.
  describe("bridge shape with both endpoints constrained to separate chains", () => {
    it("dragging one chain doesn't detach the bridge from the other chain", () => {
      // L0─L1─L2 chained, and L3 also constrained to L1.end (a side-branch).
      // Drag L0.start (free end). L1.start follows? No — only L0 moves; L1
      // unconnected to L0.start. Now drag L0.end:
      //   L0.end → L1.start (via coincident)
      //   L1.end is independent of L1.start (line preserves both); L2.start
      //   should NOT have moved, and L3.start (=L1.end) should also not have moved.
      const shapes = [
        L(0, 0, 1, 0),
        L(1, 0, 2, 0),
        L(2, 0, 3, 0),
        L(2, 0, 2, 1),
      ];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(1, "end", 2, "start"),
        coin(1, "end", 3, "start"),
      ];
      // Drag L0.end up — L1.start follows. L1.end stays. L3 and L2 stay glued
      // to L1.end at (2,0).
      const result = apply(shapes, constraints, 0, "end", { x: 1.2, y: 0.9 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1.2),
        y: expect.closeTo(0.9),
      });
      expect(pt(result, 1, "end")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
      expect(pt(result, 3, "start")).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(0),
      });
    });

    it("dragging the SHARED bridge endpoint pulls all branches", () => {
      const shapes = [
        L(0, 0, 1, 0),
        L(1, 0, 2, 0),
        L(2, 0, 3, 0),
        L(2, 0, 2, 1),
      ];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(1, "end", 2, "start"),
        coin(1, "end", 3, "start"),
      ];
      // Drag L1.end (the bridge node where L2 and L3 attach).
      const result = apply(shapes, constraints, 1, "end", { x: 2.5, y: -0.5 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 2, "start")).toMatchObject({
        x: expect.closeTo(2.5),
        y: expect.closeTo(-0.5),
      });
      expect(pt(result, 3, "start")).toMatchObject({
        x: expect.closeTo(2.5),
        y: expect.closeTo(-0.5),
      });
      // L0.end (the other bridge end) is unaffected.
      expect(pt(result, 0, "end")).toMatchObject({
        x: expect.closeTo(1),
        y: expect.closeTo(0),
      });
    });
  });

  // ── Constraint set mutated mid-drag should still solve ───────────────────
  // Defensive: dragging is incremental, and applications often pass the same
  // constraints array repeatedly. A solver that mutates the constraints array
  // (or relies on iteration order) would fail this.
  describe("constraint array immutability across drags", () => {
    it("repeated drags do not mutate constraint definitions", () => {
      const { shapes, constraints } = makeRect();
      const snapshot = JSON.parse(JSON.stringify(constraints));
      let cur = shapes;
      for (let i = 0; i < 10; i++) {
        cur = apply(cur, constraints, 0, "start", {
          x: i * 0.1,
          y: 2 + i * 0.1,
        });
      }
      // Constraints unchanged.
      expect(constraints).toEqual(snapshot);
    });
  });

  // ══ DISTANCE + H/V ON CONSTRAINED RECTANGLE ══════════════════════════════
  //
  // Simulates a realistic sketch workflow: 90×60 mm rectangle (9×6 scene
  // units; MM_PER_UNIT=10) with horizontal/vertical constraints on all
  // sides, a distance constraint on the top edge (=9) and on the left edge
  // (=6).  Dragging the TL corner 20 mm left and 20 mm up should keep
  // right=6 and bottom=9 — the same dimensions as the original rectangle.
  //
  // Shapes: 0=top, 1=right, 2=bottom, 3=left (same winding as makeRect)
  //   TL=(0,6), TR=(9,6), BR=(9,0), BL=(0,0)

  describe("constrained 90×60 rectangle: drag TL keeps right=60mm and bottom=90mm", () => {
    function makeConstrainedRect() {
      return {
        shapes: [
          L(0, 6, 9, 6), // 0: top   TL→TR
          L(9, 6, 9, 0), // 1: right TR→BR
          L(9, 0, 0, 0), // 2: bottom BR→BL
          L(0, 0, 0, 6), // 3: left  BL→TL
        ],
        constraints: [
          coin(3, "end", 0, "start"), // TL
          coin(0, "end", 1, "start"), // TR
          coin(1, "end", 2, "start"), // BR
          coin(2, "end", 3, "start"), // BL
          hvC(0, "horizontal"),
          hvC(1, "vertical"),
          hvC(2, "horizontal"),
          hvC(3, "vertical"),
          fixed(0, "start", 0, "end", 9), // top = 90 mm
          fixed(3, "start", 3, "end", 6), // left = 60 mm
        ],
      };
    }

    it("drag TL 20 mm left+up: right edge stays 6 units, bottom stays 9 units", () => {
      const { shapes, constraints } = makeConstrainedRect();
      // Simulate cameraControls: pre-apply H/V to the dragged shape (top,
      // primaryIdx=0, "start"=TL), then let enforceConstraints propagate.
      // 20 mm left/up = 2 scene units each direction.
      const movedTop = moveShapePoint(shapes[0], "start", { x: -2, y: 8 });
      const preEnforced = applyHVEnforcement(movedTop, "start", constraints, 0);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preEnforced,
        "start",
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;

      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);

      // Right edge length must remain 60 mm (6 scene units).
      expect(
        Math.hypot(
          pt(result, 1, "end").x - pt(result, 1, "start").x,
          pt(result, 1, "end").y - pt(result, 1, "start").y,
        ),
        "right edge length",
      ).toBeCloseTo(6);

      // Bottom edge length must remain 90 mm (9 scene units).
      expect(
        Math.hypot(
          pt(result, 2, "end").x - pt(result, 2, "start").x,
          pt(result, 2, "end").y - pt(result, 2, "start").y,
        ),
        "bottom edge length",
      ).toBeCloseTo(9);
    });

    it("drag BR 20 mm right+down: right edge stays 6 units, bottom stays 9 units", () => {
      const { shapes, constraints } = makeConstrainedRect();
      // Drag right.end (BR) from (9,0) to (11,-2). Pre-apply V enforcement
      // (shape 1 is V-constrained). 20 mm right/down = 2 scene units each.
      const movedRight = moveShapePoint(shapes[1], "end", { x: 11, y: -2 });
      const preEnforced = applyHVEnforcement(movedRight, "end", constraints, 1);
      const updated = enforceConstraints(
        shapes,
        constraints,
        1,
        preEnforced,
        "end",
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;

      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);

      // Right edge length must remain 60 mm (6 scene units).
      expect(
        Math.hypot(
          pt(result, 1, "end").x - pt(result, 1, "start").x,
          pt(result, 1, "end").y - pt(result, 1, "start").y,
        ),
        "right edge length",
      ).toBeCloseTo(6);

      // Bottom edge length must remain 90 mm (9 scene units).
      expect(
        Math.hypot(
          pt(result, 2, "end").x - pt(result, 2, "start").x,
          pt(result, 2, "end").y - pt(result, 2, "start").y,
        ),
        "bottom edge length",
      ).toBeCloseTo(9);
    });
  });

  // ══ DISTANCE + H/V + DIAGONAL ON CONSTRAINED RECTANGLE ══════════════════
  //
  // Same 90×60 mm rectangle as above, extended with a diagonal from TL to BR
  // (shape 4).  Three coincident constraints anchor the diagonal:
  //   diag.start = TL  (via left.end)
  //   diag.end   = BR  (via bottom.start)   -- coin(2,"start",4,"end")
  //   diag.end   = BR  (via right.end)      -- coin(1,"end",4,"end")
  //
  // Both BR constraints are included because buildConstraints in the real app
  // creates a coincident for every existing coincident point at the snap target,
  // producing both constraints when snapping to the BR junction.  Having only
  // the bottom.start path passes tests but leaves assertCoincidesHold blind to
  // the right.end = diag.end relationship; adding coin(1,"end",4,"end") makes
  // that relationship explicit so it is verified by the constraint checker.

  describe("constrained 90×60 rectangle with TL→BR diagonal: drag top edge 20mm down", () => {
    function makeConstrainedRectWithDiag() {
      return {
        shapes: [
          L(0, 6, 9, 6), // 0: top    TL→TR
          L(9, 6, 9, 0), // 1: right  TR→BR
          L(9, 0, 0, 0), // 2: bottom BR→BL
          L(0, 0, 0, 6), // 3: left   BL→TL
          L(0, 6, 9, 0), // 4: diag   TL→BR
        ],
        constraints: [
          coin(3, "end", 0, "start"), // TL
          coin(0, "end", 1, "start"), // TR
          coin(1, "end", 2, "start"), // BR
          coin(2, "end", 3, "start"), // BL
          hvC(0, "horizontal"),
          hvC(1, "vertical"),
          hvC(2, "horizontal"),
          hvC(3, "vertical"),
          fixed(0, "start", 0, "end", 9), // top = 90 mm
          fixed(3, "start", 3, "end", 6), // left = 60 mm
          coin(3, "end", 4, "start"), // diag.start = TL (left.end)
          coin(2, "start", 4, "end"), // diag.end = BR (via bottom.start)
          coin(1, "end", 4, "end"), // diag.end = BR (via right.end)
        ],
      };
    }

    it("drag top edge down 20 mm: diagonal spans new TL→BR, right stays 6 units, bottom stays 9 units", () => {
      const { shapes, constraints } = makeConstrainedRectWithDiag();
      // Drag top.start (TL) from (0,6) to (0,4): 20 mm down = 2 scene units.
      // Pre-apply H enforcement on top before passing to enforceConstraints.
      const movedTop = moveShapePoint(shapes[0], "start", { x: 0, y: 4 });
      const preEnforced = applyHVEnforcement(movedTop, "start", constraints, 0);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preEnforced,
        "start",
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;

      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);

      // Diagonal must still connect TL to BR after the move.
      const tl = pt(result, 0, "start");
      const br = pt(result, 1, "end");
      expect(pt(result, 4, "start"), "diag start = TL").toMatchObject({
        x: expect.closeTo(tl.x),
        y: expect.closeTo(tl.y),
      });
      expect(pt(result, 4, "end"), "diag end = BR").toMatchObject({
        x: expect.closeTo(br.x),
        y: expect.closeTo(br.y),
      });

      // Edge lengths must be preserved.
      expect(
        Math.hypot(
          pt(result, 1, "end").x - pt(result, 1, "start").x,
          pt(result, 1, "end").y - pt(result, 1, "start").y,
        ),
        "right edge length",
      ).toBeCloseTo(6);

      expect(
        Math.hypot(
          pt(result, 2, "end").x - pt(result, 2, "start").x,
          pt(result, 2, "end").y - pt(result, 2, "start").y,
        ),
        "bottom edge length",
      ).toBeCloseTo(9);
    });

    it("body-drag top line down 20 mm: diagonal spans new TL→BR, right stays 6 units, bottom stays 9 units", () => {
      const { shapes, constraints } = makeConstrainedRectWithDiag();
      // Translate both endpoints of top down 2 units (y: 6→4).
      // applyHVEnforcement with null key on a horizontal line: y = (4+4)/2 = 4,
      // so both endpoints stay at y=4 — same as the input, no-op here.
      const draggedTop = { ...shapes[0], y1: 4, y2: 4 };
      const preEnforced = applyHVEnforcement(draggedTop, null, constraints, 0);
      const result = applyBody(shapes, constraints, 0, preEnforced);
      // Note: this test does NOT use a preSeeded rigid set, so the left shape
      // is placed only via coincident propagation.  See the preSeeded test below
      // for the scenario that matches the real app's applySketchDragMove path.

      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);

      // Diagonal must still connect TL to BR after the move.
      const tl = pt(result, 0, "start");
      const br = pt(result, 1, "end");
      expect(pt(result, 4, "start"), "diag start = TL").toMatchObject({
        x: expect.closeTo(tl.x),
        y: expect.closeTo(tl.y),
      });
      expect(pt(result, 4, "end"), "diag end = BR").toMatchObject({
        x: expect.closeTo(br.x),
        y: expect.closeTo(br.y),
      });

      // Edge lengths must be preserved.
      expect(
        Math.hypot(
          pt(result, 1, "end").x - pt(result, 1, "start").x,
          pt(result, 1, "end").y - pt(result, 1, "start").y,
        ),
        "right edge length",
      ).toBeCloseTo(6);

      expect(
        Math.hypot(
          pt(result, 2, "end").x - pt(result, 2, "start").x,
          pt(result, 2, "end").y - pt(result, 2, "start").y,
        ),
        "bottom edge length",
      ).toBeCloseTo(9);
    });

    it("body-drag top line with rigid-set pre-seeding: diagonal spans new TL→BR", () => {
      // Matches applySketchDragMove's actual call path.  That function computes
      // a rigid set of shapes sharing distance constraints, pre-translates them
      // all by the drag delta, then calls enforceConstraints with preSeeded.
      // Top (shape 0) and left (shape 3) both carry distance constraints, so
      // both enter the rigid set and are translated together by dy = -2.
      //
      // The bug this test catches: shape 3 (left, pre-seeded) correctly places
      // bottom.end=(0,-2) via H enforcement.  Shape 1 (right) then places
      // bottom.start=(9,0) and without the fix, H enforcement uses the new
      // start as anchor, resetting both y-coords to 0 and wiping out the
      // already-correct bottom.end.
      const { shapes, constraints } = makeConstrainedRectWithDiag();
      const dy = -2; // drag delta: top moves from y=6 to y=4
      const draggedTop = {
        ...shapes[0],
        y1: shapes[0].y1 + dy,
        y2: shapes[0].y2 + dy,
      };
      const draggedLeft = {
        ...shapes[3],
        y1: shapes[3].y1 + dy,
        y2: shapes[3].y2 + dy,
      };
      const preTop = applyHVEnforcement(draggedTop, null, constraints, 0);
      // Left is V-constrained; dy doesn't change x, so H/V is already satisfied.
      const preSeeded = new Map([
        [0, preTop],
        [3, draggedLeft],
      ]);
      const updated = enforceConstraints(
        shapes,
        constraints,
        0,
        preTop,
        null,
        preSeeded,
      );
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;

      assertCoincidesHold(result, constraints);
      assertDistancesHold(result, constraints);

      const tl = pt(result, 0, "start");
      const br = pt(result, 1, "end");
      expect(pt(result, 4, "start"), "diag start = TL").toMatchObject({
        x: expect.closeTo(tl.x),
        y: expect.closeTo(tl.y),
      });
      expect(pt(result, 4, "end"), "diag end = BR").toMatchObject({
        x: expect.closeTo(br.x),
        y: expect.closeTo(br.y),
      });

      expect(
        Math.hypot(
          pt(result, 1, "end").x - pt(result, 1, "start").x,
          pt(result, 1, "end").y - pt(result, 1, "start").y,
        ),
        "right edge length",
      ).toBeCloseTo(6);

      expect(
        Math.hypot(
          pt(result, 2, "end").x - pt(result, 2, "start").x,
          pt(result, 2, "end").y - pt(result, 2, "start").y,
        ),
        "bottom edge length",
      ).toBeCloseTo(9);
    });
  });

  // ── Same-endpoint redundant coincidents (chain forms a clique) ───────────
  describe("redundant coincidents on the same endpoint", () => {
    it("duplicated coincident has no extra effect", () => {
      const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0)];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(0, "end", 1, "start"), // exact duplicate
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 1.7, y: 0.4 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, "start")).toMatchObject({
        x: expect.closeTo(1.7),
        y: expect.closeTo(0.4),
      });
    });

    it("3 shapes all pairwise coincident at one point (triangular clique on a junction)", () => {
      // L0.end = L1.start, L1.start = L2.start, L0.end = L2.start (clique).
      const shapes = [L(0, 0, 1, 0), L(1, 0, 2, 0), L(1, 0, 1, 1)];
      const constraints = [
        coin(0, "end", 1, "start"),
        coin(1, "start", 2, "start"),
        coin(0, "end", 2, "start"),
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 1.3, y: -0.2 });
      assertCoincidesHold(result, constraints);
    });
  });

  // ── Angle constraint between two straight lines ──────────────────────────
  describe("angle constraint", () => {
    const lineAngleDeg = (result, idx) => {
      const a = pt(result, idx, "start");
      const b = pt(result, idx, "end");
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const betweenDeg = (result, i, j) => {
      let d = Math.abs(lineAngleDeg(result, i) - lineAngleDeg(result, j));
      d = (d * 180) / Math.PI;
      if (d > 180) d = 360 - d;
      return d;
    };

    it("rotating one line rotates the other to keep the 90° angle", () => {
      // L0 +x, L1 +y, sharing the vertex at the origin, locked at 90°.
      const shapes = [L(0, 0, 2, 0), L(0, 0, 0, 2)];
      const constraints = [
        coin(0, "start", 1, "start"),
        {
          type: "angle",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 1,
          pointB: "start",
          angle: 90,
        },
      ];
      // Swing L0 to 45°; L1 must rotate to 135° to keep the 90° between them.
      const result = apply(shapes, constraints, 0, "end", { x: 2, y: 2 });
      assertCoincidesHold(result, constraints);
      expect(betweenDeg(result, 0, 1), "angle between lines").toBeCloseTo(90);
      // L1 keeps its length and stays anchored at the shared vertex.
      const d1 = {
        x: pt(result, 1, "end").x - pt(result, 1, "start").x,
        y: pt(result, 1, "end").y - pt(result, 1, "start").y,
      };
      expect(Math.hypot(d1.x, d1.y), "L1 length").toBeCloseTo(2);
    });

    it("holds a non-right (60°) angle", () => {
      // L1 starts 60° CCW from L0 (+x). Move L0 to +y; L1 should follow to 150°.
      const s60 = {
        x: 2 * Math.cos(Math.PI / 3),
        y: 2 * Math.sin(Math.PI / 3),
      };
      const shapes = [L(0, 0, 2, 0), L(0, 0, s60.x, s60.y)];
      const constraints = [
        coin(0, "start", 1, "start"),
        {
          type: "angle",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 1,
          pointB: "start",
          angle: 60,
        },
      ];
      const result = apply(shapes, constraints, 0, "end", { x: 0, y: 2 });
      assertCoincidesHold(result, constraints);
      expect(betweenDeg(result, 0, 1), "angle between lines").toBeCloseTo(60);
    });
  });

  // ── Chamfer (sketch chamfer-modify geometry + resulting constraints) ─────
  describe("chamfer", () => {
    // Actual angle (deg) the angle-constraint c describes in `shapes`.
    const constraintAngle = (shapes, c) => {
      const P = getShapePoint(shapes[c.shapeAIdx], c.pointA);
      const oA = getShapePoint(
        shapes[c.shapeAIdx],
        c.pointA === "start" ? "end" : "start",
      );
      const oB = getShapePoint(
        shapes[c.shapeBIdx],
        c.pointB === "start" ? "end" : "start",
      );
      let d =
        Math.abs(
          Math.atan2(oA.y - P.y, oA.x - P.x) -
            Math.atan2(oB.y - P.y, oB.x - P.x),
        ) *
        (180 / Math.PI);
      if (d > 180) d = 360 - d;
      return d;
    };

    // Right-angle corner at the origin (legA +x, legB +y), chamfered at 0.25.
    // Returns the post-chamfer fixture exactly as applyModify builds it:
    // legs trimmed back to the corner, a chamfer line (idx 2), and the
    // coincident + angle constraints from chamferConstraints.
    function makeChamferedCorner(dist = 0.25) {
      const legA = L(0, 0, 2, 0); // corner at start
      const legB = L(0, 0, 0, 2); // corner at start
      const geom = computeChamfer(legA, legB, "start", "start", dist);
      const shapes = [
        moveShapePoint(legA, "start", geom.trimA),
        moveShapePoint(legB, "start", geom.trimB),
        L(geom.trimA.x, geom.trimA.y, geom.trimB.x, geom.trimB.y),
      ];
      const constraints = chamferConstraints(2, 0, "start", 1, "start", geom);
      return { shapes, constraints, geom };
    }

    it("computeChamfer trims `dist` along each leg from the corner", () => {
      const geom = computeChamfer(
        L(0, 0, 2, 0),
        L(0, 0, 0, 2),
        "start",
        "start",
        0.25,
      );
      expect(geom.P.x).toBeCloseTo(0);
      expect(geom.P.y).toBeCloseTo(0);
      expect(geom.trimA.x).toBeCloseTo(0.25);
      expect(geom.trimA.y).toBeCloseTo(0);
      expect(geom.trimB.x).toBeCloseTo(0);
      expect(geom.trimB.y).toBeCloseTo(0.25);
      expect(geom.uA.x).toBeCloseTo(1);
      expect(geom.uB.y).toBeCloseTo(1);
    });

    it("computeChamfer handles a non-right (60°) corner and a non-origin vertex", () => {
      // Corner at (1,1); legA along +x, legB 60° from +x.
      const legA = L(1, 1, 3, 1); // corner at start
      const legB = L(
        1,
        1,
        1 + Math.cos(Math.PI / 3) * 2,
        1 + Math.sin(Math.PI / 3) * 2,
      );
      const geom = computeChamfer(legA, legB, "start", "start", 0.5);
      // trim points sit 0.5 from the corner along each unit leg direction
      expect(Math.hypot(geom.trimA.x - 1, geom.trimA.y - 1)).toBeCloseTo(0.5);
      expect(Math.hypot(geom.trimB.x - 1, geom.trimB.y - 1)).toBeCloseTo(0.5);
      expect(geom.trimA.x).toBeCloseTo(1.5);
      expect(geom.trimA.y).toBeCloseTo(1);
      expect(geom.trimB.x).toBeCloseTo(1 + Math.cos(Math.PI / 3) * 0.5);
      expect(geom.trimB.y).toBeCloseTo(1 + Math.sin(Math.PI / 3) * 0.5);
    });

    it("chamferConstraints: 2 coincidents joining the chamfer line + 2 angle locks", () => {
      const geom = computeChamfer(
        L(0, 0, 2, 0),
        L(0, 0, 0, 2),
        "start",
        "start",
        0.25,
      );
      const cs = chamferConstraints(2, 0, "start", 1, "start", geom);
      const coincs = cs.filter((c) => c.type === "coincident");
      const angles = cs.filter((c) => c.type === "angle");
      expect(coincs).toHaveLength(2);
      expect(angles).toHaveLength(2);
      // chamfer line (idx 2) start↔legA.start and end↔legB.start
      expect(coincs[0]).toMatchObject({
        shapeAIdx: 2,
        pointA: "start",
        shapeBIdx: 0,
        pointB: "start",
      });
      expect(coincs[1]).toMatchObject({
        shapeAIdx: 2,
        pointA: "end",
        shapeBIdx: 1,
        pointB: "start",
      });
      // symmetric 90° corner → chamfer makes 135° with each leg
      expect(angles[0].angle).toBeCloseTo(135);
      expect(angles[1].angle).toBeCloseTo(135);
    });

    it("the built chamfer fixture satisfies its own constraints", () => {
      const { shapes, constraints } = makeChamferedCorner();
      assertCoincidesHold(shapes, constraints);
      // every angle lock matches the actual geometry it was built from
      for (const c of constraints) {
        if (c.type !== "angle") continue;
        expect(constraintAngle(shapes, c)).toBeCloseTo(c.angle);
      }
    });

    it("dragging a chamfered leg keeps the chamfer attached and its angle", () => {
      const { shapes, constraints } = makeChamferedCorner();
      // swing legA's far end; the corner endpoint (and chamfer.start) stays put
      const result = apply(shapes, constraints, 0, "end", { x: 2.5, y: 0.6 });
      // chamfer line stays joined to both legs
      assertCoincidesHold(result, constraints);
      // the chamfer↔legA angle (the dragged side) is restored to 135°
      const angA = constraints.find(
        (c) => c.type === "angle" && c.shapeBIdx === 0,
      );
      expect(constraintAngle(result, angA), "chamfer↔legA angle").toBeCloseTo(
        angA.angle,
      );
      // the chamfer line keeps its length (it rotates about the corner)
      const cLen = (s) =>
        Math.hypot(
          pt(s, 2, "end").x - pt(s, 2, "start").x,
          pt(s, 2, "end").y - pt(s, 2, "start").y,
        );
      expect(cLen(result)).toBeCloseTo(cLen(shapes));
    });
  });
});
