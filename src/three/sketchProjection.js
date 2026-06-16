// Project tool: extract a 3D feature edge from a solid's mesh, drop it onto a
// sketch plane, and fit it to sketch geometry (line / arc / circle, else a
// polyline of lines).  The pure geometry lives here so it can be unit-tested;
// the picking/store wiring is in cameraControls + the store.

import * as THREE from "three";

const vKey = (x, y, z) =>
  `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;

// Build the mesh's feature edges (a sharp dihedral between adjacent faces, or a
// boundary edge) as a vertex-key adjacency graph.  positions/indices are flat
// arrays already in WORLD space.  Returns { nodes: Map(key->{x,y,z}),
// adj: Map(key->Set(key)) }.
export function featureEdgeGraph(positions, indices, sharpAngleRad = 0.35) {
  const triCount = (indices ? indices.length : positions.length / 3) / 3;
  const vi = (t, c) => (indices ? indices[t * 3 + c] : t * 3 + c);
  const v = (i) => ({
    x: positions[i * 3],
    y: positions[i * 3 + 1],
    z: positions[i * 3 + 2],
  });
  const faceNormal = (a, b, c) => {
    const abx = b.x - a.x,
      aby = b.y - a.y,
      abz = b.z - a.z;
    const acx = c.x - a.x,
      acy = c.y - a.y,
      acz = c.z - a.z;
    const nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / l, y: ny / l, z: nz / l };
  };
  // edgeKey -> { p, q, normals: [] }
  const edges = new Map();
  const nodes = new Map();
  const note = (p, q, n) => {
    const kp = vKey(p.x, p.y, p.z),
      kq = vKey(q.x, q.y, q.z);
    if (!nodes.has(kp)) nodes.set(kp, p);
    if (!nodes.has(kq)) nodes.set(kq, q);
    const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
    let e = edges.get(key);
    if (!e) {
      e = { kp, kq, normals: [] };
      edges.set(key, e);
    }
    e.normals.push(n);
  };
  for (let t = 0; t < triCount; t++) {
    const a = v(vi(t, 0)),
      b = v(vi(t, 1)),
      c = v(vi(t, 2));
    const n = faceNormal(a, b, c);
    note(a, b, n);
    note(b, c, n);
    note(c, a, n);
  }
  const adj = new Map();
  const link = (kp, kq) => {
    if (!adj.has(kp)) adj.set(kp, new Set());
    if (!adj.has(kq)) adj.set(kq, new Set());
    adj.get(kp).add(kq);
    adj.get(kq).add(kp);
  };
  const cosSharp = Math.cos(sharpAngleRad);
  const segments = [];
  edges.forEach((e) => {
    let sharp = e.normals.length === 1; // boundary edge
    for (let i = 0; i < e.normals.length && !sharp; i++)
      for (let j = i + 1; j < e.normals.length; j++) {
        const a = e.normals[i],
          b = e.normals[j];
        if (a.x * b.x + a.y * b.y + a.z * b.z < cosSharp) sharp = true;
      }
    if (sharp) {
      link(e.kp, e.kq);
      segments.push([e.kp, e.kq]);
    }
  });
  return { nodes, adj, segments };
}

// 60°-ish: continue a feature edge across a node only when the turn stays this
// straight, so a smooth rim flows on but a sharp corner ends the edge.
const STRAIGHT_DOT = 0.4;

// Walk the connected feature edge that passes nearest `world` into one ordered
// polyline of world points.  Follows the graph from the nearest node, greedily
// taking the straightest continuation at each step (so a circular rim becomes a
// single loop, not a tangle).
export function edgePolylineNear(graph, world) {
  const { nodes, adj, segments } = graph;
  if (!segments || segments.length === 0) return null;

  const dirBetween = (k1, k2) => {
    const a = nodes.get(k1),
      b = nodes.get(k2);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  };

  // Nearest feature-edge segment to the cursor (point-to-segment distance).
  let near = null,
    bestD = Infinity;
  for (const [k1, k2] of segments) {
    const a = nodes.get(k1),
      b = nodes.get(k2);
    const abx = b.x - a.x,
      aby = b.y - a.y,
      abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
    let t =
      ((world.x - a.x) * abx + (world.y - a.y) * aby + (world.z - a.z) * abz) /
      len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * abx,
      py = a.y + t * aby,
      pz = a.z + t * abz;
    const d = (px - world.x) ** 2 + (py - world.y) ** 2 + (pz - world.z) ** 2;
    if (d < bestD) {
      bestD = d;
      near = [k1, k2];
    }
  }
  if (!near) return null;

  const visited = new Set(near);
  // Extend from `from` (having arrived along `inDir`) while the edge stays
  // straight/smooth, returning the chain of keys past `from`.
  const extend = (from, inDir) => {
    const chain = [];
    let cur = from,
      dir = inDir;
    for (;;) {
      const nexts = [...(adj.get(cur) || [])].filter((k) => !visited.has(k));
      let best = null,
        bestDot = STRAIGHT_DOT;
      for (const nx of nexts) {
        const d = dirBetween(cur, nx);
        const dot = d.x * dir.x + d.y * dir.y + d.z * dir.z;
        if (dot > bestDot) {
          bestDot = dot;
          best = nx;
        }
      }
      if (!best) break;
      visited.add(best);
      chain.push(best);
      dir = dirBetween(cur, best);
      cur = best;
    }
    return chain;
  };

  const fwd = extend(near[1], dirBetween(near[0], near[1]));
  const back = extend(near[0], dirBetween(near[1], near[0]));
  const keys = back.reverse().concat([near[0], near[1]], fwd);
  return keys.map((k) => nodes.get(k));
}

// Decompose the whole feature-edge graph into ordered chains (maximal smooth
// runs between junctions / sharp corners), so "project all connected edges"
// yields one fitted shape per real edge.  Returns an array of world polylines.
export function decomposeFeatureEdges(graph) {
  const { nodes, adj } = graph;
  const usedEdge = new Set();
  const ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const dirBetween = (k1, k2) => {
    const a = nodes.get(k1),
      b = nodes.get(k2);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / l, y: dy / l, z: dz / l };
  };
  const chains = [];
  const walk = (start, next) => {
    const keys = [start, next];
    usedEdge.add(ek(start, next));
    let prev = start,
      cur = next,
      inDir = dirBetween(start, next);
    for (;;) {
      const nbrs = [...(adj.get(cur) || [])];
      if (nbrs.length !== 2) break; // junction → end chain
      const nxt = nbrs.find((k) => k !== prev);
      if (nxt == null || usedEdge.has(ek(cur, nxt))) break; // closed loop
      const outDir = dirBetween(cur, nxt);
      if (
        outDir.x * inDir.x + outDir.y * inDir.y + outDir.z * inDir.z <
        STRAIGHT_DOT
      )
        break; // sharp corner → end chain
      usedEdge.add(ek(cur, nxt));
      keys.push(nxt);
      prev = cur;
      cur = nxt;
      inDir = outDir;
    }
    return keys.map((k) => nodes.get(k));
  };
  // Chains anchored at junction nodes first…
  nodes.forEach((_, k) => {
    const deg = adj.get(k)?.size ?? 0;
    if (deg === 2 || deg === 0) return;
    for (const nb of adj.get(k))
      if (!usedEdge.has(ek(k, nb))) chains.push(walk(k, nb));
  });
  // …then any remaining all-degree-2 closed loops (e.g. a cylinder rim).
  adj.forEach((nbrs, k) => {
    for (const nb of nbrs)
      if (!usedEdge.has(ek(k, nb))) chains.push(walk(k, nb));
  });
  return chains.filter((c) => c.length >= 2);
}

// Drop near-zero-length lines and duplicate/coincident shapes from a projected
// set.  Projecting a body's whole wireframe onto a parallel plane collapses
// front/back edges onto each other (and edges perpendicular to the plane onto
// points); leaving those in makes region detection degenerate.  Keeps the first
// of each, so the projection reads as a clean outline.
export function dedupProjectedShapes(shapes, eps = 1e-3) {
  const r = (n) => Math.round((n ?? 0) / eps);
  const seen = new Set();
  const out = [];
  for (const s of shapes) {
    let sig;
    if (s.type === "line") {
      const d = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (d < eps) continue; // collapsed to (near) a point
      const a = [r(s.x1), r(s.y1)];
      const b = [r(s.x2), r(s.y2)];
      // Undirected: order the endpoints so A→B and B→A dedupe together.
      const [p, q] =
        a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
      sig = `l${p[0]},${p[1]},${q[0]},${q[1]}`;
    } else if (s.type === "circle") {
      sig = `c${r(s.cx)},${r(s.cy)},${r(s.r)}`;
    } else if (s.type === "arc") {
      sig = `a${r(s.cx)},${r(s.cy)},${r(s.r)},${r(s.startAngle)},${r(s.endAngle)}`;
    } else {
      sig = JSON.stringify(s);
    }
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(s);
  }
  return out;
}

// Drop world points perpendicular onto the sketch plane, then express them in
// the sketch's local 2D frame.  origin = sketch.position, quat = sketch
// orientation (its +Z is the plane normal).
export function worldPolylineToLocal2D(worldPts, origin, quat) {
  const inv = quat.clone().invert();
  return worldPts.map((p) => {
    const local = new THREE.Vector3(p.x, p.y, p.z)
      .sub(origin)
      .applyQuaternion(inv);
    return { x: local.x, y: local.y };
  });
}

// Algebraic (Kåsa) circle fit → { cx, cy, r } or null.
function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sxz = 0,
    syz = 0,
    sz = 0;
  for (const { x, y } of pts) {
    const z = x * x + y * y;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c]^T = [sxz syz sz]^T,
  // circle: x²+y² = a x + b y + c, centre (a/2,b/2).
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [sxz, syz, sz];
  const sol = solve3(m, rhs);
  if (!sol) return null;
  const [a, b, c] = sol;
  const cx = a / 2,
    cy = b / 2;
  const r2 = c + cx * cx + cy * cy;
  if (r2 <= 0) return null;
  return { cx, cy, r: Math.sqrt(r2) };
}

function solve3(m, b) {
  const A = m.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++)
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k <= 3; k++) A[r][k] -= f * A[col][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Fit a projected 2D polyline to the best sketch shape(s).  Returns an array of
// shape objects (line / arc / circle, else a polyline of lines).  `tag` is
// merged into every shape (the projection link).
export function fitProjectedShapes(pts, tag = {}) {
  const clean = [];
  for (const p of pts)
    if (clean.length === 0 || dist2(clean[clean.length - 1], p) > 1e-8)
      clean.push(p);
  if (clean.length < 2) return [];
  const a = clean[0],
    b = clean[clean.length - 1];
  const closed = dist2(a, b) < 1e-6 && clean.length > 3;

  // Collinear → a single line.
  if (!closed) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let maxOff = 0;
    for (const p of clean) {
      const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (off > maxOff) maxOff = off;
    }
    if (maxOff < Math.max(1e-3, len * 0.01))
      return [{ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...tag }];
  }

  // Circle / arc fit.
  const circ = fitCircle(clean);
  if (circ) {
    let maxErr = 0;
    for (const p of clean) {
      const d = Math.hypot(p.x - circ.cx, p.y - circ.cy);
      maxErr = Math.max(maxErr, Math.abs(d - circ.r));
    }
    if (maxErr < Math.max(1e-3, circ.r * 0.04)) {
      const ang = (p) => Math.atan2(p.y - circ.cy, p.x - circ.cx);
      if (closed)
        return [
          { type: "circle", cx: circ.cx, cy: circ.cy, r: circ.r, ...tag },
        ];
      // Arc: span from the first to the last point, swept through the middle.
      const a0 = ang(clean[0]);
      const a1 = ang(clean[clean.length - 1]);
      const am = ang(clean[Math.floor(clean.length / 2)]);
      const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      // CCW span a0→a1 contains am?
      const ccwSpan = norm(a1 - a0);
      const ccwToMid = norm(am - a0);
      const startAngle = ccwToMid <= ccwSpan ? a0 : a1;
      const endAngle = ccwToMid <= ccwSpan ? a1 : a0;
      return [
        {
          type: "arc",
          cx: circ.cx,
          cy: circ.cy,
          r: circ.r,
          startAngle,
          endAngle,
          ...tag,
        },
      ];
    }
  }

  // Fallback: a polyline of straight segments.
  const out = [];
  for (let i = 0; i < clean.length - 1; i++)
    out.push({
      type: "line",
      x1: clean[i].x,
      y1: clean[i].y,
      x2: clean[i + 1].x,
      y2: clean[i + 1].y,
      ...tag,
    });
  return out;
}
