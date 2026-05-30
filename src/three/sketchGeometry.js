// Pure 2D geometry helpers for sketches: projection, chamfer/bevel corner math,
// and the constraints a chamfer produces.  No constraint-solving or store
// dependencies — kept apart from the solver in sketchConstraints.js so each
// file stays focused.

// Project a 2D point onto the line segment defined by a line shape.
// t is clamped to [0,1] so the result always lies between the two endpoints.
export function projectOntoLine(pt, lineShape) {
  const ABx = lineShape.x2 - lineShape.x1,
    ABy = lineShape.y2 - lineShape.y1;
  const len2 = ABx * ABx + ABy * ABy;
  if (len2 < 1e-10) return { x: lineShape.x1, y: lineShape.y1 };
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pt.x - lineShape.x1) * ABx + (pt.y - lineShape.y1) * ABy) / len2,
    ),
  );
  return { x: lineShape.x1 + t * ABx, y: lineShape.y1 + t * ABy };
}

// Normalize a 2D vector, returning the original if it has near-zero length.
export function norm2(v) {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-10 ? v : { x: v.x / l, y: v.y / l };
}

// Chamfer/bevel corner geometry: the corner P (where the two lines meet), the
// unit directions of each leg away from P, and the trim points `dist` along
// each leg.  Pure — shared by the chamfer/bevel modify tools and their tests.
export function computeChamfer(sA, sB, aKey, bKey, dist) {
  const P = aKey === "start" ? { x: sA.x1, y: sA.y1 } : { x: sA.x2, y: sA.y2 };
  const oA = aKey === "start" ? { x: sA.x2, y: sA.y2 } : { x: sA.x1, y: sA.y1 };
  const oB = bKey === "start" ? { x: sB.x2, y: sB.y2 } : { x: sB.x1, y: sB.y1 };
  const uA = norm2({ x: oA.x - P.x, y: oA.y - P.y });
  const uB = norm2({ x: oB.x - P.x, y: oB.y - P.y });
  const trimA = { x: P.x + uA.x * dist, y: P.y + uA.y * dist };
  const trimB = { x: P.x + uB.x * dist, y: P.y + uB.y * dist };
  return { P, uA, uB, trimA, trimB };
}

// Angle (degrees, 0–180) between two 2D direction vectors.
function angleBetweenDeg(v1, v2) {
  let d =
    Math.abs(Math.atan2(v1.y, v1.x) - Math.atan2(v2.y, v2.x)) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

// Constraints a chamfer adds: the new chamfer line (newIdx) coincident to each
// trimmed leg's corner endpoint, plus an angle lock on each of the two new
// corners so the chamfer keeps its shape under edits.  `geom` is computeChamfer.
export function chamferConstraints(newIdx, aIdx, aKey, bIdx, bKey, geom) {
  const { uA, uB, trimA, trimB } = geom;
  return [
    {
      type: "coincident",
      shapeAIdx: newIdx,
      pointA: "start",
      shapeBIdx: aIdx,
      pointB: aKey,
    },
    {
      type: "coincident",
      shapeAIdx: newIdx,
      pointA: "end",
      shapeBIdx: bIdx,
      pointB: bKey,
    },
    {
      type: "angle",
      shapeAIdx: newIdx,
      pointA: "start",
      shapeBIdx: aIdx,
      pointB: aKey,
      angle: angleBetweenDeg(
        { x: trimB.x - trimA.x, y: trimB.y - trimA.y },
        uA,
      ),
    },
    {
      type: "angle",
      shapeAIdx: newIdx,
      pointA: "end",
      shapeBIdx: bIdx,
      pointB: bKey,
      angle: angleBetweenDeg(
        { x: trimA.x - trimB.x, y: trimA.y - trimB.y },
        uB,
      ),
    },
  ];
}

// Build the arc geometry for a bevel/fillet between two trimmed lines.
export function buildBevelArc(P, uA, uB, trimA, trimB) {
  const toB = { x: trimB.x - trimA.x, y: trimB.y - trimA.y };
  const pA1 = { x: -uA.y, y: uA.x },
    pA2 = { x: uA.y, y: -uA.x };
  const pA = pA1.x * toB.x + pA1.y * toB.y > 0 ? pA1 : pA2;
  const toA = { x: trimA.x - trimB.x, y: trimA.y - trimB.y };
  const pB1 = { x: -uB.y, y: uB.x },
    pB2 = { x: uB.y, y: -uB.x };
  const pB = pB1.x * toA.x + pB1.y * toA.y > 0 ? pB1 : pB2;
  const dx = trimB.x - trimA.x,
    dy = trimB.y - trimA.y;
  const denom = pA.x * pB.y - pA.y * pB.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = (dx * pB.y - dy * pB.x) / denom;
  const cx = trimA.x + t * pA.x,
    cy = trimA.y + t * pA.y;
  const r = Math.hypot(cx - trimA.x, cy - trimA.y);
  const startAngle = Math.atan2(trimA.y - cy, trimA.x - cx);
  const rawEnd = Math.atan2(trimB.y - cy, trimB.x - cx);
  const ccwSpan = (rawEnd - startAngle + 2 * Math.PI) % (2 * Math.PI);
  const cwSpan = 2 * Math.PI - ccwSpan;
  const midCW = startAngle - cwSpan / 2;
  const midCCW = startAngle + ccwSpan / 2;
  const dCW = Math.hypot(
    cx + r * Math.cos(midCW) - P.x,
    cy + r * Math.sin(midCW) - P.y,
  );
  const dCCW = Math.hypot(
    cx + r * Math.cos(midCCW) - P.x,
    cy + r * Math.sin(midCCW) - P.y,
  );
  const endAngle = dCW < dCCW ? startAngle - cwSpan : startAngle + ccwSpan;
  return { type: "arc", cx, cy, r, startAngle, endAngle };
}

// Translate any sketch shape by (dx, dy).  Returns a new shape, or null for
// unknown types.  Used by sketch-element body-drag and clipboard paste.
export function translateShape(shape, dx, dy) {
  switch (shape.type) {
    case "line":
      return {
        ...shape,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
      };
    case "rect":
      return {
        ...shape,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
      };
    case "circle":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "ellipse":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "arc":
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case "bezier":
      return {
        ...shape,
        p0: { x: shape.p0.x + dx, y: shape.p0.y + dy },
        p1: { x: shape.p1.x + dx, y: shape.p1.y + dy },
        p2: { x: shape.p2.x + dx, y: shape.p2.y + dy },
        p3: { x: shape.p3.x + dx, y: shape.p3.y + dy },
      };
    default:
      return null;
  }
}

// BFS over coincident constraints to collect every shape index reachable from
// startIdx (a connected cluster of joined shapes).
export function collectConnectedShapes(startIdx, shapes, constraints) {
  const visited = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length > 0) {
    const idx = queue.shift();
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let other = -1;
      if (c.shapeAIdx === idx && !visited.has(c.shapeBIdx)) other = c.shapeBIdx;
      else if (c.shapeBIdx === idx && !visited.has(c.shapeAIdx))
        other = c.shapeAIdx;
      if (other >= 0 && shapes[other]) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return [...visited];
}
