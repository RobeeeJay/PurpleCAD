// Pure 2D geometry helpers for sketches: projection, chamfer/bevel corner math,
// and the constraints a chamfer produces.  No constraint-solving or store
// dependencies — kept apart from the solver in sketchConstraints.js so each
// file stays focused.

import { cogRadii } from "./cogGeometry.js";

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
// `flip` (a negative fillet radius) reflects the arc's centre across the chord
// so the fillet curves the OTHER way — a concave scoop into the corner instead
// of a convex round.  The trim points and radius are unchanged.
export function buildBevelArc(P, uA, uB, trimA, trimB, flip = false) {
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
  let cx = trimA.x + t * pA.x,
    cy = trimA.y + t * pA.y;
  // Reference point the arc should bulge toward: the corner P for a normal
  // fillet; P mirrored across the chord for a flipped one.
  let ref = P;
  if (flip) {
    const cl = Math.hypot(dx, dy) || 1;
    const ux = dx / cl,
      uy = dy / cl;
    const reflect = (px, py) => {
      const proj = (px - trimA.x) * ux + (py - trimA.y) * uy;
      const fx = trimA.x + ux * proj,
        fy = trimA.y + uy * proj;
      return { x: 2 * fx - px, y: 2 * fy - py };
    };
    const c2 = reflect(cx, cy);
    cx = c2.x;
    cy = c2.y;
    ref = reflect(P.x, P.y);
  }
  const r = Math.hypot(cx - trimA.x, cy - trimA.y);
  const startAngle = Math.atan2(trimA.y - cy, trimA.x - cx);
  const rawEnd = Math.atan2(trimB.y - cy, trimB.x - cx);
  const ccwSpan = (rawEnd - startAngle + 2 * Math.PI) % (2 * Math.PI);
  const cwSpan = 2 * Math.PI - ccwSpan;
  const midCW = startAngle - cwSpan / 2;
  const midCCW = startAngle + ccwSpan / 2;
  const dCW = Math.hypot(
    cx + r * Math.cos(midCW) - ref.x,
    cy + r * Math.sin(midCW) - ref.y,
  );
  const dCCW = Math.hypot(
    cx + r * Math.cos(midCCW) - ref.x,
    cy + r * Math.sin(midCCW) - ref.y,
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

  // A negative fillet radius flips the arc (concave scoop); the magnitude sets
  // the trim.  Chamfers stay straight, so a negative setback is just its size.
  const flip = mode === "bevel" && dist < 0;
  const mag = Math.abs(dist);
  let legDist = mag;
  if (mode === "bevel") {
    const dirs = computeChamfer(sA, sB, aKey, bKey, 1);
    const dot = Math.max(
      -1,
      Math.min(1, dirs.uA.x * dirs.uB.x + dirs.uA.y * dirs.uB.y),
    );
    const halfTan = Math.tan(Math.acos(dot) / 2);
    legDist = halfTan > 1e-6 ? mag / halfTan : mag;
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
    const arc = buildBevelArc(m.P, m.uA, m.uB, m.trimA, m.trimB, flip);
    if (arc) {
      arc.kind = "bevel";
      arc.bevelData = {
        aIdx,
        aKey,
        bIdx,
        bKey,
        dist: legDist,
        ...(flip ? { flip: true } : {}),
      };
      newShape = arc;
    } else {
      newShape = straight; // collinear legs: fall back to a straight bridge
    }
    newConstraints = [
      coincident(newIdx, "start", aIdx, aKey),
      coincident(newIdx, "end", bIdx, bKey),
    ];
  }

  // Chamfering splits the corner, so its old vertex-angle lock (e.g. a box's 90°)
  // is dropped below.  Replace it with a direction-angle lock BETWEEN the two legs
  // so the corner stays rigid — without it the chamfered corner can flex freely
  // when a connected line is dragged.  Held on the leg directions (not the bridge),
  // it never over-constrains the bridge the way the old chamfer-to-leg locks did.
  const legAngleDeg =
    (Math.atan2(
      Math.abs(
        (newSA.x2 - newSA.x1) * (newSB.y2 - newSB.y1) -
          (newSA.y2 - newSA.y1) * (newSB.x2 - newSB.x1),
      ),
      (newSA.x2 - newSA.x1) * (newSB.x2 - newSB.x1) +
        (newSA.y2 - newSA.y1) * (newSB.y2 - newSB.y1),
    ) *
      180) /
    Math.PI;
  newConstraints.push({
    type: "lineAngle",
    shapeAIdx: aIdx,
    shapeBIdx: bIdx,
    angle: legAngleDeg,
  });

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

// Resize an existing chamfer / bevel corner to a new user size, in scene units
// (the chamfer's leg setback, or the bevel's arc radius).  Re-derives from the
// two legs' current directions exactly like the solver's corner recomputation:
// finds the virtual corner P where the legs meet, trims each leg back, and
// rebuilds the bridge.  Returns `{ updates: [[idx, shape]…], dist }` (bridge +
// both legs) or null when the data is missing or the legs are degenerate.
// `sizeIsLegDist` distinguishes the two callers: a user resize passes the desired
// setback (chamfer) / radius (bevel) and the radius is converted to the leg
// setback at the corner's angle; the post-solve re-derive passes the already-known
// leg setback (`bevelData.dist`) verbatim.
export function resizeCorner(
  shapes,
  bridgeIdx,
  sizeScene,
  sizeIsLegDist = false,
) {
  const bridge = shapes[bridgeIdx];
  const data = bridge?.chamferData || bridge?.bevelData;
  if (!data) return null;
  const { aIdx, aKey, bIdx, bKey } = data;
  const sA = shapes[aIdx],
    sB = shapes[bIdx];
  if (sA?.type !== "line" || sB?.type !== "line") return null;
  const end = (s, k) =>
    k === "start" ? { x: s.x1, y: s.y1 } : { x: s.x2, y: s.y2 };
  const aEnd = end(sA, aKey),
    aOther = end(sA, aKey === "start" ? "end" : "start");
  const bEnd = end(sB, bKey),
    bOther = end(sB, bKey === "start" ? "end" : "start");
  const dx1 = aEnd.x - aOther.x,
    dy1 = aEnd.y - aOther.y;
  const dx2 = bEnd.x - bOther.x,
    dy2 = bEnd.y - bOther.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const tInter =
    ((bOther.x - aOther.x) * dy2 - (bOther.y - aOther.y) * dx2) / denom;
  const P = { x: aOther.x + tInter * dx1, y: aOther.y + tInter * dy1 };
  const uA = norm2({ x: aOther.x - P.x, y: aOther.y - P.y });
  const uB = norm2({ x: bOther.x - P.x, y: bOther.y - P.y });
  // A NEGATIVE fillet radius flips the arc (concave scoop instead of convex
  // round).  On a direct edit the sign of the input carries it; on a re-derive
  // (leg-dist mode) the flip is remembered on the bevel data.  The magnitude
  // drives the trim either way — only bevels flip; a chamfer stays straight.
  const flip =
    bridge.kind === "bevel"
      ? sizeIsLegDist
        ? !!data.flip
        : sizeScene < 0
      : false;
  const mag = Math.abs(sizeScene);
  let legDist = mag;
  if (!sizeIsLegDist && bridge.kind === "bevel") {
    const dot = Math.max(-1, Math.min(1, uA.x * uB.x + uA.y * uB.y));
    const halfTan = Math.tan(Math.acos(dot) / 2);
    legDist = halfTan > 1e-6 ? mag / halfTan : mag;
  }
  const trimA = { x: P.x + uA.x * legDist, y: P.y + uA.y * legDist };
  const trimB = { x: P.x + uB.x * legDist, y: P.y + uB.y * legDist };
  const newData = { ...data, dist: legDist, ...(flip ? { flip: true } : {}) };
  if (!flip) delete newData.flip;
  let newBridge;
  if (bridge.kind === "bevel") {
    const arc = buildBevelArc(P, uA, uB, trimA, trimB, flip);
    if (!arc) return null;
    arc.kind = "bevel";
    arc.bevelData = newData;
    newBridge = arc;
  } else {
    newBridge = {
      type: "line",
      x1: trimA.x,
      y1: trimA.y,
      x2: trimB.x,
      y2: trimB.y,
      kind: "chamfer",
      chamferData: newData,
    };
  }
  // Carry non-geometric metadata through the re-derive: the user's formula
  // must survive every post-solve corner repair or it silently degrades to a
  // plain number.
  if (typeof bridge.distanceFormula === "string")
    newBridge.distanceFormula = bridge.distanceFormula;
  return {
    updates: [
      [bridgeIdx, newBridge],
      [aIdx, setLineEnd(sA, aKey, trimA)],
      [bIdx, setLineEnd(sB, bKey, trimB)],
    ],
    dist: legDist,
  };
}

// Re-derive a chamfer/bevel bridge from its legs at its STORED leg setback.  The
// numeric solver only pins the bridge's endpoints to the legs; for a bevel arc
// that leaves the radius/centre free to drift, so the fillet degenerates as a
// connected line is dragged.  Re-running this after the solve restores the proper
// tangent arc (and the chamfer's exact setback).
export function rederiveCornerFromLegs(shapes, bridgeIdx) {
  const bridge = shapes[bridgeIdx];
  const data = bridge?.chamferData || bridge?.bevelData;
  if (!data) return null;
  return resizeCorner(shapes, bridgeIdx, data.dist, true);
}

// Re-derive every chamfer/bevel corner in a shape list (post-solve repair).
// Returns the same array reference when there are no corners to touch.  A corner
// is skipped only when one of its legs has its OWN length dimensioned (a self
// distance constraint): re-deriving retrims the leg and would fight that
// dimension, rejecting the edit.  A plain drag — even body-dragging a leg, which
// pins it just like a dimension does — carries no such constraint, so the corner
// re-derives and holds its setback/angle instead of growing.
// Re-derive every chamfer/bevel corner from its (solved) legs.  Corners are
// DERIVED geometry applied after the constraints resolve, so this runs after
// every solve: it re-trims the legs and rebuilds the bridge at the stored
// setback.  A dimension on a trimmed leg measures the SHARP corner (see
// sharpLineExtra), so re-trimming no longer fights the dimension — the old
// length-pinned skip is gone.
export function rederiveAllCorners(shapes) {
  let out = null;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (s?.kind !== "bevel" && s?.kind !== "chamfer") continue;
    const res = rederiveCornerFromLegs(out || shapes, i);
    if (!res) continue;
    if (!out) out = shapes.slice();
    for (const [idx, sh] of res.updates) out[idx] = sh;
  }
  return out || shapes;
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
    case "cog":
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
    case "cog": {
      // The teeth turn with it: its outline is drawn rotated by `rotation`.
      const c = rot(shape.x, shape.y);
      return {
        ...shape,
        x: c.x,
        y: c.y,
        rotation: (shape.rotation || 0) + angle,
      };
    }
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

// Geometric middle of a shape's drawn extent — the anchor a "midpoint"
// constraint pins a point to.  Line: endpoint average.  Arc: the angular
// middle of the drawn sweep.  Bezier: the curve point at t = 0.5.
// The chamfer/bevel corner bridges in a shape list, with their leg refs.  Used
// by the virtual-corner solve: bridges are DERIVED, so the solver works on the
// sharp polygon (legs extended to their intersections) and re-derives corners
// after — they never participate in or fight the constraint solve.
export function extractCorners(shapes) {
  const out = [];
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (s?.kind !== "chamfer" && s?.kind !== "bevel") continue;
    const d = s.chamferData || s.bevelData;
    if (
      !d ||
      shapes[d.aIdx]?.type !== "line" ||
      shapes[d.bIdx]?.type !== "line"
    )
      continue;
    out.push({
      bi: i,
      aIdx: d.aIdx,
      aKey: d.aKey,
      bIdx: d.bIdx,
      bKey: d.bKey,
      dist: d.dist,
      kind: s.kind,
    });
  }
  return out;
}

// Intersection of the two infinite lines carrying line shapes sA and sB, or
// null when parallel.  Trimming a corner moves an endpoint ALONG its leg, so a
// trimmed leg lies on the same infinite line as the sharp one — this recovers
// the sharp corner from the trimmed legs.
export function lineLineIntersect(sA, sB) {
  const den =
    (sA.x1 - sA.x2) * (sB.y1 - sB.y2) - (sA.y1 - sA.y2) * (sB.x1 - sB.x2);
  if (Math.abs(den) < 1e-10) return null;
  const t =
    ((sA.x1 - sB.x1) * (sB.y1 - sB.y2) - (sA.y1 - sB.y1) * (sB.x1 - sB.x2)) /
    den;
  return { x: sA.x1 + t * (sA.x2 - sA.x1), y: sA.y1 + t * (sA.y2 - sA.y1) };
}

// Setback of the chamfer/bevel corner (if any) that trims line `lineIdx` at
// its `key` endpoint.  A chamfer/fillet is DERIVED, applied after dimensions:
// a dimension on the edge measures the SHARP corner (the un-trimmed
// intersection), so length measurements add this back for every trimmed end.
// 0 when the endpoint isn't a corner leg.
export function cornerSetback(shapes, lineIdx, key) {
  if (!shapes) return 0;
  for (const s of shapes) {
    if (s?.kind !== "chamfer" && s?.kind !== "bevel") continue;
    const d = s.chamferData || s.bevelData;
    if (!d) continue;
    if (
      (d.aIdx === lineIdx && d.aKey === key) ||
      (d.bIdx === lineIdx && d.bKey === key)
    )
      return d.dist || 0;
  }
  return 0;
}

// The sharp (virtual-corner) length of a line-length dimension: the trimmed
// endpoint separation plus the setback of any corner cutting each end.  Only
// meaningful for a same-line start↔end measurement, where the setbacks lie
// along the measured direction and so add exactly.
export function sharpLineExtra(shapes, c) {
  if (c.shapeAIdx !== c.shapeBIdx) return 0;
  const s = shapes[c.shapeAIdx];
  if (s?.type !== "line") return 0;
  if (
    !["start", "end"].includes(c.pointA) ||
    !["start", "end"].includes(c.pointB)
  )
    return 0;
  return (
    cornerSetback(shapes, c.shapeAIdx, c.pointA) +
    cornerSetback(shapes, c.shapeBIdx, c.pointB)
  );
}

export function shapeMidpoint(s) {
  if (!s) return null;
  if (s.type === "line") return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  if (s.type === "arc") {
    const mid = s.startAngle + (s.endAngle - s.startAngle) / 2;
    return { x: s.cx + Math.cos(mid) * s.r, y: s.cy + Math.sin(mid) * s.r };
  }
  if (s.type === "bezier") {
    const at = (a, b, c, d) => (a + 3 * b + 3 * c + d) / 8; // cubic at t=0.5
    return {
      x: at(s.p0.x, s.p1.x, s.p2.x, s.p3.x),
      y: at(s.p0.y, s.p1.y, s.p2.y, s.p3.y),
    };
  }
  return null;
}

// Points that together span a shape's drawn extent, in sketch-local
// coordinates.  Curves are sampled, so the extent of an arc or a bezier is the
// curve's, not its control polygon's.
const EXTENT_SAMPLES = 32;
function shapeExtentPoints(s) {
  switch (s?.type) {
    case "line":
    case "rect":
      return [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ];
    case "point":
    case "text":
      return [{ x: s.x, y: s.y }];
    case "cog": {
      // The tip circle bounds the teeth at any rotation.
      const r = cogRadii(s).tip;
      return [
        { x: s.x - r, y: s.y - r },
        { x: s.x + r, y: s.y + r },
      ];
    }
    case "circle":
      return [
        { x: s.cx - s.r, y: s.cy },
        { x: s.cx + s.r, y: s.cy },
        { x: s.cx, y: s.cy - s.r },
        { x: s.cx, y: s.cy + s.r },
      ];
    case "ellipse": {
      const cos = Math.cos(s.rotation ?? 0);
      const sin = Math.sin(s.rotation ?? 0);
      const out = [];
      for (let i = 0; i < EXTENT_SAMPLES; i++) {
        const t = (i / EXTENT_SAMPLES) * Math.PI * 2;
        const ex = s.rx * Math.cos(t);
        const ey = s.ry * Math.sin(t);
        out.push({
          x: s.cx + ex * cos - ey * sin,
          y: s.cy + ex * sin + ey * cos,
        });
      }
      return out;
    }
    case "arc": {
      const out = [];
      for (let i = 0; i <= EXTENT_SAMPLES; i++) {
        const a =
          s.startAngle + ((s.endAngle - s.startAngle) * i) / EXTENT_SAMPLES;
        out.push({ x: s.cx + Math.cos(a) * s.r, y: s.cy + Math.sin(a) * s.r });
      }
      return out;
    }
    case "bezier": {
      const out = [];
      for (let i = 0; i <= EXTENT_SAMPLES; i++) {
        const t = i / EXTENT_SAMPLES;
        const mt = 1 - t;
        const b = (a, c1, c2, d) =>
          mt * mt * mt * a +
          3 * mt * mt * t * c1 +
          3 * mt * t * t * c2 +
          t * t * t * d;
        out.push({
          x: b(s.p0.x, s.p1.x, s.p2.x, s.p3.x),
          y: b(s.p0.y, s.p1.y, s.p2.y, s.p3.y),
        });
      }
      return out;
    }
    default:
      return [];
  }
}

// The centre of a set of shapes -- the middle of their combined bounding box,
// which is what "the centre" of a drawn outline means to someone looking at
// it: the middle of a rectangle, the centre of a circle, the middle of a slot.
// (A centroid of the points would be dragged towards wherever a curve happens
// to be sampled densely.)  Null when the set has no drawable extent.
export function shapeSetCentre(shapes, indices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of indices || []) {
    for (const p of shapeExtentPoints(shapes[i])) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
