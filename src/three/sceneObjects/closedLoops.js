// Closed-loop region detection + the polygon utilities that everything
// downstream of it relies on.  All pure JS / math — no THREE imports.
//
// The flow used by extrude-profile selection and sketch fill rendering:
//   shapes → findClosedLoopsWithShapes → groupLoopsWithHoles
// The intersection helpers (line/line, line/circle, circle/circle) split
// shapes at their crossings so the DFS sees a clean planar graph.

import { MM_PER_UNIT } from "./dimensions.js";

// ── Polygon winding helpers ─────────────────────────────────────────────

// Signed shoelace area: positive when the polygon is CCW (in a +Y-up
// Cartesian frame), negative when CW.  Used to normalize hole windings
// before handing them to THREE.ExtrudeGeometry — Three.js builds side-
// wall quads by walking each path in vertex order, so if a hole is CCW
// (same orientation as the outer boundary) the inner walls come out
// facing the wrong way.
export function signedPolyAreaXY(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Return `poly` with the requested winding (CCW when wantCcw=true, CW
// otherwise).  No-op when the polygon already matches.
export function withWinding(poly, wantCcw) {
  if (!poly || poly.length < 3) return poly;
  const isCcw = signedPolyAreaXY(poly) > 0;
  return isCcw === wantCcw ? poly : [...poly].reverse();
}

// ── Intersection helpers ────────────────────────────────────────────────

function normalizeAngle(a) {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
}

function uniqueSortedNums(arr, eps) {
  const s = [...arr].sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || v - s[i - 1] > eps);
}

// Intersection points of a line segment with a circle.
// Returns [{t, x, y, angle}] — t∈(0,1) strict interior of the segment.
function lineCircleIntersect(line, circle) {
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
function circleCircleIntersect(c1, c2) {
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
function lineCrossIntersect(li, lj) {
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
function arcSegsN(shape, arcAngle, curveSegments, precision) {
  if (precision != null) {
    const r = shape.r;
    if (r > 0) {
      const sUnits = precision / MM_PER_UNIT;
      const halfTheta = Math.acos(Math.max(-1, Math.min(1, 1 - sUnits / r)));
      return Math.max(
        8,
        Math.min(65536, Math.ceil(arcAngle / (2 * halfTheta))),
      );
    }
  }
  return Math.round(curveSegments / 2);
}

function sampleShapeForPoly(shape, startIsA, N = 16) {
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
export function findClosedLoopsWithShapes(
  shapes,
  curveSegments = 32,
  precision = null,
) {
  const EPS = 1e-4;

  // ── Filter solid shapes ───────────────────────────────────────────────
  const solidEntries = [];
  shapes.forEach((s, i) => {
    if (!s.dashed && s.kind !== "bevel")
      solidEntries.push({ shape: s, origIdx: i });
  });

  // ── Expand rects to 4 line segments so they participate in intersection
  // expandedEntries: { shape (line/arc/bezier/circle/ellipse), origIdx }
  const expandedEntries = [];
  solidEntries.forEach(({ shape, origIdx }) => {
    if (shape.type === "rect") {
      const { x1, y1, x2, y2 } = shape;
      expandedEntries.push({
        shape: { type: "line", x1, y1, x2, y2: y1 },
        origIdx,
      });
      expandedEntries.push({
        shape: { type: "line", x1: x2, y1, x2, y2 },
        origIdx,
      });
      expandedEntries.push({
        shape: { type: "line", x1: x2, y1: y2, x2: x1, y2 },
        origIdx,
      });
      expandedEntries.push({
        shape: { type: "line", x1, y1: y2, x2: x1, y2: y1 },
        origIdx,
      });
    } else {
      expandedEntries.push({ shape, origIdx });
    }
  });

  // ── Compute pairwise intersection points ─────────────────────────────
  // splitPts[i] = list of split parameters/angles on expandedEntries[i]
  const splitPts = expandedEntries.map(() => []);

  for (let i = 0; i < expandedEntries.length; i++) {
    for (let j = i + 1; j < expandedEntries.length; j++) {
      if (expandedEntries[i].origIdx === expandedEntries[j].origIdx) continue; // same source shape
      const si = expandedEntries[i].shape,
        sj = expandedEntries[j].shape;

      if (si.type === "line" && sj.type === "line") {
        const pt = lineCrossIntersect(si, sj);
        if (pt) {
          splitPts[i].push({ value: pt.ti, x: pt.x, y: pt.y });
          splitPts[j].push({ value: pt.tj, x: pt.x, y: pt.y });
        }
      } else if (si.type === "line" && sj.type === "circle") {
        for (const pt of lineCircleIntersect(si, sj)) {
          splitPts[i].push({ value: pt.t, x: pt.x, y: pt.y });
          splitPts[j].push({
            value: pt.angle,
            x: pt.x,
            y: pt.y,
            isAngle: true,
          });
        }
      } else if (si.type === "circle" && sj.type === "line") {
        for (const pt of lineCircleIntersect(sj, si)) {
          splitPts[j].push({ value: pt.t, x: pt.x, y: pt.y });
          splitPts[i].push({
            value: pt.angle,
            x: pt.x,
            y: pt.y,
            isAngle: true,
          });
        }
      } else if (si.type === "circle" && sj.type === "circle") {
        for (const pt of circleCircleIntersect(si, sj)) {
          splitPts[i].push({
            value: pt.angle1,
            x: pt.x,
            y: pt.y,
            isAngle: true,
          });
          splitPts[j].push({
            value: pt.angle2,
            x: pt.x,
            y: pt.y,
            isAngle: true,
          });
        }
      }
    }
  }

  // ── Split shapes at intersection points ──────────────────────────────
  const subEntries = []; // { shape (line or arc), origIdx }
  const splitCircleOrigIdxs = new Set(); // circles that were split → skip direct-loop path

  for (let i = 0; i < expandedEntries.length; i++) {
    const { shape, origIdx } = expandedEntries[i];
    const pts = splitPts[i];

    if (pts.length === 0) {
      subEntries.push({ shape, origIdx });
      continue;
    }

    if (shape.type === "line") {
      const ts = uniqueSortedNums(
        pts.map((p) => p.value),
        EPS,
      ).filter((t) => t > EPS && t < 1 - EPS);
      if (ts.length === 0) {
        subEntries.push({ shape, origIdx });
        continue;
      }
      const bounds = [0, ...ts, 1];
      for (let k = 0; k < bounds.length - 1; k++) {
        const t1 = bounds[k],
          t2 = bounds[k + 1];
        subEntries.push({
          shape: {
            type: "line",
            x1: shape.x1 + t1 * (shape.x2 - shape.x1),
            y1: shape.y1 + t1 * (shape.y2 - shape.y1),
            x2: shape.x1 + t2 * (shape.x2 - shape.x1),
            y2: shape.y1 + t2 * (shape.y2 - shape.y1),
          },
          origIdx,
        });
      }
    } else if (shape.type === "circle") {
      const angEps = EPS / Math.max(shape.r, 0.01);
      const rawAngles = uniqueSortedNums(
        pts.map((p) => normalizeAngle(p.value)),
        angEps,
      );
      if (rawAngles.length < 2) {
        subEntries.push({ shape, origIdx });
        continue;
      }
      splitCircleOrigIdxs.add(origIdx);
      for (let k = 0; k < rawAngles.length; k++) {
        const startAngle = rawAngles[k];
        let endAngle = rawAngles[(k + 1) % rawAngles.length];
        if (endAngle <= startAngle) endAngle += 2 * Math.PI;
        subEntries.push({
          shape: {
            type: "arc",
            cx: shape.cx,
            cy: shape.cy,
            r: shape.r,
            startAngle,
            endAngle,
          },
          origIdx,
        });
      }
    } else {
      subEntries.push({ shape, origIdx });
    }
  }

  // ── Build adjacency graph from sub-shapes ────────────────────────────
  const nodes = [];
  const getNode = (x, y) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < EPS) return i;
    }
    nodes.push({ x, y });
    return nodes.length - 1;
  };

  const shapeNodes = subEntries.map(({ shape }) => {
    if (shape.type === "line")
      return { a: getNode(shape.x1, shape.y1), b: getNode(shape.x2, shape.y2) };
    if (shape.type === "arc")
      return {
        a: getNode(
          shape.cx + Math.cos(shape.startAngle) * shape.r,
          shape.cy + Math.sin(shape.startAngle) * shape.r,
        ),
        b: getNode(
          shape.cx + Math.cos(shape.endAngle) * shape.r,
          shape.cy + Math.sin(shape.endAngle) * shape.r,
        ),
      };
    if (shape.type === "bezier")
      return {
        a: getNode(shape.p0.x, shape.p0.y),
        b: getNode(shape.p3.x, shape.p3.y),
      };
    return null;
  });

  const adj = {};
  shapeNodes.forEach((sn, si) => {
    if (!sn || sn.a === sn.b) return;
    (adj[sn.a] = adj[sn.a] || []).push({ si, otherNode: sn.b });
    (adj[sn.b] = adj[sn.b] || []).push({ si, otherNode: sn.a });
  });

  // ── Handle parallel edges (multiple edges between the same pair of
  // nodes).  When a circle intersects a line, both create edges between
  // the same two intersection nodes.  We need to:
  //   1. Explicitly generate 2-edge cycles for every pair of parallel
  //      edges (these represent sub-regions like a circular segment or a
  //      full circle).
  //   2. Remove non-canonical edges from adj so the DFS only traverses
  //      one edge per node-pair, preventing spurious "triangle-with-arc"
  //      cycles.
  const cycleKeys = new Set();
  const results = [];

  const nodePairToEdges = new Map();
  shapeNodes.forEach((sn, si) => {
    if (!sn || sn.a === sn.b) return;
    const key = `${Math.min(sn.a, sn.b)},${Math.max(sn.a, sn.b)}`;
    if (!nodePairToEdges.has(key)) nodePairToEdges.set(key, []);
    nodePairToEdges.get(key).push(si);
  });

  nodePairToEdges.forEach((edges) => {
    if (edges.length < 2) return;
    const sn0 = shapeNodes[edges[0]];
    const N1 = Math.min(sn0.a, sn0.b);
    const N2 = Math.max(sn0.a, sn0.b);
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const si1 = edges[i],
          si2 = edges[j];
        const cycleKey = `${Math.min(si1, si2)},${Math.max(si1, si2)}`;
        if (cycleKeys.has(cycleKey)) continue;
        cycleKeys.add(cycleKey);
        const sn1 = shapeNodes[si1],
          sn2 = shapeNodes[si2];
        const sh1 = subEntries[si1].shape,
          sh2 = subEntries[si2].shape;
        const ang1 =
          sh1.type === "arc"
            ? Math.abs(sh1.endAngle - sh1.startAngle)
            : Math.PI;
        const ang2 =
          sh2.type === "arc"
            ? Math.abs(sh2.endAngle - sh2.startAngle)
            : Math.PI;
        const poly = [];
        const idxSet = new Set();
        poly.push(
          ...sampleShapeForPoly(
            sh1,
            sn1.a === N1,
            arcSegsN(sh1, ang1, curveSegments, precision),
          ),
        );
        idxSet.add(subEntries[si1].origIdx);
        poly.push(
          ...sampleShapeForPoly(
            sh2,
            sn2.a === N2,
            arcSegsN(sh2, ang2, curveSegments, precision),
          ),
        );
        idxSet.add(subEntries[si2].origIdx);
        results.push({ polygon: poly, shapeIndices: [...idxSet] });
      }
    }
    // Keep all edges (including arc edges that have a parallel line
    // segment) in adj so the DFS can find the "shape minus circle"
    // sub-region — e.g. the part of a rectangle that excludes the area
    // of a circle crossing one of its sides.  The explicit 2-edge cycles
    // above already capture the small arc-vs-line sub-regions; the DFS
    // then adds the larger complement cycles.
  });

  // ── DFS cycle detection ─────────────────────────────────────────────
  const cycles = [];
  const dfs = (start, cur, path, visited) => {
    if (path.length > 24) return;
    for (const { si, otherNode } of adj[cur] || []) {
      if (path.some((e) => e.si === si)) continue;
      if (otherNode === start && path.length >= 2) {
        const key = [...path.map((e) => e.si), si].sort().join(",");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push([...path, { si, fromNode: cur, toNode: otherNode }]);
        }
        continue;
      }
      if (visited.has(otherNode)) continue;
      dfs(
        start,
        otherNode,
        [...path, { si, fromNode: cur, toNode: otherNode }],
        new Set([...visited, otherNode]),
      );
    }
  };
  Object.keys(adj).forEach((n) => {
    const ni = parseInt(n);
    if ((adj[ni] || []).length >= 2) dfs(ni, ni, [], new Set([ni]));
  });

  cycles.forEach((path) => {
    const poly = [];
    const idxSet = new Set();
    for (const edge of path) {
      const sn = shapeNodes[edge.si];
      const sh = subEntries[edge.si].shape;
      const arcAngle =
        sh.type === "arc" ? Math.abs(sh.endAngle - sh.startAngle) : Math.PI;
      poly.push(
        ...sampleShapeForPoly(
          sh,
          sn.a === edge.fromNode,
          arcSegsN(sh, arcAngle, curveSegments, precision),
        ),
      );
      idxSet.add(subEntries[edge.si].origIdx);
    }
    results.push({ polygon: poly, shapeIndices: [...idxSet] });
  });

  // ── Direct loops for self-closing shapes that were NOT split ─────────
  solidEntries.forEach(({ shape, origIdx }) => {
    if (shape.type === "circle" && !splitCircleOrigIdxs.has(origIdx)) {
      const segs =
        precision != null
          ? arcSegsN(shape, 2 * Math.PI, curveSegments, precision)
          : curveSegments;
      results.push({
        polygon: Array.from({ length: segs }, (_, i) => {
          const a = (i / segs) * Math.PI * 2;
          return {
            x: shape.cx + Math.cos(a) * shape.r,
            y: shape.cy + Math.sin(a) * shape.r,
          };
        }),
        shapeIndices: [origIdx],
      });
    } else if (shape.type === "ellipse") {
      const segs =
        precision != null
          ? arcSegsN(
              { r: Math.max(shape.rx, shape.ry) },
              2 * Math.PI,
              curveSegments,
              precision,
            )
          : curveSegments;
      results.push({
        polygon: Array.from({ length: segs }, (_, i) => {
          const a = (i / segs) * Math.PI * 2;
          return {
            x: shape.cx + Math.cos(a) * shape.rx,
            y: shape.cy + Math.sin(a) * shape.ry,
          };
        }),
        shapeIndices: [origIdx],
      });
    }
    // rects are always expanded to 4 lines; the DFS finds the rectangular
    // cycle.
  });

  return results;
}

export function findClosedLoops(shapes, curveSegments = 32, precision = null) {
  return findClosedLoopsWithShapes(shapes, curveSegments, precision).map(
    (l) => l.polygon,
  );
}

// ── Loop nesting helpers ───────────────────────────────────────────────

export function polyContainsPoint(poly, pt) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function polyCentroid(poly) {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}

// Returns [{ polygon, holes, entries }, ...] where:
//   polygon  – boundary polygon of this region
//   holes    – direct child polygons carved out of this region (for
//              THREE.Shape.holes)
//   entries  – recursive { polygon, holes, entries } for each child, so
//              nested sub-regions (e.g. a circle inside a triangle
//              inside a rectangle) get their own fills at progressively
//              higher renderOrder.
//
// Each loop's "direct parent" is the smallest-area loop that contains
// its centroid, which prevents the symmetric false-containment bug that
// arises when the outer loop's centroid happens to sit inside a smaller
// inner loop (e.g. a circle centred inside a rectangle — both centroids
// are at the same point).
export function groupLoopsWithHoles(loops) {
  if (loops.length === 0) return [];
  const areas = loops.map(polyArea);
  const centroids = loops.map(polyCentroid);

  // A loop is only a valid parent when the child is FULLY contained —
  // i.e. every polygon point of the child is inside (or exactly on the
  // boundary of) the parent.  This prevents a circle that crosses a
  // rectangle boundary from being treated as a hole of that rectangle,
  // which would cause THREE.ShapeGeometry to generate spurious triangles
  // outside the expected area and produce a tangent-line artifact during
  // hover.
  //
  // Because polyContainsPoint uses strict ray-casting (boundary →
  // false), we nudge each candidate point 1e-4 of the way toward the
  // parent's centroid before testing.  The nudge is negligible for
  // points genuinely inside but pushes exact-boundary points (e.g.
  // shared vertices like a triangle corner on a rectangle edge) to a
  // clearly-interior position while leaving truly-outside points
  // outside.
  const isFullyContained = (childIdx, parentIdx) => {
    const parent = loops[parentIdx];
    const pc = polyCentroid(parent);
    const EPS = 1e-4;
    return loops[childIdx].every((pt) => {
      if (polyContainsPoint(parent, pt)) return true;
      const nudged = {
        x: pt.x + (pc.x - pt.x) * EPS,
        y: pt.y + (pc.y - pt.y) * EPS,
      };
      return polyContainsPoint(parent, nudged);
    });
  };

  // For each loop: find the direct parent = smallest-area loop that
  // contains its centroid.
  const parents = loops.map((_, idx) => {
    let best = -1,
      bestArea = Infinity;
    for (let j = 0; j < loops.length; j++) {
      if (j === idx) continue;
      if (
        areas[j] > areas[idx] &&
        polyContainsPoint(loops[j], centroids[idx]) &&
        isFullyContained(idx, j) &&
        areas[j] < bestArea
      ) {
        best = j;
        bestArea = areas[j];
      }
    }
    return best;
  });

  const childIdxs = loops.map(() => /** @type {number[]} */ ([]));
  parents.forEach((p, i) => {
    if (p !== -1) childIdxs[p].push(i);
  });

  const buildEntry = (idx) => ({
    polygon: loops[idx],
    holes: childIdxs[idx].map((j) => loops[j]),
    entries: childIdxs[idx].map((j) => buildEntry(j)),
  });

  return loops
    .map((_, i) => (parents[i] === -1 ? buildEntry(i) : null))
    .filter(Boolean);
}
