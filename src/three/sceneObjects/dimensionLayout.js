// Where each linear sketch dimension's line sits: the first one at the usual
// offset from what it measures, and every later one that would land on an
// earlier one's line or label pushed out by another step, so overlapping
// dimensions stack instead of drawing over each other.  Pure 2D, in
// sketch-local units, so it is shared by the drawing and its tests.

import { cornerSetback } from "../sketchGeometry.js";
import { getShapePoint } from "./sketchShapes.js";

export const DIM_OFFSET = 0.55;
// Labels are kept a constant size and upright on screen; this is roughly one
// label's box in sketch units at the sketch's opening zoom.  Upright means a
// vertical dimension's label sticks out SIDEWAYS, across its neighbours.
const LABEL_W = 0.9;
const LABEL_H = 0.22;
const LABEL_PAD = 0.04;
// Two dimension lines closer than this, side by side, read as one.
const LINE_SEPARATION = 0.12;
const PARALLEL_SIN = Math.sin((5 * Math.PI) / 180);
// Searched in small steps so a dimension lands just clear of what it would
// have hit, never a whole label past it; given up five units out.
const SEARCH_STEP = 0.05;
const MAX_STEPS = 100;

// The two measured points of a linear dimension, or null for anything that
// isn't one (a radius, an angle, a point already on its line).
export function linearDimensionEnds(c, shapes) {
  if (c.type === "distance") {
    const sA = shapes[c.shapeAIdx];
    const sB = shapes[c.shapeBIdx];
    if (!sA || !sB) return null;
    if (c.shapeAIdx === c.shapeBIdx && c.pointB === "edge") return null;
    let a = getShapePoint(sA, c.pointA);
    let b = getShapePoint(sB, c.pointB);
    if (!a || !b) return null;
    // A line-length dimension measures the SHARP corner: its witness lines
    // reach the virtual (pre-chamfer/fillet) corner, not the trimmed edge.
    if (
      c.shapeAIdx === c.shapeBIdx &&
      sA.type === "line" &&
      ["start", "end"].includes(c.pointA) &&
      ["start", "end"].includes(c.pointB)
    ) {
      const setA = cornerSetback(shapes, c.shapeAIdx, c.pointA);
      const setB = cornerSetback(shapes, c.shapeBIdx, c.pointB);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      if (setA) a = { x: a.x - ux * setA, y: a.y - uy * setA };
      if (setB) b = { x: b.x + ux * setB, y: b.y + uy * setB };
    }
    return Math.hypot(b.x - a.x, b.y - a.y) > 1e-9 ? { a, b } : null;
  }
  if (c.type === "pointLineDistance") {
    const line = shapes[c.lineShapeIdx];
    const ptShape = shapes[c.pointShapeIdx];
    if (line?.type !== "line" || !ptShape) return null;
    const a = getShapePoint(ptShape, c.pointKey ?? "point");
    if (!a) return null;
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-20) return null;
    // Foot of the perpendicular on the INFINITE line.
    const t = ((a.x - line.x1) * dx + (a.y - line.y1) * dy) / len2;
    const b = { x: line.x1 + dx * t, y: line.y1 + dy * t };
    return Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 ? { a, b } : null;
  }
  return null;
}

// A dimension at offset `off`: its line's two ends and its label's box.
function placed(a, b, off) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  // The left normal of a -> b: the side the drawing pushes the line to.
  const n = { x: -u.y, y: u.x };
  const p = { x: a.x + n.x * off, y: a.y + n.y * off };
  const q = { x: b.x + n.x * off, y: b.y + n.y * off };
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const box = {
    x0: mx - LABEL_W / 2 - LABEL_PAD,
    x1: mx + LABEL_W / 2 + LABEL_PAD,
    y0: my - LABEL_H / 2 - LABEL_PAD,
    y1: my + LABEL_H / 2 + LABEL_PAD,
  };
  return { p, q, u, n, box };
}

const boxesMeet = (b, c) =>
  b.x0 < c.x1 && c.x0 < b.x1 && b.y0 < c.y1 && c.y0 < b.y1;

// Does segment p-q pass through the box?  Clipped against each slab in turn.
function segmentMeetsBox(p, q, b) {
  let t0 = 0;
  let t1 = 1;
  const d = [q.x - p.x, q.y - p.y];
  const o = [p.x, p.y];
  const lo = [b.x0, b.y0];
  const hi = [b.x1, b.y1];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] <= lo[k] || o[k] >= hi[k]) return false;
      continue;
    }
    let ta = (lo[k] - o[k]) / d[k];
    let tb = (hi[k] - o[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

// Two dimension lines running along each other, too close to tell apart.
function linesRunTogether(d, e) {
  if (Math.abs(d.u.x * e.u.y - d.u.y * e.u.x) > PARALLEL_SIN) return false;
  const apart = (e.p.x - d.p.x) * d.n.x + (e.p.y - d.p.y) * d.n.y;
  if (Math.abs(apart) >= LINE_SEPARATION) return false;
  const along = (pt) => (pt.x - d.p.x) * d.u.x + (pt.y - d.p.y) * d.u.y;
  const [lo1, hi1] = [0, along(d.q)].sort((x, y) => x - y);
  const [lo2, hi2] = [along(e.p), along(e.q)].sort((x, y) => x - y);
  return lo2 < hi1 && lo1 < hi2;
}

// Whether two placed dimensions would be hard to read: their labels overlap,
// either label sits on the other's line, or the lines run on top of each
// other.
const clash = (d, e) =>
  boxesMeet(d.box, e.box) ||
  segmentMeetsBox(d.p, d.q, e.box) ||
  segmentMeetsBox(e.p, e.q, d.box) ||
  linesRunTogether(d, e);

// Constraint index -> the offset its dimension line is drawn at.  Earlier
// constraints keep the usual offset; a later one moves out a step at a time
// until its line and label are clear of every dimension placed before it.
// Its own label sitting on its own line is how every dimension is drawn, so
// a dimension is only ever tested against the others.
export function dimensionOffsets(constraints, shapes) {
  const offsets = new Map();
  const done = [];
  constraints.forEach((c, ci) => {
    const ends = linearDimensionEnds(c, shapes);
    if (!ends) return;
    // Out from the usual offset to the nearest place clear of the rest.
    let off = DIM_OFFSET;
    let p = placed(ends.a, ends.b, off);
    for (let k = 1; k <= MAX_STEPS && done.some((q) => clash(q, p)); k++) {
      off = DIM_OFFSET + k * SEARCH_STEP;
      p = placed(ends.a, ends.b, off);
    }
    offsets.set(ci, off);
    done.push(p);
  });
  return offsets;
}
