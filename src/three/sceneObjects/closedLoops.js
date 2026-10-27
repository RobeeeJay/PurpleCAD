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
  lineEndsOnLine,
  arcSegsN,
} from "./loopIntersect.js";
import {
  polyContainsPoint,
  polyCentroid,
  polyArea,
  signedPolyAreaXY,
  reverseEdgeCurves,
} from "./polygonUtil.js";
import { cogShapeLoops } from "../cogGeometry.js";
import { appendSamples, arrangementFaces } from "./arrangementFaces.js";
import { MM_PER_UNIT } from "./dimensions.js";

export {
  signedPolyAreaXY,
  withWinding,
  polyContainsPoint,
  polyCentroid,
  polyAreaCentroid,
  polyArea,
  profileAnchor,
  reverseEdgeCurves,
  windLoopForOcc,
  windLoop,
  packWorldCurveRuns,
} from "./polygonUtil.js";

// Enumerating every simple cycle is exact for a small sketch -- and existing
// documents' extrudes are matched against what it returns, so small sketches
// keep it -- but beyond this many cycles the sketch is an overlapping
// arrangement, and its regions are the faces below.
const MAX_ENUMERATED_CYCLES = 128;

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
      for (const { polygon, curves } of cogShapeLoops(s, tol))
        if (polygon.length >= 3)
          textLoops.push({ polygon, shapeIndices: [i], curves });
      return;
    }
    if (s.type !== "text" || !Array.isArray(s.contours)) return;
    s.contours.forEach((c, ci) => {
      // Drop a duplicated closing point (font glyph contours repeat the start
      // point) so the loop is a clean polygon — a zero-length closing segment
      // makes OCC's extrude wire-builder reject the profile.
      let pts = c;
      if (pts.length >= 2) {
        const a = pts[0],
          b = pts[pts.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts = pts.slice(0, -1);
      }
      if (pts.length < 3) return;
      // Its glyph curves, when the shape caches them (text made or refreshed
      // since exact curves), placed at the anchor like the points.
      const at = (p) => ({ x: p.x + s.x, y: p.y + s.y });
      textLoops.push({
        polygon: pts.map(at),
        shapeIndices: [i],
        curves:
          pts === c
            ? (s.contourCurves?.[ci] || []).map((r) => ({
                ...r,
                p0: at(r.p0),
                p1: at(r.p1),
                p2: at(r.p2),
                p3: at(r.p3),
              }))
            : [],
      });
    });
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
  // Where a line ends on another without crossing it (see mergeThroughT).
  const tPts = [];

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
        } else {
          for (const q of lineEndsOnLine(si, sj, EPS)) {
            splitPts[i].push({ value: q.t, x: q.x, y: q.y });
            tPts.push(q);
          }
          for (const q of lineEndsOnLine(sj, si, EPS)) {
            splitPts[j].push({ value: q.t, x: q.x, y: q.y });
            tPts.push(q);
          }
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
          line: i,
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

  // Two straight pieces between the same two nodes are one edge drawn twice:
  // a construction leg laid along a rectangle's side, once the side is split
  // where the next leg starts on it.  Kept, they made a cycle of no area and
  // could stand in for the side, so the outline loop named the leg instead
  // of the side and a profile matched by its shapes stopped finding it.  The
  // piece from the earlier shape -- the outline, drawn first -- is kept.
  const straightAt = new Map();
  shapeNodes.forEach((sn, si) => {
    if (!sn || sn.a === sn.b || subEntries[si].shape.type !== "line") return;
    const key = `${Math.min(sn.a, sn.b)},${Math.max(sn.a, sn.b)}`;
    const prev = straightAt.get(key);
    if (prev == null) return straightAt.set(key, si);
    const drop = subEntries[si].origIdx < subEntries[prev].origIdx ? prev : si;
    shapeNodes[drop] = null;
    if (drop === prev) straightAt.set(key, si);
  });

  // A line split where another line merely ENDS on it is still one edge of a
  // loop that runs straight past the junction.  Sampled as two pieces it put a
  // vertex mid-side, and the extrude built that side as two faces: the project
  // box lid's plate, whose screw-hole legs end on its sides, then had its outer
  // faces split and push/pull could no longer offset them together.  Only
  // T-junctions merge -- a crossing split was always kept, and saved face
  // names (`side{k}`) count those vertices.
  const tNodes = new Set();
  for (const q of tPts) {
    const n = nodes.findIndex((p) => Math.hypot(p.x - q.x, p.y - q.y) < EPS);
    if (n >= 0) tNodes.add(n);
  }
  const startOf = (sh, fwd) =>
    fwd ? { x: sh.x1, y: sh.y1 } : { x: sh.x2, y: sh.y2 };
  const endOf = (sh, fwd) => startOf(sh, !fwd);
  // steps: a loop's edges in order, { si, fwd, from: node it leaves }.
  const mergeThroughT = (steps) => {
    const n = steps.length;
    const joins = (k) => {
      const a = subEntries[steps[(k - 1 + n) % n].si].line;
      return (
        a != null &&
        a === subEntries[steps[k].si].line &&
        tNodes.has(steps[k].from)
      );
    };
    const first = steps.findIndex((_, k) => !joins(k));
    if (first < 0)
      return steps.map((st) => ({
        shape: subEntries[st.si].shape,
        fwd: st.fwd,
      }));
    const out = [];
    for (let m = 0; m < n; m++) {
      const k = (first + m) % n;
      const st = steps[k];
      const sh = subEntries[st.si].shape;
      if (m > 0 && joins(k)) {
        const last = out[out.length - 1];
        const e = endOf(sh, st.fwd);
        last.shape = { ...last.shape, x2: e.x, y2: e.y };
      } else if (sh.type === "line" && subEntries[st.si].line != null) {
        const a = startOf(sh, st.fwd);
        const b = endOf(sh, st.fwd);
        out.push({
          shape: { type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y },
          fwd: true,
        });
      } else out.push({ shape: sh, fwd: st.fwd });
    }
    return out;
  };

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
        const curves = [];
        const idxSet = new Set();
        appendSamples(
          poly,
          curves,
          sh1,
          sn1.a === N1,
          arcSegsN(sh1, ang1, curveSegments, precision),
        );
        idxSet.add(subEntries[si1].origIdx);
        appendSamples(
          poly,
          curves,
          sh2,
          sn2.a === N2,
          arcSegsN(sh2, ang2, curveSegments, precision),
        );
        idxSet.add(subEntries[si2].origIdx);
        results.push({ polygon: poly, shapeIndices: [...idxSet], curves });
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
        mergeThroughT,
      ),
    );
  }

  cycles.forEach((path) => {
    const poly = [];
    const curves = [];
    const idxSet = new Set();
    const steps = path.map((edge) => ({
      si: edge.si,
      fwd: shapeNodes[edge.si].a === edge.fromNode,
      from: edge.fromNode,
    }));
    for (const { shape: sh, fwd } of mergeThroughT(steps)) {
      const arcAngle =
        sh.type === "arc" ? Math.abs(sh.endAngle - sh.startAngle) : Math.PI;
      appendSamples(
        poly,
        curves,
        sh,
        fwd,
        arcSegsN(sh, arcAngle, curveSegments, precision),
      );
    }
    for (const edge of path) idxSet.add(subEntries[edge.si].origIdx);
    results.push({ polygon: poly, shapeIndices: [...idxSet], curves });
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
        curves: [
          {
            start: 0,
            count: segs,
            type: "arc",
            cx: shape.cx,
            cy: shape.cy,
            r: shape.r,
          },
        ],
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
        curves: [
          {
            start: 0,
            count: segs,
            type: "ellipse",
            cx: shape.cx,
            cy: shape.cy,
            rx: shape.rx,
            ry: shape.ry,
          },
        ],
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

  // A child that touches its parent's outline is a neighbour inside it, not a
  // hole in it: the parts either side of a line across a rectangle (two
  // triangles under a diagonal, or a panel and a strip) tile the rectangle,
  // and subtracting them left a region of no area whose holes shared its own
  // edges.  OCC built that into a broken prism, and fusing it with the parts
  // lost the strip from the extrude.  Holes are only children strictly inside;
  // the touching ones stay nested entries, regions of their own.
  const touchesOutline = (childIdx, parentIdx) => {
    const parent = loops[parentIdx];
    const TOUCH = 1e-4;
    return loops[childIdx].some((pt) =>
      parent.some((a, k) => {
        const b = parent[(k + 1) % parent.length];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t =
          len2 > 0
            ? Math.max(
                0,
                Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2),
              )
            : 0;
        return Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) < TOUCH;
      }),
    );
  };
  const buildEntry = (idx) => ({
    polygon: loops[idx],
    holes: childIdxs[idx]
      .filter((j) => !touchesOutline(j, idx))
      .map((j) => loops[j]),
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
  const curvesBy = new Map(loops.map((l) => [l.polygon, l.curves]));
  const all = [];
  const collect = (e) => {
    all.push({
      ...e,
      shapeIndices: byPolygon.get(e.polygon) || [],
      loopShapes: loopShapesOf(e.polygon, e.holes, byPolygon),
      curves: loopCurvesOf(e.polygon, e.holes, curvesBy),
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

// A region's exact curves, as a profile stores them (`curves2D`): the outer
// loop's runs and each hole's, holes in the order and filtering the profile's
// own `holes` uses.  `curvesOf` maps a loop polygon to its runs.
export function loopCurvesOf(polygon, holes, curvesOf) {
  return {
    outer: curvesOf.get(polygon) || [],
    holes: (holes || [])
      .filter((h) => h.length >= 3)
      .map((h) => curvesOf.get(h) || []),
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
