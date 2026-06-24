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

const setLineEnd = (line, key, p) =>
  key === "start"
    ? { ...line, x1: p.x, y1: p.y }
    : { ...line, x2: p.x, y2: p.y };

// A coincident joining the new element's endpoint to a trimmed leg's corner.
const coincident = (newIdx, newKey, legIdx, legKey) => ({
  type: "coincident",
  shapeAIdx: newIdx,
  pointA: newKey,
  shapeBIdx: legIdx,
  pointB: legKey,
});

// The full local edit a chamfer ("chamfer") or fillet ("bevel") makes at a
// two-line junction: the two legs trimmed back along their own directions, the
// bridging element (a line for a chamfer, a tangent arc for a fillet), and the
// constraints that join them.  This is deliberately *local* — it touches only
// the two legs, so chamfering never drags geometry the user didn't constrain.
// Both new corners always get a coincident constraint to the bridge; a chamfer
// additionally angle-locks each corner so it holds its shape under later edits.
// `junc` = {aIdx, aKey, bIdx, bKey}; `dist` is the chamfer setback or, for a
// fillet, the desired arc radius (converted to the leg setback so the arc comes
// out that radius at any corner angle).  `constraints` is the sketch's current
// constraint list — every constraint that joined the two corner endpoints
// (coincident *and* angle, e.g. a rectangle's 90 degree lock) is returned in
// `removeConstraints`, since once the corner is split those endpoints are no
// longer one point and such a constraint would span two vertices and corrupt
// later drags.  Returns null on degenerate geometry.
export function buildChamferEdit(shapes, junc, mode, dist, constraints = []) {
  const { aIdx, aKey, bIdx, bKey } = junc;
  const sA = shapes[aIdx],
    sB = shapes[bIdx];
  if (sA?.type !== "line" || sB?.type !== "line") return null;

  let legDist = dist;
  if (mode === "bevel") {
    const dirs = computeChamfer(sA, sB, aKey, bKey, 1);
    const dot = Math.max(
      -1,
      Math.min(1, dirs.uA.x * dirs.uB.x + dirs.uA.y * dirs.uB.y),
    );
    const halfTan = Math.tan(Math.acos(dot) / 2);
    legDist = halfTan > 1e-6 ? dist / halfTan : dist;
  }

  const m = computeChamfer(sA, sB, aKey, bKey, legDist);
  const newSA = setLineEnd(sA, aKey, m.trimA);
  const newSB = setLineEnd(sB, bKey, m.trimB);
  const newIdx = shapes.length;
  const straight = {
    type: "line",
    x1: m.trimA.x,
    y1: m.trimA.y,
    x2: m.trimB.x,
    y2: m.trimB.y,
  };

  let newShape;
  let newConstraints;
  if (mode === "chamfer") {
    // Carry the junction so the solver can re-derive the cut from its legs on
    // every edit (see sketchConstraints' corner recomputation) — the same robust
    // approach as the bevel arc.  Angle-lock constraints (chamferConstraints) used
    // to hold the shape but break when a *connected* line is dragged, because the
    // chamfer line ends up coincident- AND angle-bound to legs that have rotated.
    straight.kind = "chamfer";
    straight.chamferData = { aIdx, aKey, bIdx, bKey, dist: legDist };
    newShape = straight;
    newConstraints = [
      coincident(newIdx, "start", aIdx, aKey),
      coincident(newIdx, "end", bIdx, bKey),
    ];
  } else {
    const arc = buildBevelArc(m.P, m.uA, m.uB, m.trimA, m.trimB);
    if (arc) {
      arc.kind = "bevel";
      arc.bevelData = { aIdx, aKey, bIdx, bKey, dist: legDist };
      newShape = arc;
    } else {
      newShape = straight; // collinear legs: fall back to a straight bridge
    }
    newConstraints = [
      coincident(newIdx, "start", aIdx, aKey),
      coincident(newIdx, "end", bIdx, bKey),
    ];
  }

  const joinsCorner = (c) => {
    const m2 = (i1, k1, i2, k2) =>
      c.shapeAIdx === i1 &&
      c.pointA === k1 &&
      c.shapeBIdx === i2 &&
      c.pointB === k2;
    return (
      (c.type === "coincident" || c.type === "angle") &&
      (m2(aIdx, aKey, bIdx, bKey) || m2(bIdx, bKey, aIdx, aKey))
    );
  };

  return {
    updates: [
      [aIdx, newSA],
      [bIdx, newSB],
    ],
    newShape,
    newConstraints,
    removeConstraints: constraints.filter(joinsCorner),
    legDist,
  };
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
    case "text":
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    default:
      return null;
  }
}

// Explode glyph contours (absolute polylines) into ordinary editable geometry:
// each contour becomes a closed chain of `line` segments joined by coincident
// constraints.  Indices are offset by `baseIdx` (where the lines are appended).
// Pure — the caller supplies the absolute contours.
export function explodeContours(contours, baseIdx) {
  const shapes = [];
  const constraints = [];
  for (const raw of contours || []) {
    const pts = raw.map((p) => ({ x: p.x, y: p.y }));
    // Drop a duplicated closing point so the loop isn't degenerate.
    if (pts.length >= 2) {
      const a = pts[0],
        b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts.pop();
    }
    if (pts.length < 3) continue;
    const start = baseIdx + shapes.length;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      shapes.push({ type: "line", x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    });
    pts.forEach((_, i) => {
      constraints.push({
        type: "coincident",
        shapeAIdx: start + i,
        pointA: "end",
        shapeBIdx: start + ((i + 1) % pts.length),
        pointB: "start",
      });
    });
  }
  return { shapes, constraints };
}

// Rotate every defining point of a shape about (cx, cy) by `angle` radians.
// Rects are returned unchanged (they can't represent a non-axis-aligned box).
export function rotateShape(shape, cx, cy, angle) {
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const rot = (x, y) => {
    const dx = x - cx,
      dy = y - cy;
    return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
  };
  switch (shape.type) {
    case "line": {
      const a = rot(shape.x1, shape.y1);
      const b = rot(shape.x2, shape.y2);
      return { ...shape, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "circle": {
      const c = rot(shape.cx, shape.cy);
      return { ...shape, cx: c.x, cy: c.y };
    }
    case "ellipse": {
      const c = rot(shape.cx, shape.cy);
      return {
        ...shape,
        cx: c.x,
        cy: c.y,
        rotation: (shape.rotation || 0) + angle,
      };
    }
    case "arc": {
      const c = rot(shape.cx, shape.cy);
      return {
        ...shape,
        cx: c.x,
        cy: c.y,
        startAngle: shape.startAngle + angle,
        endAngle: shape.endAngle + angle,
      };
    }
    case "bezier":
      return {
        ...shape,
        p0: rot(shape.p0.x, shape.p0.y),
        p1: rot(shape.p1.x, shape.p1.y),
        p2: rot(shape.p2.x, shape.p2.y),
        p3: rot(shape.p3.x, shape.p3.y),
      };
    default:
      return { ...shape };
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
