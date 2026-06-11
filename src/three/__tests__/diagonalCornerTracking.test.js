// Regression: a rectangle-diagonal corner is coincident to TWO edges at once
// (the diagonal end joins both the vertical right edge and the horizontal
// bottom edge at BR).  Before the final reconciliation pass in
// enforceConstraints, dragging the top edge with a horizontal component placed
// the diagonal end from the right edge (settling its X) and then `placedEP`
// blocked the bottom edge from correcting its Y — stranding the diagonal end
// vertically by the drag's dy.  All coincidents must hold after any edge drag.

import { describe, it, expect } from "vitest";
import { getShapePoint } from "../sceneObjects.js";
import { enforceConstraints } from "../sketchConstraints.js";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const coin = (ai, pa, bi, pb) => ({
  type: "coincident",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
});
const hvC = (idx, t) => ({ type: t, shapeIdx: idx });
const dist = (ai, pa, bi, pb, d) => ({
  type: "distance",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
  distance: d,
});

// Square (10x6) + diagonal TL->BR, with the constraint set the app produces:
//   0=top(TL->TR) H,  1=right(TR->BR) V,  2=bottom(BR->BL) H,  3=left(BL->TL) V
//   4=diag TL->BR.  TL = {0.start, 3.end, 4.start}.  BR = {1.end, 2.start, 4.end}.
const TL = [-5, 5];
const TR = [5, 5];
const BR = [5, -1];
const BL = [-5, -1];
function mk() {
  return {
    shapes: [
      L(...TL, ...TR),
      L(...TR, ...BR),
      L(...BR, ...BL),
      L(...BL, ...TL),
      L(...TL, ...BR),
    ],
    constraints: [
      coin(0, "end", 1, "start"),
      coin(1, "end", 2, "start"),
      coin(2, "end", 3, "start"),
      coin(3, "end", 0, "start"),
      hvC(0, "horizontal"),
      hvC(1, "vertical"),
      hvC(2, "horizontal"),
      hvC(3, "vertical"),
      dist(0, "start", 0, "end", "100"),
      dist(3, "start", 3, "end", "60"),
      coin(4, "start", 0, "start"),
      coin(4, "start", 3, "end"),
      coin(4, "end", 1, "end"),
      coin(4, "end", 2, "start"),
    ],
  };
}

// Whole-edge body drag: rigid set (dragged shape + coincident-connected shapes
// carrying a distance constraint) is pre-translated, then enforced — exactly
// the path applySketchDragMove takes for a shape (not point) drag.
function dragBody(shapes, constraints, shapeIdx, dx, dy) {
  const tr = (s) => ({
    ...s,
    x1: s.x1 + dx,
    y1: s.y1 + dy,
    x2: s.x2 + dx,
    y2: s.y2 + dy,
  });
  const newShape = tr(shapes[shapeIdx]);
  const hasDist = (idx) =>
    constraints.some(
      (c) =>
        c.type === "distance" && (c.shapeAIdx === idx || c.shapeBIdx === idx),
    );
  const rigid = new Set([shapeIdx]);
  const q = [shapeIdx];
  while (q.length) {
    const cur = q.shift();
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let o = null;
      if (c.shapeAIdx === cur && !rigid.has(c.shapeBIdx)) o = c.shapeBIdx;
      else if (c.shapeBIdx === cur && !rigid.has(c.shapeAIdx)) o = c.shapeAIdx;
      if (o !== null && hasDist(o)) {
        rigid.add(o);
        q.push(o);
      }
    }
  }
  const pre = new Map();
  for (const idx of rigid)
    pre.set(idx, idx === shapeIdx ? newShape : tr(shapes[idx]));
  const updated = enforceConstraints(
    shapes,
    constraints,
    shapeIdx,
    newShape,
    null,
    pre,
  );
  const r = shapes.slice();
  for (const [i, s] of updated) r[i] = s;
  return r;
}

function assertCoincidentsHold(r, constraints) {
  for (const c of constraints) {
    if (c.type !== "coincident") continue;
    const a = getShapePoint(r[c.shapeAIdx], c.pointA);
    const b = getShapePoint(r[c.shapeBIdx], c.pointB);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  }
}

describe("square+diagonal: edge drag keeps the diagonal glued to both corners", () => {
  for (const [name, idx, dx, dy] of [
    ["top edge, vertical only", 0, 0, 1],
    ["top edge, horizontal + vertical", 0, 1, 0.5],
    ["top edge, large diagonal motion", 0, 2, 1],
    ["bottom edge, horizontal + vertical", 2, -1, -0.5],
    ["right edge, horizontal + vertical", 1, 0.8, 0.6],
    ["left edge, horizontal + vertical", 3, -0.7, 0.4],
  ]) {
    it(`drag ${name}`, () => {
      const { shapes, constraints } = mk();
      const r = dragBody(shapes, constraints, idx, dx, dy);
      assertCoincidentsHold(r, constraints);
    });
  }
});
