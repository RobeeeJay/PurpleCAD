import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getShapePoint, moveShapePoint } from '../sceneObjects.js';
import { enforceConstraints, applyHVEnforcement } from '../sketchConstraints.js';

// ── Mock sceneObjects.js ─────────────────────────────────────────────────────
// Only getShapePoint and moveShapePoint are used by enforceConstraints; the
// rest of sceneObjects depends on THREE.js and the DOM which we skip entirely.

vi.mock('../sceneObjects.js', () => {
  const gsp = (shape, key) => {
    switch (shape.type) {
      case 'line':
        if (key === 'start') return { x: shape.x1, y: shape.y1 };
        if (key === 'end')   return { x: shape.x2, y: shape.y2 };
        return null;
      case 'circle':
        if (key === 'edge') return { x: shape.cx + shape.r, y: shape.cy };
        return { x: shape.cx, y: shape.cy }; // center (default)
      case 'rect':
        if (key === 'tl') return { x: shape.x1, y: shape.y1 };
        if (key === 'tr') return { x: shape.x2, y: shape.y1 };
        if (key === 'br') return { x: shape.x2, y: shape.y2 };
        if (key === 'bl') return { x: shape.x1, y: shape.y2 };
        return null;
      default: return null;
    }
  };

  const msp = (shape, key, { x, y }) => {
    switch (shape.type) {
      case 'line':
        if (key === 'start') return { ...shape, x1: x, y1: y };
        if (key === 'end')   return { ...shape, x2: x, y2: y };
        return null;
      case 'circle':
        if (key === 'center') return { ...shape, cx: x, cy: y };
        if (key === 'edge')   return { ...shape, r: Math.hypot(x - shape.cx, y - shape.cy) };
        return null;
      case 'rect':
        if (key === 'tl') return { ...shape, x1: x, y1: y };
        if (key === 'tr') return { ...shape, x2: x, y1: y };
        if (key === 'br') return { ...shape, x2: x, y2: y };
        if (key === 'bl') return { ...shape, x1: x, y2: y };
        return null;
      default: return null;
    }
  };

  return { getShapePoint: gsp, moveShapePoint: msp };
});

// ── Test utilities ───────────────────────────────────────────────────────────

// Apply enforceConstraints and return the merged final shapes array.
function apply(shapes, constraints, primaryIdx, pointKey, newPos, preSeeded = null) {
  const movedShape = moveShapePoint(shapes[primaryIdx], pointKey, newPos);
  const updated = enforceConstraints(shapes, constraints, primaryIdx, movedShape, pointKey, preSeeded);
  const result = shapes.slice();
  for (const [idx, s] of updated) result[idx] = s;
  return result;
}

// applyBody: whole-shape translate — primaryPointKey is null.
function applyBody(shapes, constraints, primaryIdx, primaryShape, preSeeded = null) {
  const updated = enforceConstraints(shapes, constraints, primaryIdx, primaryShape, null, preSeeded);
  const result = shapes.slice();
  for (const [idx, s] of updated) result[idx] = s;
  return result;
}

function assertCoincidesHold(result, constraints) {
  for (const c of constraints) {
    if (c.type !== 'coincident') continue;
    const a = getShapePoint(result[c.shapeAIdx], c.pointA);
    const b = getShapePoint(result[c.shapeBIdx], c.pointB);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    expect(dist, `coincident ${c.shapeAIdx}.${c.pointA} = ${c.shapeBIdx}.${c.pointB}`).toBeLessThan(1e-6);
  }
}

function assertDistancesHold(result, constraints) {
  for (const c of constraints) {
    if (c.type !== 'distance') continue;
    const a = getShapePoint(result[c.shapeAIdx], c.pointA);
    const b = getShapePoint(result[c.shapeBIdx], c.pointB);
    expect(
      Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - c.distance),
      `distance ${c.shapeAIdx}.${c.pointA}↔${c.shapeBIdx}.${c.pointB} = ${c.distance}`,
    ).toBeLessThan(1e-6);
  }
}

function pt(result, idx, key) { return getShapePoint(result[idx], key); }

// ── Shape / constraint shorthand factories ───────────────────────────────────

const L = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
const C = (cx, cy, r)       => ({ type: 'circle', cx, cy, r });

const coin  = (ai, pa, bi, pb)      => ({ type: 'coincident', shapeAIdx: ai, pointA: pa, shapeBIdx: bi, pointB: pb });
const fixed = (ai, pa, bi, pb, d)   => ({ type: 'distance',   shapeAIdx: ai, pointA: pa, shapeBIdx: bi, pointB: pb, distance: d });
const hvC   = (idx, t)              => ({ type: t, shapeIdx: idx });

// ── Fixture factories ────────────────────────────────────────────────────────

// Two lines sharing one endpoint: L0.end = L1.start at (1, 0)
function twoLinesH() {
  return {
    shapes: [L(0,0, 1,0), L(1,0, 2,0)],
    constraints: [coin(0,'end', 1,'start')],
  };
}

// Three collinear lines chained: L0.end=L1.start, L1.end=L2.start
function threeLines() {
  return {
    shapes: [L(0,0, 1,0), L(1,0, 2,0), L(2,0, 3,0)],
    constraints: [coin(0,'end', 1,'start'), coin(1,'end', 2,'start')],
  };
}

// T-junction: L0.end = L1.start = L2.start at (1, 0)
function tJunction() {
  return {
    shapes: [L(0,0, 1,0), L(1,0, 2,0), L(1,0, 1,2)],
    constraints: [coin(0,'end', 1,'start'), coin(0,'end', 2,'start')],
  };
}

// Rectangle: 4 lines, corners coincident.
// 0=top(TL→TR), 1=right(TR→BR), 2=bottom(BR→BL), 3=left(BL→TL)
//   TL=(0,2)  TR=(2,2)
//   BL=(0,0)  BR=(2,0)
function makeRect() {
  return {
    shapes: [L(0,2, 2,2), L(2,2, 2,0), L(2,0, 0,0), L(0,0, 0,2)],
    constraints: [
      coin(3,'end',   0,'start'), // TL: left.end = top.start
      coin(0,'end',   1,'start'), // TR: top.end  = right.start
      coin(1,'end',   2,'start'), // BR: right.end= bottom.start
      coin(2,'end',   3,'start'), // BL: bottom.end= left.start
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
  shapes.push(L(0,2, 2,0)); // shape 4
  constraints.push(
    coin(3,'end',   4,'start'), // TL: left.end = diag.start
    coin(2,'start', 4,'end'),   // BR: bottom.start = diag.end
  );
  return { shapes, constraints };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('enforceConstraints', () => {

  // ══ TWO-LINE JUNCTION ════════════════════════════════════════════════════

  describe('two-line junction (L0.end = L1.start)', () => {
    it('drag L0.end up-right → L1.start follows', () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 0, 'end', { x: 1.5, y: 0.8 });
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1.5), y: expect.closeTo(0.8) });
      assertCoincidesHold(result, constraints);
      // L0.start unchanged
      expect(pt(result, 0, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(0) });
      // L1.end unchanged
      expect(pt(result, 1, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('drag L1.start up-left → L0.end follows', () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 1, 'start', { x: 0.5, y: 1 });
      expect(pt(result, 1, 'start')).toMatchObject({ x: expect.closeTo(0.5), y: expect.closeTo(1) });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(0) });
    });

    it('drag L0.start (unconnected end) → L1 unchanged', () => {
      const { shapes, constraints } = twoLinesH();
      const result = apply(shapes, constraints, 0, 'start', { x: -0.5, y: 0.5 });
      expect(pt(result, 0, 'start')).toMatchObject({ x: expect.closeTo(-0.5), y: expect.closeTo(0.5) });
      // junction should still hold
      assertCoincidesHold(result, constraints);
    });

    it('drag L0.end in multiple directions', () => {
      const moves = [
        { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: -1 }, { x: -0.5, y: 0.5 },
      ];
      for (const newPos of moves) {
        const { shapes, constraints } = twoLinesH();
        const result = apply(shapes, constraints, 0, 'end', newPos);
        assertCoincidesHold(result, constraints);
        expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(newPos.x), y: expect.closeTo(newPos.y) });
      }
    });
  });

  // ══ CHAIN OF THREE LINES ═════════════════════════════════════════════════

  describe('chain of three lines (L0→L1→L2)', () => {
    it('drag L0.end → L1.start follows, L1.end and L2 unaffected', () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 0, 'end', { x: 1.2, y: 0.6 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1.2), y: expect.closeTo(0.6) });
      // L1.end was already matching L2.start and didn't move, so L2 is untouched
      expect(pt(result, 2, 'end')).toMatchObject({ x: expect.closeTo(3), y: expect.closeTo(0) });
    });

    it('drag L1.end → L2.start follows, L0 untouched', () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 1, 'end', { x: 2.5, y: -0.5 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 2, 'start')).toMatchObject({ x: expect.closeTo(2.5), y: expect.closeTo(-0.5) });
      expect(pt(result, 0, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(0) });
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(0) });
    });

    it('drag L2.start → L1.end follows, L0 untouched', () => {
      const { shapes, constraints } = threeLines();
      const result = apply(shapes, constraints, 2, 'start', { x: 1.8, y: 0.4 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, 'end')).toMatchObject({ x: expect.closeTo(1.8), y: expect.closeTo(0.4) });
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(0) });
    });
  });

  // ══ T-JUNCTION ═══════════════════════════════════════════════════════════

  describe('T-junction (L0.end = L1.start = L2.start)', () => {
    it('drag L0.end → both L1.start and L2.start follow', () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 0, 'end', { x: 1.5, y: 0.5 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 1, 'start')).toMatchObject({ x: expect.closeTo(1.5), y: expect.closeTo(0.5) });
      expect(pt(result, 2, 'start')).toMatchObject({ x: expect.closeTo(1.5), y: expect.closeTo(0.5) });
    });

    it('drag L1.start → L0.end and L2.start follow', () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 1, 'start', { x: 0.8, y: -0.3 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(0.8), y: expect.closeTo(-0.3) });
      expect(pt(result, 2, 'start')).toMatchObject({ x: expect.closeTo(0.8), y: expect.closeTo(-0.3) });
    });

    it('drag L2.start → L0.end and L1.start follow', () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 2, 'start', { x: 1, y: 1 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(1) });
      expect(pt(result, 1, 'start')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(1) });
    });

    it('drag L2.end (free end) → other shapes unaffected', () => {
      const { shapes, constraints } = tJunction();
      const result = apply(shapes, constraints, 2, 'end', { x: 2, y: 3 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 2, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(3) });
    });
  });

  // ══ RECTANGLE (CLOSED LOOP) ═══════════════════════════════════════════════

  describe('rectangle – drag each corner', () => {
    it.each([
      ['TL via left.end',    3, 'end',   { x: 0.5, y: 2.5 }],
      ['TL via top.start',   0, 'start', { x: 0.5, y: 2.5 }],
      ['TR via top.end',     0, 'end',   { x: 2.5, y: 2   }],
      ['TR via right.start', 1, 'start', { x: 2.5, y: 2   }],
      ['BR via right.end',   1, 'end',   { x: 2.5, y:-0.5 }],
      ['BR via bottom.start',2, 'start', { x: 2.5, y:-0.5 }],
      ['BL via bottom.end',  2, 'end',   { x:-0.5, y: 0   }],
      ['BL via left.start',  3, 'start', { x:-0.5, y: 0   }],
    ])('drag %s → all coincidents satisfied', (_, primaryIdx, pointKey, newPos) => {
      const { shapes, constraints } = makeRect();
      const result = apply(shapes, constraints, primaryIdx, pointKey, newPos);
      assertCoincidesHold(result, constraints);
      expect(pt(result, primaryIdx, pointKey)).toMatchObject({
        x: expect.closeTo(newPos.x), y: expect.closeTo(newPos.y),
      });
    });

    it('dragging one corner does not move the diagonally opposite corner', () => {
      const { shapes, constraints } = makeRect();
      // Drag TL to (0.5, 2.5) — BR should stay at (2, 0)
      const result = apply(shapes, constraints, 0, 'start', { x: 0.5, y: 2.5 });
      expect(pt(result, 1, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('whole-rectangle translate (preSeeded) preserves all constraints', () => {
      const { shapes, constraints } = makeRect();
      // Translate every shape by (+1, +1)
      const preSeeded = new Map(shapes.map((s, i) => [i, L(s.x1+1, s.y1+1, s.x2+1, s.y2+1)]));
      const primaryShape = preSeeded.get(0);
      const updated = enforceConstraints(shapes, constraints, 0, primaryShape, null, preSeeded);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      // Verify actual translation happened
      expect(pt(result, 0, 'start')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(3) });
      expect(pt(result, 1, 'end')).toMatchObject({ x: expect.closeTo(3), y: expect.closeTo(1) });
    });
  });

  // ══ RECTANGLE WITH DIAGONAL (COMPLEX) ════════════════════════════════════

  describe('rectangle with diagonal (TL→BR)', () => {
    // Shape indices: 0=top 1=right 2=bottom 3=left 4=diagonal
    // TL shared by: top.start, left.end, diag.start
    // TR shared by: top.end, right.start
    // BR shared by: right.end, bottom.start, diag.end
    // BL shared by: bottom.end, left.start

    it.each([
      // [label, primaryIdx, pointKey, newPos, unchangedCorner, unchangedCornerShapes]
      ['TL via left.end',    3,'end',   {x:0.5,y:2.5}, {x:2,y:0}, [1,'end']],
      ['TL via top.start',   0,'start', {x:0.5,y:2.5}, {x:2,y:0}, [1,'end']],
      ['TL via diag.start',  4,'start', {x:0.5,y:2.5}, {x:2,y:0}, [1,'end']],
      ['TR via top.end',     0,'end',   {x:2.5,y:2  }, {x:0,y:0}, [2,'end']],
      ['TR via right.start', 1,'start', {x:2.5,y:2  }, {x:0,y:0}, [2,'end']],
      ['BR via right.end',   1,'end',   {x:2.5,y:-0.5},{x:0,y:2}, [3,'end']],
      ['BR via bottom.start',2,'start', {x:2.5,y:-0.5},{x:0,y:2}, [3,'end']],
      ['BR via diag.end',    4,'end',   {x:2.5,y:-0.5},{x:0,y:2}, [3,'end']],
      ['BL via bottom.end',  2,'end',   {x:-0.5,y:0 }, {x:2,y:2}, [0,'end']],
      ['BL via left.start',  3,'start', {x:-0.5,y:0 }, {x:2,y:2}, [0,'end']],
    ])(
      'drag %s → coincidents hold, opposite diagonal corner unmoved',
      (_, primaryIdx, pointKey, newPos, stayPos, [stayIdx, stayKey]) => {
        const { shapes, constraints } = makeRectDiag();
        const result = apply(shapes, constraints, primaryIdx, pointKey, newPos);
        assertCoincidesHold(result, constraints);
        // Dragged point reached target
        expect(pt(result, primaryIdx, pointKey)).toMatchObject({
          x: expect.closeTo(newPos.x), y: expect.closeTo(newPos.y),
        });
        // Opposite corner (not connected through any chain to this corner) didn't move
        expect(pt(result, stayIdx, stayKey)).toMatchObject({
          x: expect.closeTo(stayPos.x), y: expect.closeTo(stayPos.y),
        });
      },
    );

    it('diagonal stretches when TL moves (diag.start = TL chain)', () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 0, 'start', { x: 0, y: 3 }); // TL moves up
      // diagonal start follows TL
      expect(pt(result, 4, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(3) });
      // diagonal end stays at BR (no movement propagated there)
      expect(pt(result, 4, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('diagonal stretches when BR moves (diag.end = BR chain)', () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 1, 'end', { x: 3, y: 0 }); // BR moves right
      expect(pt(result, 4, 'end')).toMatchObject({ x: expect.closeTo(3), y: expect.closeTo(0) });
      expect(pt(result, 4, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(2) });
    });

    it('diagonal unaffected when only TR corner moves', () => {
      const { shapes, constraints } = makeRectDiag();
      // TR is not connected to the diagonal at all
      const result = apply(shapes, constraints, 0, 'end', { x: 2.5, y: 2 });
      assertCoincidesHold(result, constraints);
      // diagonal start and end unchanged
      expect(pt(result, 4, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(2) });
      expect(pt(result, 4, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('diagonal unaffected when only BL corner moves', () => {
      const { shapes, constraints } = makeRectDiag();
      const result = apply(shapes, constraints, 2, 'end', { x: -0.5, y: 0 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 4, 'start')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(2) });
      expect(pt(result, 4, 'end')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('whole translate (preSeeded) preserves all coincidents', () => {
      const { shapes, constraints } = makeRectDiag();
      const dx = 3, dy = -1;
      const preSeeded = new Map(shapes.map((s, i) => [i, L(s.x1+dx, s.y1+dy, s.x2+dx, s.y2+dy)]));
      const primaryShape = preSeeded.get(0);
      const updated = enforceConstraints(shapes, constraints, 0, primaryShape, null, preSeeded);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });
  });

  // ══ HORIZONTAL / VERTICAL ENFORCEMENT ════════════════════════════════════
  // applyHVEnforcement is applied by cameraControls.js to the primaryShape *before*
  // calling enforceConstraints. enforceConstraints applies it internally only when a
  // shape is pulled via a coincident constraint.

  describe('applyHVEnforcement (direct)', () => {
    it('horizontal: drag start snaps both endpoints to start.y', () => {
      const shape = L(0, 0, 2, 1);
      const moved = moveShapePoint(shape, 'start', { x: 0, y: 0.5 });
      const result = applyHVEnforcement(moved, 'start', [hvC(0, 'horizontal')], 0);
      expect(result.y1).toBeCloseTo(0.5);
      expect(result.y2).toBeCloseTo(0.5);
    });

    it('horizontal: drag end snaps both endpoints to end.y', () => {
      const shape = L(0, 0, 2, 0);
      const moved = moveShapePoint(shape, 'end', { x: 3, y: 0.7 });
      const result = applyHVEnforcement(moved, 'end', [hvC(0, 'horizontal')], 0);
      expect(result.y2).toBeCloseTo(0.7);
      expect(result.y1).toBeCloseTo(0.7);
    });

    it('vertical: drag start snaps both endpoints to start.x', () => {
      const shape = L(0, 0, 0.3, 2);
      const moved = moveShapePoint(shape, 'start', { x: 1, y: 0 });
      const result = applyHVEnforcement(moved, 'start', [hvC(0, 'vertical')], 0);
      expect(result.x1).toBeCloseTo(1);
      expect(result.x2).toBeCloseTo(1);
    });

    it('vertical: drag end snaps both endpoints to end.x', () => {
      const shape = L(1, 0, 1, 2);
      const moved = moveShapePoint(shape, 'end', { x: 2.5, y: 3 });
      const result = applyHVEnforcement(moved, 'end', [hvC(0, 'vertical')], 0);
      expect(result.x2).toBeCloseTo(2.5);
      expect(result.x1).toBeCloseTo(2.5);
    });

    it('no matching constraint → shape unchanged', () => {
      const shape = L(0, 0, 2, 1);
      const moved = moveShapePoint(shape, 'start', { x: 0, y: 0.5 });
      const result = applyHVEnforcement(moved, 'start', [hvC(1, 'horizontal')], 0); // shapeIdx mismatch
      expect(result).toEqual(moved);
    });
  });

  describe('H/V via coincident pull', () => {
    it('pulling an H-constrained line via coincident keeps it horizontal', () => {
      // L0 is horizontal. L1.end=L0.start; drag L1.end → L0 pulled and stays horizontal.
      const shapes = [L(0, 0, 2, 0), L(-1, 0, 0, 0)];
      const constraints = [hvC(0, 'horizontal'), coin(1, 'end', 0, 'start')];
      const result = apply(shapes, constraints, 1, 'end', { x: 0, y: 1 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'start').y).toBeCloseTo(pt(result, 0, 'end').y);
    });

    it('pulling a V-constrained line via coincident keeps it vertical', () => {
      const shapes = [L(1, 0, 1, 2), L(1, 0, 3, 0)];
      const constraints = [hvC(0, 'vertical'), coin(1, 'start', 0, 'start')];
      const result = apply(shapes, constraints, 1, 'start', { x: 2, y: 0 });
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'start').x).toBeCloseTo(pt(result, 0, 'end').x);
    });

    it('H side-effect propagates: when H enforcement shifts the far end, connected shapes follow', () => {
      // L0 is horizontal, L1.start=L0.end (coincident).
      // Pull L0.start up → H enforcement shifts L0.end to same y → L1.start must follow.
      // Simulate cameraControls: pre-apply H/V to primary, then enforce.
      const shapes = [L(0, 0, 2, 0), L(2, 0, 3, -1)];
      const constraints = [hvC(0, 'horizontal'), coin(0, 'end', 1, 'start')];
      const preEnforced = applyHVEnforcement(
        moveShapePoint(shapes[0], 'start', { x: 0, y: 1 }),
        'start', constraints, 0,
      );
      const updated = enforceConstraints(shapes, constraints, 0, preEnforced, 'start');
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'start').y).toBeCloseTo(1);
      expect(pt(result, 0, 'end').y).toBeCloseTo(1);   // H enforcement on primary
      expect(pt(result, 1, 'start').y).toBeCloseTo(1); // coincident pulls L1
    });
  });

  // ══ DISTANCE – SAME SHAPE (line length / circle radius) ══════════════════

  describe('distance – line length', () => {
    // L0: (0,0)→(3,0), fixed length 3.
    const makeFixedLine = () => ({
      shapes: [L(0, 0, 3, 0)],
      constraints: [fixed(0, 'start', 0, 'end', 3)],
    });

    it('drag end further → start slides to keep length = 3', () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, 'end', { x: 5, y: 0 });
      assertDistancesHold(result, constraints);
      // end should be at (5,0), start adjusted so length stays 3
      expect(pt(result, 0, 'end').x).toBeCloseTo(5);
      expect(Math.hypot(
        pt(result,0,'end').x - pt(result,0,'start').x,
        pt(result,0,'end').y - pt(result,0,'start').y,
      )).toBeCloseTo(3);
    });

    it('drag start → end slides to keep length = 3', () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, 'start', { x: 1, y: 0 });
      assertDistancesHold(result, constraints);
      expect(Math.hypot(
        pt(result,0,'end').x - pt(result,0,'start').x,
        pt(result,0,'end').y - pt(result,0,'start').y,
      )).toBeCloseTo(3);
    });

    it('drag end at angle → length stays 3, direction is preserved', () => {
      const { shapes, constraints } = makeFixedLine();
      const result = apply(shapes, constraints, 0, 'end', { x: 3, y: 4 }); // dist from origin = 5
      assertDistancesHold(result, constraints);
    });

    it('whole-line translate (null pointKey) → length preserved without enforcement', () => {
      // When primaryPointKey is null (body drag), distance enforcement skips → still correct.
      const { shapes, constraints } = makeFixedLine();
      const movedShape = L(1, 0, 4, 0); // translated by +1, still length 3
      const updated = enforceConstraints(shapes, constraints, 0, movedShape, null);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertDistancesHold(result, constraints);
    });
  });

  describe('distance – circle radius', () => {
    // Circle at (0,0) with r=5, constrained radius = 3.
    const makeFixedCircle = () => ({
      shapes: [C(0, 0, 5)],
      constraints: [fixed(0, 'center', 0, 'edge', 3)],
    });

    it('drag center → radius maintained at 3', () => {
      const { shapes, constraints } = makeFixedCircle();
      const result = apply(shapes, constraints, 0, 'center', { x: 2, y: 2 });
      assertDistancesHold(result, constraints);
      expect(result[0].r).toBeCloseTo(3);
      expect(result[0].cx).toBeCloseTo(2);
      expect(result[0].cy).toBeCloseTo(2);
    });

    it('drag center in multiple directions → radius stays 3', () => {
      for (const newCenter of [{ x:1,y:0 }, { x:-3,y:2 }, { x:0,y:-5 }, { x:4,y:4 }]) {
        const { shapes, constraints } = makeFixedCircle();
        const result = apply(shapes, constraints, 0, 'center', newCenter);
        assertDistancesHold(result, constraints);
        expect(result[0].r).toBeCloseTo(3);
      }
    });

    it('drag edge point → center slides to keep edge at dragged position, r clamped to constraint', () => {
      // Dragging edge to (7,0) with r_constraint=3: center should slide to (4,0) so that
      // center+(3,0) = edge = (7,0). r is explicitly set to 3 (not left as the raw 7).
      const { shapes, constraints } = makeFixedCircle();
      const result = apply(shapes, constraints, 0, 'edge', { x: 7, y: 0 });
      assertDistancesHold(result, constraints);
      expect(result[0].r).toBeCloseTo(3);
      expect(pt(result, 0, 'edge')).toMatchObject({ x: expect.closeTo(7), y: expect.closeTo(0) });
      expect(pt(result, 0, 'center')).toMatchObject({ x: expect.closeTo(4), y: expect.closeTo(0) });
    });
  });

  // ══ DISTANCE – TWO SHAPES ════════════════════════════════════════════════

  describe('distance – point-to-point between two shapes', () => {
    it('drag one shape → other adjusts to maintain spacing', () => {
      // Two lines; fixed distance 2 between L0.end and L1.start.
      const shapes = [L(0,0, 1,0), L(3,0, 4,0)];
      const constraints = [fixed(0,'end', 1,'start', 2)];
      const result = apply(shapes, constraints, 0, 'end', { x: 2, y: 0 });
      assertDistancesHold(result, constraints);
    });

    it('drag shape A → shape B shifts proportionally', () => {
      const shapes = [L(0,0, 1,0), L(5,0, 6,0)];
      const constraints = [fixed(0,'end', 1,'start', 2)];
      // Move L0.end to (3,0); L1.start should move to (5,0) to keep distance 2
      const result = apply(shapes, constraints, 0, 'end', { x: 3, y: 0 });
      assertDistancesHold(result, constraints);
      expect(Math.hypot(
        pt(result,1,'start').x - pt(result,0,'end').x,
        pt(result,1,'start').y - pt(result,0,'end').y,
      )).toBeCloseTo(2);
    });
  });

  // ══ ONLINE CONSTRAINT ════════════════════════════════════════════════════

  // Returns true if `center` projects within the line segment [start, end] (t ∈ [0,1]).
  function isBetweenEndpoints(center, line) {
    const ABx = line.x2 - line.x1, ABy = line.y2 - line.y1;
    const len2 = ABx * ABx + ABy * ABy;
    if (len2 < 1e-10) return true;
    const t = ((center.x - line.x1) * ABx + (center.y - line.y1) * ABy) / len2;
    return t >= -1e-9 && t <= 1 + 1e-9;
  }

  describe('onLine constraint', () => {
    // L0 is the host line. Circle center is constrained to lie on L0.
    it('move line → circle center re-projects onto new line position', () => {
      // L0: (0,0)→(4,0) horizontal. Circle center at (2,0) — exactly on line.
      // Tilt line: drag L0.end to (4,1). New line is (0,0)→(4,1).
      // Circle center (2,0) must project onto new line.
      const shapes = [L(0,0, 4,0), C(2, 0, 0.5)];
      const constraints = [{ type:'onLine', lineShapeIdx:0, pointShapeIdx:1, pointKey:'center' }];
      const result = apply(shapes, constraints, 0, 'end', { x: 4, y: 1 });
      // Verify center is on the new line (0,0)→(4,1)
      const center = pt(result, 1, 'center');
      const line = result[0];
      const ABx = line.x2-line.x1, ABy = line.y2-line.y1;
      const cross = (center.x-line.x1)*ABy - (center.y-line.y1)*ABx;
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    });

    it('center already on line → no movement', () => {
      const shapes = [L(0,0, 4,0), C(2, 0, 0.5)];
      const constraints = [{ type:'onLine', lineShapeIdx:0, pointShapeIdx:1, pointKey:'center' }];
      // Move line horizontally (center stays on it)
      const result = apply(shapes, constraints, 0, 'end', { x: 6, y: 0 });
      // Circle center projected onto (0,0)→(6,0) — stays at (2,0)
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
    });

    it('move circle center off-line → projected back onto segment', () => {
      const shapes = [L(0,0, 4,0), C(2, 0, 0.5)];
      const constraints = [{ type:'onLine', lineShapeIdx:0, pointShapeIdx:1, pointKey:'center' }];
      const result = apply(shapes, constraints, 1, 'center', { x: 2, y: 3 });
      // Center should be projected back onto the line
      const center = pt(result, 1, 'center');
      const line = result[0];
      const ABx = line.x2-line.x1, ABy = line.y2-line.y1;
      const cross = (center.x-line.x1)*ABy - (center.y-line.y1)*ABx;
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    });
  });

  // ── onLine segment clamping ───────────────────────────────────────────────
  // The projected point must remain *between* the two line endpoints (t ∈ [0,1]).

  describe('onLine – circle center stays between line endpoints', () => {
    const onLine = (lineIdx, ptIdx) => ({ type:'onLine', lineShapeIdx:lineIdx, pointShapeIdx:ptIdx, pointKey:'center' });

    it('drag circle center past the line end → snaps to line end', () => {
      // Line (0,0)→(4,0). Circle at (2,0). Drag circle to (6,2): t = 1.5 → clamp to end (4,0).
      const shapes = [L(0,0, 4,0), C(2,0, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 1, 'center', { x:6, y:2 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(4), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('drag circle center before the line start → snaps to line start', () => {
      // t = -0.75 for projection of (-3,1) onto (0,0)→(4,0) → clamp to start (0,0).
      const shapes = [L(0,0, 4,0), C(2,0, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 1, 'center', { x:-3, y:1 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('drag line end past the circle center → circle snaps to new line end', () => {
      // Circle at (3,0). Drag line end from (4,0) to (2,0). t of (3,0) on new line = 1.5 → clamp to (2,0).
      const shapes = [L(0,0, 4,0), C(3,0, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 0, 'end', { x:2, y:0 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('drag line start past the circle center → circle snaps to new line start', () => {
      // Circle at (1,0). Drag line start from (0,0) to (2,0). t of (1,0) on new line = -0.5 → clamp to (2,0).
      const shapes = [L(0,0, 4,0), C(1,0, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 0, 'start', { x:2, y:0 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('circle within segment after move → projects normally (no clamping)', () => {
      // Circle above line midpoint at (2,1). Line (0,0)→(4,0). t = 0.5 → projects to (2,0).
      const shapes = [L(0,0, 4,0), C(2,1, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 1, 'center', { x:2, y:1 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('diagonal line – drag circle past end → clamps to diagonal end', () => {
      // Line (0,0)→(3,4) (length 5). Circle at midpoint (1.5,2). Drag to (5,8): t=1.88 → clamp to (3,4).
      const shapes = [L(0,0, 3,4), C(1.5,2, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 1, 'center', { x:5, y:8 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(3), y: expect.closeTo(4) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('diagonal line – drag circle before start → clamps to diagonal start', () => {
      // Line (0,0)→(3,4). Drag circle to (-3,-4): t = -1 → clamp to (0,0).
      const shapes = [L(0,0, 3,4), C(1.5,2, 0.5)];
      const result = apply(shapes, [onLine(0,1)], 1, 'center', { x:-3, y:-4 });
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });

    it('translate entire line so circle falls outside → circle follows and clamps', () => {
      // Circle at (5,0) with onLine constraint to (3,0)→(6,0). Translate line to (6,0)→(9,0).
      // Circle center (5,0) projects onto new segment: t = (5-6)/3 = -0.333 → clamp to (6,0).
      const shapes = [L(3,0, 6,0), C(5,0, 0.5)];
      const movedLine = L(6,0, 9,0);
      const updated = enforceConstraints(shapes, [onLine(0,1)], 0, movedLine, null);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      expect(pt(result, 1, 'center')).toMatchObject({ x: expect.closeTo(6), y: expect.closeTo(0) });
      expect(isBetweenEndpoints(pt(result,1,'center'), result[0])).toBe(true);
    });
  });

  // ══ PRESEDED (RIGID-GROUP TRANSLATE) ═════════════════════════════════════

  describe('preSeeded rigid-group translate', () => {
    it('translate a coincident pair together → constraint still holds', () => {
      const { shapes, constraints } = twoLinesH();
      // Translate both lines up by 2
      const preSeeded = new Map([
        [0, L(0,2, 1,2)],
        [1, L(1,2, 2,2)],
      ]);
      const updated = enforceConstraints(shapes, constraints, 0, preSeeded.get(0), null, preSeeded);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
      expect(pt(result, 0, 'end')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(2) });
      expect(pt(result, 1, 'start')).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(2) });
    });

    it('translate 3-line chain → all coincidents preserved', () => {
      const { shapes, constraints } = threeLines();
      const dx = -1, dy = 2;
      const preSeeded = new Map(shapes.map((s, i) => [i, L(s.x1+dx, s.y1+dy, s.x2+dx, s.y2+dy)]));
      const updated = enforceConstraints(shapes, constraints, 0, preSeeded.get(0), null, preSeeded);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });

    it('translate full rectangle+diagonal → all coincidents preserved', () => {
      const { shapes, constraints } = makeRectDiag();
      const dx = 2, dy = 3;
      const preSeeded = new Map(shapes.map((s, i) => [i, L(s.x1+dx, s.y1+dy, s.x2+dx, s.y2+dy)]));
      const updated = enforceConstraints(shapes, constraints, 0, preSeeded.get(0), null, preSeeded);
      const result = shapes.slice();
      for (const [idx, s] of updated) result[idx] = s;
      assertCoincidesHold(result, constraints);
    });
  });
});
