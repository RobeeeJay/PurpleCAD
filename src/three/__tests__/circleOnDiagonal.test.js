import { describe, it, expect } from "vitest";
import { getShapePoint } from "../sceneObjects.js";
import { enforceConstraints } from "../sketchConstraints.js";

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const Circ = (cx, cy, r) => ({ type: "circle", cx, cy, r });
const coin = (ai, pa, bi, pb) => ({
  type: "coincident",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
});
const hvC = (idx, t) => ({ type: t, shapeIdx: idx });
const onLine = (pIdx, lIdx) => ({
  type: "onLine",
  pointShapeIdx: pIdx,
  pointKey: "center",
  lineShapeIdx: lIdx,
});
const dist = (ai, pa, bi, pb, d) => ({
  type: "distance",
  shapeAIdx: ai,
  pointA: pa,
  shapeBIdx: bi,
  pointB: pb,
  distance: d,
});

const TL = [-6, 4],
  TR = [6, 4],
  BR = [6, -2],
  BL = [-6, -2];
function mk() {
  return {
    shapes: [
      L(...TL, ...TR),
      L(...TR, ...BR),
      L(...BR, ...BL),
      L(...BL, ...TL),
      L(...TL, ...BR), // 4 diagonal
      Circ(-3, 1, 0.6), // 5 on diagonal-ish
      Circ(1, -1.5, 0.6), // 6 on diagonal-ish
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
      coin(4, "start", 0, "start"),
      coin(4, "start", 3, "end"),
      coin(4, "end", 1, "end"),
      coin(4, "end", 2, "start"),
      onLine(6, 4),
      onLine(5, 4),
      dist(3, "start", 3, "end", "60"),
      dist(0, "start", 0, "end", "120"),
    ],
  };
}
function dragBody(shapes, constraints, shapeIdx, dx, dy) {
  const tr = (s) =>
    s.type === "line"
      ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
      : s;
  const newShape = tr(shapes[shapeIdx]);
  const hasDist = (i) =>
    constraints.some(
      (c) => c.type === "distance" && (c.shapeAIdx === i || c.shapeBIdx === i),
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
  for (const i of rigid) pre.set(i, i === shapeIdx ? newShape : tr(shapes[i]));
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
// distance from circle center to the (infinite) diagonal line through its endpoints
function distToDiag(r, circleIdx) {
  const c = getShapePoint(r[circleIdx], "center");
  const a = { x: r[4].x1, y: r[4].y1 },
    b = { x: r[4].x2, y: r[4].y2 };
  const num = Math.abs(
    (b.y - a.y) * c.x - (b.x - a.x) * c.y + b.x * a.y - b.y * a.x,
  );
  return num / Math.hypot(b.x - a.x, b.y - a.y);
}

describe("circles onLine the diagonal stay on it after edge drags", () => {
  for (const [name, idx, dx, dy] of [
    ["top edge up", 0, 0, 1],
    ["top edge horiz+vert", 0, 1.5, 1],
    ["bottom edge horiz+vert", 2, -1, -0.8],
    ["right edge", 1, 1, 0.5],
  ]) {
    it(`drag ${name}`, () => {
      const { shapes, constraints } = mk();
      const r = dragBody(shapes, constraints, idx, dx, dy);
      expect(distToDiag(r, 5)).toBeLessThan(1e-4);
      expect(distToDiag(r, 6)).toBeLessThan(1e-4);
    });
  }
});
