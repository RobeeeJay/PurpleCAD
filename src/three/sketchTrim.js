// Pure geometry for the sketch Trim tool: given a clicked line and a point on
// it, find the portion of the line bounded by the nearest crossings (with other
// shapes, shape vertices, or standalone points) on either side of the click,
// and describe what should replace the line — nothing (delete), one shorter
// segment (shrink), or two segments (split).  No store / scene dependency.

const PARALLEL_EPS = 1e-12;
const INTERIOR_EPS = 1e-7;
// Two cut params closer than this collapse to one (e.g. a shared vertex hit by
// the two edges that meet there).
const MERGE_EPS = 1e-6;

// Closest-point parameter of P on the infinite line A→B, plus its distance.
function projectParam(ax, ay, bx, by, px, py) {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < PARALLEL_EPS) return { t: 0, dist: Math.hypot(px - ax, py - ay) };
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return { t, dist: Math.hypot(px - cx, py - cy) };
}

// Param on line A→B where segment P→Q touches it: interior to the line
// (ti strictly in (0,1)) but anywhere on the other segment incl. its endpoints,
// so T-junctions / shared vertices count as cuts.  null when parallel or no hit.
function segCutOnLine(ax, ay, bx, by, px, py, qx, qy) {
  const dx1 = bx - ax,
    dy1 = by - ay,
    dx2 = qx - px,
    dy2 = qy - py;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < PARALLEL_EPS) return null;
  const gx = px - ax,
    gy = py - ay;
  const ti = (gx * dy2 - gy * dx2) / denom;
  const tj = (gx * dy1 - gy * dx1) / denom;
  if (ti <= INTERIOR_EPS || ti >= 1 - INTERIOR_EPS) return null;
  if (tj < -INTERIOR_EPS || tj > 1 + INTERIOR_EPS) return null;
  return ti;
}

const sampleCircle = (cx, cy, rx, ry, n) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  });

const sampleArc = (s, n) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = s.startAngle + (i / n) * (s.endAngle - s.startAngle);
    return { x: s.cx + Math.cos(a) * s.r, y: s.cy + Math.sin(a) * s.r };
  });

const sampleBezier = (s, n) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      m = 1 - t;
    return {
      x:
        m * m * m * s.p0.x +
        3 * m * m * t * s.p1.x +
        3 * m * t * t * s.p2.x +
        t * t * t * s.p3.x,
      y:
        m * m * m * s.p0.y +
        3 * m * m * t * s.p1.y +
        3 * m * t * t * s.p2.y +
        t * t * t * s.p3.y,
    };
  });

const edgesOf = (pts, closed) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 1) out.push([pts[pts.length - 1], pts[0]]);
  return out;
};

// Polyline edges for any boundary shape (local coords); null for shapes that
// don't bound a trim (text, point — point is handled separately).
function shapeEdges(shape) {
  switch (shape.type) {
    case "line":
      return [
        [
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 },
        ],
      ];
    case "rect": {
      const { x1, y1, x2, y2 } = shape;
      return edgesOf(
        [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ],
        true,
      );
    }
    case "circle":
      return edgesOf(
        sampleCircle(shape.cx, shape.cy, shape.r, shape.r, 64),
        false,
      );
    case "ellipse":
      return edgesOf(
        sampleCircle(shape.cx, shape.cy, shape.rx, shape.ry, 64),
        false,
      );
    case "arc":
      return edgesOf(sampleArc(shape, 48), false);
    case "bezier":
      return edgesOf(sampleBezier(shape, 48), false);
    default:
      return null;
  }
}

// Plan a trim of shapes[lineIdx] at the point (px,py) in sketch-local coords.
// Returns { lineIdx, keepStart, keepEnd } where each keep* is a replacement line
// shape (spread from the original so flags like `dashed` carry over) or null:
//   both null  → delete the line
//   one set    → shrink to that segment
//   both set   → split into the two segments
// keepStart retains the original "start" endpoint; keepEnd the original "end".
// Returns null when the point isn't on a plain line within `tol`.
export function computeLineTrim(
  shapes,
  lineIdx,
  px,
  py,
  tol = 0.5,
  boundaryTol = 1e-3,
) {
  const line = shapes[lineIdx];
  if (!line || line.type !== "line") return null;
  const ax = line.x1,
    ay = line.y1,
    bx = line.x2,
    by = line.y2;
  const { t: tc, dist } = projectParam(ax, ay, bx, by, px, py);
  if (dist > tol || tc <= 0 || tc >= 1) return null;

  const cuts = [0, 1];
  for (let j = 0; j < shapes.length; j++) {
    if (j === lineIdx) continue;
    const s = shapes[j];
    // Text and cogs are locked outlines, not edges a line can be cut against.
    if (!s || s.type === "text" || s.type === "cog") continue;
    if (s.type === "point") {
      const pr = projectParam(ax, ay, bx, by, s.x, s.y);
      if (pr.dist <= boundaryTol && pr.t > MERGE_EPS && pr.t < 1 - MERGE_EPS)
        cuts.push(pr.t);
      continue;
    }
    const edges = shapeEdges(s);
    if (!edges) continue;
    for (const [p, q] of edges) {
      const t = segCutOnLine(ax, ay, bx, by, p.x, p.y, q.x, q.y);
      if (t != null) cuts.push(t);
    }
  }

  cuts.sort((a, b) => a - b);
  const uniq = cuts.filter((v, i) => i === 0 || v - cuts[i - 1] > MERGE_EPS);

  // The interval of the click sits between two consecutive cut params.
  let lo = 0,
    hi = 1;
  for (let i = 0; i < uniq.length - 1; i++) {
    if (tc >= uniq[i] - MERGE_EPS && tc <= uniq[i + 1] + MERGE_EPS) {
      lo = uniq[i];
      hi = uniq[i + 1];
      break;
    }
  }

  const atX = (t) => ax + t * (bx - ax);
  const atY = (t) => ay + t * (by - ay);
  const keepStart =
    lo > MERGE_EPS ? { ...line, x2: atX(lo), y2: atY(lo) } : null;
  const keepEnd =
    hi < 1 - MERGE_EPS ? { ...line, x1: atX(hi), y1: atY(hi) } : null;
  return { lineIdx, keepStart, keepEnd };
}
