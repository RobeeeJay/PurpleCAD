// Intersection + shape-sampling primitives used by closed-loop detection:
// line/line, line/circle, circle/circle crossings, arc segment counts, and
// per-shape polyline sampling.  Pure JS / math.  Split out of closedLoops.js.

import { MM_PER_UNIT } from "./dimensions.js";

// ── Intersection helpers ────────────────────────────────────────────────

export function normalizeAngle(a) {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
}

export function uniqueSortedNums(arr, eps) {
  const s = [...arr].sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || v - s[i - 1] > eps);
}

// Intersection points of a line segment with a circle.
// Returns [{t, x, y, angle}] — t∈(0,1) strict interior of the segment.
export function lineCircleIntersect(line, circle) {
  const { x1, y1, x2, y2 } = line;
  const { cx, cy, r } = circle;
  const dx = x2 - x1,
    dy = y2 - y1;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return [];
  const fx = x1 - cx,
    fy = y1 - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const EPS = 1e-6;
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
    .filter((t) => t > EPS && t < 1 - EPS)
    .map((t) => {
      const x = x1 + t * dx,
        y = y1 + t * dy;
      return { t, x, y, angle: normalizeAngle(Math.atan2(y - cy, x - cx)) };
    });
}

// Intersection points of two circles.
// Returns [{x, y, angle1, angle2}] — angles on each circle.
export function circleCircleIntersect(c1, c2) {
  const dx = c2.cx - c1.cx,
    dy = c2.cy - c1.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-10 || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9)
    return [];
  const a = (d * d + c1.r * c1.r - c2.r * c2.r) / (2 * d);
  const h2 = c1.r * c1.r - a * a;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const px = c1.cx + (a * dx) / d,
    py = c1.cy + (a * dy) / d;
  const pts = [];
  for (const sign of [1, -1]) {
    const x = px + (sign * h * dy) / d,
      y = py - (sign * h * dx) / d;
    pts.push({
      x,
      y,
      angle1: normalizeAngle(Math.atan2(y - c1.cy, x - c1.cx)),
      angle2: normalizeAngle(Math.atan2(y - c2.cy, x - c2.cx)),
    });
  }
  // De-duplicate tangent intersections.
  if (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) < 1e-6)
    return [pts[0]];
  return pts;
}

// Intersection of two line segments at a point strictly interior to both.
export function lineCrossIntersect(li, lj) {
  const dx1 = li.x2 - li.x1,
    dy1 = li.y2 - li.y1;
  const dx2 = lj.x2 - lj.x1,
    dy2 = lj.y2 - lj.y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const gdx = lj.x1 - li.x1,
    gdy = lj.y1 - li.y1;
  const ti = (gdx * dy2 - gdy * dx2) / denom;
  const tj = (gdx * dy1 - gdy * dx1) / denom;
  const EPS = 1e-6;
  if (ti < EPS || ti > 1 - EPS || tj < EPS || tj > 1 - EPS) return null;
  return { ti, tj, x: li.x1 + ti * dx1, y: li.y1 + ti * dy1 };
}

// Computes the number of polygon samples for a sub-arc edge.  In print
// mode (precision != null), uses the sagitta formula so the chord
// deviation from the true curve is ≤ precision mm.  In preview mode
// returns curveSegments / 2, matching the pre-adaptive behaviour and
// keeping polygon shapes stable for profile re-matching.
export function arcSegsN(shape, arcAngle, curveSegments, precision) {
  if (precision != null) {
    const r = shape.r;
    if (r > 0) {
      const sUnits = precision / MM_PER_UNIT;
      const halfTheta = Math.acos(Math.max(-1, Math.min(1, 1 - sUnits / r)));
      // Cap well below the old 65536: region detection only needs the loop
      // topology, and a huge segment count makes its O(n²) intersection pass
      // pathological for a large-radius / fine-precision arc.
      return Math.max(8, Math.min(1024, Math.ceil(arcAngle / (2 * halfTheta))));
    }
  }
  return Math.round(curveSegments / 2);
}

export function sampleShapeForPoly(shape, startIsA, N = 16) {
  switch (shape.type) {
    case "line":
      return startIsA
        ? [{ x: shape.x1, y: shape.y1 }]
        : [{ x: shape.x2, y: shape.y2 }];
    case "arc": {
      const { cx, cy, r, startAngle, endAngle } = shape;
      const from = startIsA ? startAngle : endAngle;
      const to = startIsA ? endAngle : startAngle;
      return Array.from({ length: N }, (_, i) => {
        const a = from + (i / N) * (to - from);
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
    }
    case "bezier": {
      const [q0, q1, q2, q3] = startIsA
        ? [shape.p0, shape.p1, shape.p2, shape.p3]
        : [shape.p3, shape.p2, shape.p1, shape.p0];
      return Array.from({ length: N }, (_, i) => {
        const t = i / N,
          mt = 1 - t;
        return {
          x:
            mt * mt * mt * q0.x +
            3 * mt * mt * t * q1.x +
            3 * mt * t * t * q2.x +
            t * t * t * q3.x,
          y:
            mt * mt * mt * q0.y +
            3 * mt * mt * t * q1.y +
            3 * mt * t * t * q2.y +
            t * t * t * q3.y,
        };
      });
    }
    default:
      return [];
  }
}

// Returns [{ polygon, shapeIndices }] — shapeIndices are original indices
// into `shapes`.
//
// Handles intersecting shapes: when two shapes (e.g. a circle and a
// rectangle) cross each other's boundaries, their intersection points
// are computed, each shape is split at those points, and the DFS finds
// all minimal face regions of the resulting planar graph — including
// the overlap region, the circle-outside-rect region, etc.
