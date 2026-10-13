// Closed-loop region detection: turns a set of sketch shapes into the nested
// boundary/hole polygons that extrude-profile selection and fill rendering use.
//   shapes → findClosedLoopsWithShapes → groupLoopsWithHoles
// Pure geometry primitives live in loopIntersect.js (crossings/sampling) and
// polygonUtil.js (winding/area/containment); both are re-exported here so the
// long-standing import surface of this module is unchanged.

import {
  normalizeAngle,
  uniqueSortedNums,
  lineCircleIntersect,
  circleCircleIntersect,
  lineCrossIntersect,
  arcSegsN,
  sampleShapeForPoly,
} from "./loopIntersect.js";
import {
  polyContainsPoint,
  polyCentroid,
  polyArea,
  signedPolyAreaXY,
} from "./polygonUtil.js";
import { cogShapeContours } from "../cogGeometry.js";
import { MM_PER_UNIT } from "./dimensions.js";

export {
  signedPolyAreaXY,
  withWinding,
  polyContainsPoint,
  polyCentroid,
  polyAreaCentroid,
  polyArea,
  profileAnchor,
} from "./polygonUtil.js";

// Enumerating every simple cycle is exact for a small sketch -- and existing
// documents' extrudes are matched against what it returns, so small sketches
// keep it -- but beyond this many cycles the sketch is an overlapping
// arrangement, and its regions are the faces below.
const MAX_ENUMERATED_CYCLES = 128;

// The bounded faces of a planar arrangement, plus each connected piece's outer
// outline: the regions you can see, not every union of them.  Linear in the
// edge count: every directed edge borders exactly one face, and walking "take
// the sharpest right turn" from it goes round that face.
function arrangementFaces(
  shapeNodes,
  subEntries,
  nodes,
  curveSegments,
  precision,
) {
  const live = shapeNodes.map((sn) => !!sn && sn.a !== sn.b);
  // A dangling edge (a node of degree 1) bounds no region; tracing round it
  // would put a zero-width spike in a face that OCC's wire builder rejects.
  const degree = new Map();
  const bump = (n, d) => degree.set(n, (degree.get(n) || 0) + d);
  shapeNodes.forEach((sn, si) => {
    if (live[si]) {
      bump(sn.a, 1);
      bump(sn.b, 1);
    }
  });
  for (let pruned = true; pruned;) {
    pruned = false;
    shapeNodes.forEach((sn, si) => {
      if (live[si] && (degree.get(sn.a) === 1 || degree.get(sn.b) === 1)) {
        live[si] = false;
        bump(sn.a, -1);
        bump(sn.b, -1);
        pruned = true;
      }
    });
  }

  const segsOf = (sh) =>
    arcSegsN(
      sh,
      sh.type === "arc" ? Math.abs(sh.endAngle - sh.startAngle) : Math.PI,
      curveSegments,
      precision,
    );
  // Half-edge h = 2*si (a -> b) or 2*si + 1 (b -> a).  Its direction as it
  // leaves its node is taken from the curve's first sample, not the far end,
  // so two arcs leaving one point (circles crossing there) sort by where
  // they actually go.
  const tail = (h) => (h & 1 ? shapeNodes[h >> 1].b : shapeNodes[h >> 1].a);
  const head = (h) => (h & 1 ? shapeNodes[h >> 1].a : shapeNodes[h >> 1].b);
  const samples = (h) => {
    const sh = subEntries[h >> 1].shape;
    return sampleShapeForPoly(sh, (h & 1) === 0, Math.max(2, segsOf(sh)));
  };
  const out = new Map();
  shapeNodes.forEach((sn, si) => {
    if (!live[si]) return;
    for (const h of [si * 2, si * 2 + 1]) {
      const from = nodes[tail(h)];
      const pts = samples(h);
      const to = pts.length > 1 ? pts[1] : nodes[head(h)];
      const list = out.get(tail(h)) || [];
      list.push({ h, ang: Math.atan2(to.y - from.y, to.x - from.x) });
      out.set(tail(h), list);
    }
  });
  const slot = new Map();
  out.forEach((list) => {
    list.sort((p, q) => p.ang - q.ang);
    list.forEach((e, i) => slot.set(e.h, i));
  });
  // The face on h's left continues along the edge just clockwise of h's twin.
  const next = (h) => {
    const list = out.get(head(h));
    return list[(slot.get(h ^ 1) - 1 + list.length) % list.length].h;
  };

  const faces = [];
  const seen = new Set();
  out.forEach((list) => {
    for (const { h: start } of list) {
      if (seen.has(start)) continue;
      const walk = [];
      let h = start;
      while (!seen.has(h)) {
        seen.add(h);
        walk.push(h);
        h = next(h);
      }
      if (h !== start) continue;
      const polygon = walk.flatMap(samples);
      const area = signedPolyAreaXY(polygon);
      const shapeIndices = [
        ...new Set(walk.map((e) => subEntries[e >> 1].origIdx)),
      ];
      // Counter-clockwise: a bounded face.  Clockwise: a piece's outline, kept
      // (reversed) when it is a simple loop, as the cycle search offered it.
      if (area > 1e-12) faces.push({ polygon, shapeIndices });
      else if (area < -1e-12 && new Set(walk.map(tail)).size === walk.length)
        faces.push({ polygon: polygon.slice().reverse(), shapeIndices });
    }
  });
  return faces;
}

export function findClosedLoopsWithShapes(
  shapes,
  curveSegments = 32,
  precision = null,
) {
  const EPS = 1e-4;

  // ── Filter solid shapes ───────────────────────────────────────────────
  // Projected geometry participates in region detection (so an enclosed area
  // bounded by projected edges is extrudable).  It is deduped of coincident /
  // zero-length segments at projection time so it isn't a degenerate input.
  const solidEntries = [];
  shapes.forEach((s, i) => {
    // Bevel (fillet) arcs are real profile geometry — they bridge the two
    // trimmed legs, so a filleted corner only closes if the arc participates.
    // Construction (dashed) geometry is excluded; text is handled separately
    // below (its stored glyph contours are already closed loops).
    if (!s.dashed && s.type !== "text" && s.type !== "cog")
      solidEntries.push({ shape: s, origIdx: i });
  });

  // Text and cogs: each stored contour is already a closed loop positioned at
  // the shape's anchor.  Feed them in directly — NOT through the pairwise-
  // intersect + cycle DFS, which dense glyph or tooth geometry would choke — so
  // filled/extruded text and cogs work.  groupLoopsWithHoles nests the counters
  // (the hole in "o", a cog's centre hole).
  const textLoops = [];
  shapes.forEach((s, i) => {
    if (s.type === "cog") {
      // At the active resolution, like the circles and arcs around it -- the
      // cached outline is a fixed coarse one, and an extruded cog made from
      // it never got finer with the resolution.
      const tol = precision != null ? precision / MM_PER_UNIT : null;
      for (const polygon of cogShapeContours(s, tol))
        if (polygon.length >= 3) textLoops.push({ polygon, shapeIndices: [i] });
      return;
    }
    if (s.type !== "text" || !Array.isArray(s.contours)) return;
    for (const c of s.contours) {
      // Drop a duplicated closing point (font glyph contours repeat the start
      // point) so the loop is a clean polygon — a zero-length closing segment
      // makes OCC's extrude wire-builder reject the profile.
      let pts = c;
      if (pts.length >= 2) {
        const a = pts[0],
          b = pts[pts.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts = pts.slice(0, -1);
      }
      if (pts.length < 3) continue;
      textLoops.push({
        polygon: pts.map((p) => ({ x: p.x + s.x, y: p.y + s.y })),
        shapeIndices: [i],
      });
    }
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

  // Too many split segments → the O(n²) node merge and the cycle DFS below get
  // pathologically slow (a dense projected wireframe of crossing edges).  Bail
  // out of region detection rather than freeze; the geometry still draws.
  if (subEntries.length > 2500) return textLoops;

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
  // Enumerating every cycle is exponential in the graph's branching, so a dense
  // intersection graph (e.g. a projected body's wireframe with many crossing
  // edges) would otherwise freeze the app.  Bound the total exploration: when
  // the budget runs out we keep the regions found so far rather than hang.
  const cycles = [];
  let dfsBudget = 150000;
  // Enumerating every cycle also returns every UNION of adjacent regions, so
  // the count explodes with overlap: six overlapping circles gave 6211 loops
  // (1.28M points), and grouping them into regions took 142 s on the main
  // thread -- the window froze while a copy was nudged over its original.
  // Past this many, stop and take the arrangement's faces instead.
  let overflow = results.length > MAX_ENUMERATED_CYCLES;
  const dfs = (start, cur, path, visited) => {
    if (path.length > 24 || dfsBudget <= 0 || overflow) return;
    dfsBudget--;
    for (const { si, otherNode } of adj[cur] || []) {
      if (path.some((e) => e.si === si)) continue;
      if (otherNode === start && path.length >= 2) {
        const key = [...path.map((e) => e.si), si].sort().join(",");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push([...path, { si, fromNode: cur, toNode: otherNode }]);
          if (results.length + cycles.length > MAX_ENUMERATED_CYCLES) {
            overflow = true;
            return;
          }
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

  if (overflow) {
    // The faces replace BOTH the enumerated cycles and the parallel-edge pairs
    // above -- those pairs are faces too, and would come back twice.
    results.length = 0;
    cycles.length = 0;
    results.push(
      ...arrangementFaces(
        shapeNodes,
        subEntries,
        nodes,
        curveSegments,
        precision,
      ),
    );
  }

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

  return results.concat(textLoops);
}

export function findClosedLoops(shapes, curveSegments = 32, precision = null) {
  return findClosedLoopsWithShapes(shapes, curveSegments, precision).map(
    (l) => l.polygon,
  );
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

// Every region of a sketch — roots and nested alike — each tagged with the
// sketch shapes its boundary came from.  A text / cog / SVG profile records
// WHICH shape it was extruded from (`textShapeIdx`), and that survives the
// shape being moved or resized, which neither the stored outline nor the
// stored click anchor does; the rebuild matches on it so a shape drawn where
// the old one used to be can't capture the extrude.
export function regionsWithShapes(
  shapes,
  curveSegments = 32,
  precision = null,
) {
  const loops = findClosedLoopsWithShapes(shapes, curveSegments, precision);
  const byPolygon = new Map(loops.map((l) => [l.polygon, l.shapeIndices]));
  const all = [];
  const collect = (e) => {
    all.push({
      ...e,
      shapeIndices: byPolygon.get(e.polygon) || [],
      loopShapes: loopShapesOf(e.polygon, e.holes, byPolygon),
    });
    e.entries.forEach(collect);
  };
  groupLoopsWithHoles(loops.map((l) => l.polygon)).forEach(collect);
  return all;
}

// A region's identity in its sketch: the shapes its outer loop runs along and
// those of each hole, as sorted indices.  Unlike its outline, area or a click
// point, this survives the shapes being moved or resized -- concentric rings
// share a centre, and once grown a ring's old area can be nearer its
// neighbour's than its own.  `shapesOf` maps a loop polygon to its indices.
export function loopShapesOf(polygon, holes, shapesOf) {
  const norm = (ids) => [...new Set(ids || [])].sort((a, b) => a - b);
  return {
    outer: norm(shapesOf.get(polygon)),
    holes: (holes || [])
      .filter((h) => h.length >= 3)
      .map((h) => norm(shapesOf.get(h)))
      .sort((a, b) => String(a).localeCompare(String(b))),
  };
}
export const loopShapesKey = (ls) =>
  ls
    ? `${ls.outer.join(",")}|${ls.holes.map((h) => h.join(",")).join(";")}`
    : "";

// Narrow a sketch's regions to the profile's own: the ones bounded by the
// shapes it was picked from (loopShapes), or else built from its text / cog
// shape (textShapeIdx).  Returns the full set when nothing matches (a shape
// was deleted and the indices renumbered), so matching degrades to geometry
// rather than failing.
export function regionsForProfile(regions, profile) {
  const key = loopShapesKey(profile?.loopShapes);
  if (key && profile.loopShapes.outer.length) {
    const same = regions.filter((g) => loopShapesKey(g.loopShapes) === key);
    if (same.length > 0) return same;
  }
  const idx = profile?.textShapeIdx;
  if (idx == null) return regions;
  const own = regions.filter((g) => g.shapeIndices.includes(idx));
  return own.length > 0 ? own : regions;
}
