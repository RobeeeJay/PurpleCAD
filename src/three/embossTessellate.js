// Quality tessellation for the emboss relief caps.  THREE.ExtrudeGeometry fills a
// glyph face by ear-clipping, which produces long sliver triangles; wrapped onto a
// sphere those slivers become flat chords across a doubly-curved surface and read
// as sharp creases.  This builds the flat relief prism with a *quality* cap mesh
// instead: a grid-seeded Delaunay triangulation of each glyph region, so the cap
// faces are near-equilateral and size-bounded and the wrap stays smooth.
//
// The mesher is constrained-by-construction: boundary points (densified along the
// outline + holes) and an interior triangular lattice are Delaunay-triangulated,
// triangles whose centroid falls outside the region (a hole, a concavity, or the
// gap between glyphs) are dropped, and the walls are built from the *surviving*
// cap boundary — so the solid is always watertight regardless of how the Delaunay
// resolved a tight feature.

import { polyContainsPoint } from "./sceneObjects/polygonUtil.js";

// Strictly inside the circumcircle of CCW triangle (a,b,c)?  Determinant form.
function inCircumcircle(a, b, c, p) {
  const ax = a[0] - p[0],
    ay = a[1] - p[1];
  const bx = b[0] - p[0],
    by = b[1] - p[1];
  const cx = c[0] - p[0],
    cy = c[1] - p[1];
  return (
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay) >
    1e-12
  );
}

// Bowyer-Watson Delaunay of 2D points (each [x,y]).  Returns CCW triangles as
// [i,j,k] index triples into `pts`.  O(n^2) — fine for the few-hundred-point caps.
export function delaunay(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const d = Math.max(maxX - minX, maxY - minY) || 1;
  const mx = (minX + maxX) / 2,
    my = (minY + maxY) / 2;
  // Super-triangle far outside, appended at indices n, n+1, n+2.  MUST be wound
  // CCW (bottom-left → bottom-right → top), since inCircumcircle assumes it.
  const V = pts.concat([
    [mx - 20 * d, my - 10 * d],
    [mx + 20 * d, my - 10 * d],
    [mx, my + 20 * d],
  ]);
  let tris = [[n, n + 1, n + 2]];
  const base = n + 3;
  for (let i = 0; i < n; i++) {
    const p = V[i];
    const bad = [];
    for (const t of tris)
      if (inCircumcircle(V[t[0]], V[t[1]], V[t[2]], p)) bad.push(t);
    if (bad.length === 0) continue;
    // Cavity boundary = edges that appear in exactly one bad triangle, kept with
    // the orientation they had there so the re-fill stays CCW.
    const edges = new Map();
    for (const t of bad)
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ]) {
        const k = a < b ? a * base + b : b * base + a;
        const rec = edges.get(k);
        if (rec) rec.count++;
        else edges.set(k, { a, b, count: 1 });
      }
    const badSet = new Set(bad);
    tris = tris.filter((t) => !badSet.has(t));
    for (const { a, b, count } of edges.values())
      if (count === 1) tris.push([a, b, i]);
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

// Point inside the polygon-with-holes region (inside some outer, not in its hole).
function inRegion(x, y, loops) {
  const pt = { x, y };
  for (const lp of loops) {
    if (!polyContainsPoint(lp.outer, pt)) continue;
    for (const h of lp.holes) if (polyContainsPoint(h, pt)) return false;
    return true;
  }
  return false;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return Math.abs(a) / 2;
}

// Split each edge of a closed {x,y} ring so no piece exceeds `step`.  Emits the
// sub-segment starts only (the ring is implicitly closed), as [x,y].
function densifyRing(ring, step) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const segs = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step),
    );
    for (let s = 0; s < segs; s++)
      out.push([
        a.x + ((b.x - a.x) * s) / segs,
        a.y + ((b.y - a.y) * s) / segs,
      ]);
  }
  return out;
}

// Quality cap mesh of the glyph region.  Returns the 2D points, the in-region
// triangles, and the surviving boundary edges (for wall building).  `step` is the
// effective edge length actually used (≥ maxEdge when a budget forces coarsening).
export function meshGlyphCaps(loops, maxEdge, pointBudget = 1000) {
  let area = 0;
  for (const lp of loops) {
    area += ringArea(lp.outer);
    for (const h of lp.holes) area -= ringArea(h);
  }
  // Coarsen the step if a fine one would blow the point budget (→ a mesh the
  // kernel's makeSolidFromMesh face limit would reject).  ~0.43·step² of region
  // area per interior lattice point.
  const step = Math.max(
    maxEdge,
    area > 0 ? Math.sqrt(area / (pointBudget * 0.43)) : maxEdge,
  );

  // Densify the CONTOUR at half the interior step: the Delaunay is
  // unconstrained, so across a concave notch (the '5'/'6'/'9' counters) it will
  // happily chord between the two rims when no nearer boundary point blocks the
  // circumcircle — a triangle protruding OUTSIDE the glyph (distorted relief).
  // Closer boundary points make the triangulation follow the contour.
  const points = [];
  for (const lp of loops)
    for (const ring of [lp.outer, ...lp.holes])
      for (const p of densifyRing(ring, step / 2)) points.push(p);
  const nBoundary = points.length;

  // Interior triangular lattice, kept inside the region and a margin off the
  // boundary so the boundary band stays well-shaped.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rowH = (step * Math.sqrt(3)) / 2;
  const margin2 = (step * 0.5) ** 2;
  let row = 0;
  for (let y = minY; y <= maxY; y += rowH, row++) {
    const x0 = minX + (row % 2) * (step / 2);
    for (let x = x0; x <= maxX; x += step) {
      if (!inRegion(x, y, loops)) continue;
      let ok = true;
      for (let b = 0; b < nBoundary; b++) {
        const dx = points[b][0] - x,
          dy = points[b][1] - y;
        if (dx * dx + dy * dy < margin2) {
          ok = false;
          break;
        }
      }
      if (ok) points.push([x, y]);
    }
  }

  // Keep a triangle when its centroid is in the region AND none of its edges
  // properly crosses a contour segment.  The centroid test alone admits
  // notch-chording triangles (centroid inside, apex outside) — the backstop for
  // any chord the densified boundary didn't already prevent.
  const contourSegs = [];
  for (const lp of loops)
    for (const ring of [lp.outer, ...lp.holes])
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        contourSegs.push([a.x, a.y, b.x, b.y]);
      }
  const orient = (ax, ay, bx, by, cx, cy) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  // STRICT (proper) crossing only: collinear overlaps and shared endpoints —
  // boundary-band triangle edges lying ON a contour segment — must not count.
  const properlyCrosses = (p, q, s) => {
    const d1 = orient(s[0], s[1], s[2], s[3], p[0], p[1]);
    const d2 = orient(s[0], s[1], s[2], s[3], q[0], q[1]);
    if (!((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)))
      return false;
    const d3 = orient(p[0], p[1], q[0], q[1], s[0], s[1]);
    const d4 = orient(p[0], p[1], q[0], q[1], s[2], s[3]);
    return (d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12);
  };
  const tris = delaunay(points).filter(([a, b, c]) => {
    const cx = (points[a][0] + points[b][0] + points[c][0]) / 3;
    const cy = (points[a][1] + points[b][1] + points[c][1]) / 3;
    if (!inRegion(cx, cy, loops)) return false;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      for (const s of contourSegs)
        if (properlyCrosses(points[u], points[v], s)) return false;
    return true;
  });

  // Surviving boundary edges = edges used by exactly one kept triangle.
  const edges = new Map();
  for (const [a, b, c] of tris)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = u < v ? u * points.length + v : v * points.length + u;
      const rec = edges.get(k);
      if (rec) rec.count++;
      else edges.set(k, { u, v, count: 1 });
    }
  const boundaryEdges = [];
  for (const { u, v, count } of edges.values())
    if (count === 1) boundaryEdges.push([u, v]);

  return { points, tris, boundaryEdges, step };
}

// Build a watertight flat relief prism (top + bottom quality caps + walls) from
// the centred 2D loops, extruded to `depth` along +z.  `maxEdge` targets a smooth
// wrap onto a surface of that radius.  Output matches the old flatPrismMesh:
// { positions:Array, indices:Array }, ready for the conform wrap.
//
// The caps carry the quality mesh; the walls are single quads per surviving cap
// boundary edge.  A wall runs RADIALLY (depth direction) once wrapped, so its
// length never spans the curved surface — only the cap faces do — so it needs no
// subdivision.  Crucially we do NOT run a global subdivide here: one over-long
// wall edge would trigger a uniform 1→4 pass over the whole mesh and blow past the
// kernel's makeSolidFromMesh face limit.
export function prismFromLoops(loops, depth, maxEdge) {
  const { points, tris, boundaryEdges } = meshGlyphCaps(loops, maxEdge);
  const nP = points.length;
  const positions = new Array(nP * 2 * 3);
  for (let i = 0; i < nP; i++) {
    positions[i * 3] = points[i][0]; // top ring, z = depth
    positions[i * 3 + 1] = points[i][1];
    positions[i * 3 + 2] = depth;
    const j = (nP + i) * 3; // bottom ring, z = 0
    positions[j] = points[i][0];
    positions[j + 1] = points[i][1];
    positions[j + 2] = 0;
  }
  const indices = [];
  for (const [a, b, c] of tris) {
    indices.push(a, b, c); // top cap (+z)
    indices.push(nP + a, nP + c, nP + b); // bottom cap (reversed)
  }
  for (const [a, b] of boundaryEdges) {
    indices.push(a, b, nP + b); // wall quad → two triangles
    indices.push(a, nP + b, nP + a);
  }
  // The glyph cap triangulation + walls can emit MIXED-handedness triangles
  // (holed letters especially), so the raw mesh has faces wound both ways.  Sewn,
  // that's a watertight but inconsistently-oriented solid → reversed render
  // normals that OCC's per-shell OrientClosedSolid (a global flip) can't fix.
  // Flood-fill a consistent winding here; OCC then flips each shell outward.
  return { positions, indices: orientWindingConsistent(indices) };
}

// Make triangle winding CONSISTENT across each connected component: BFS over
// edge-adjacency, flipping any neighbour whose shared edge runs the SAME
// direction as ours (a consistent pair shares an edge in OPPOSITE directions).
// Leaves the global sense alone — the caller's per-shell OrientClosedSolid points
// each component outward.  O(tris).
export function orientWindingConsistent(indices) {
  const nt = indices.length / 3;
  const key = (u, v) => (u < v ? u * 2147483647 + v : v * 2147483647 + u);
  const edgeTris = new Map(); // undirected edge → [triIdx, …]
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3],
      b = indices[t * 3 + 1],
      c = indices[t * 3 + 2];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(u, v);
      let l = edgeTris.get(k);
      if (!l) edgeTris.set(k, (l = []));
      l.push(t);
    }
  }
  const flip = new Array(nt).fill(false);
  const seen = new Array(nt).fill(false);
  // Directed edges of a triangle given its current flip state.
  const dirs = (t) => {
    const a = indices[t * 3],
      b = indices[t * 3 + 1],
      c = indices[t * 3 + 2];
    return flip[t]
      ? [
          [a, c],
          [c, b],
          [b, a],
        ]
      : [
          [a, b],
          [b, c],
          [c, a],
        ];
  };
  for (let s = 0; s < nt; s++) {
    if (seen[s]) continue;
    seen[s] = true;
    const stack = [s];
    while (stack.length) {
      const t = stack.pop();
      for (const [u, v] of dirs(t)) {
        for (const nb of edgeTris.get(key(u, v))) {
          if (nb === t || seen[nb]) continue;
          // Consistent when nb traverses this edge v→u; if it also goes u→v, flip.
          if (dirs(nb).some(([x, y]) => x === u && y === v)) flip[nb] = true;
          seen[nb] = true;
          stack.push(nb);
        }
      }
    }
  }
  const out = new Array(indices.length);
  for (let t = 0; t < nt; t++) {
    const a = indices[t * 3],
      b = indices[t * 3 + 1],
      c = indices[t * 3 + 2];
    if (flip[t]) {
      out[t * 3] = a;
      out[t * 3 + 1] = c;
      out[t * 3 + 2] = b;
    } else {
      out[t * 3] = a;
      out[t * 3 + 1] = b;
      out[t * 3 + 2] = c;
    }
  }
  return out;
}
