// Project tool: extract a 3D feature edge from a solid's mesh, drop it onto a
// sketch plane, and fit it to sketch geometry (line / arc / circle, else a
// polyline of lines).  The pure geometry lives here so it can be unit-tested;
// the picking/store wiring is in cameraControls + the store.

import * as THREE from "three";

const vKey = (x, y, z) =>
  `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;

// Build the mesh's feature edges (a sharp dihedral between adjacent faces, or a
// boundary edge) as a vertex-key adjacency graph.  positions/indices are flat
// arrays already in WORLD space.  The FULL graph is always built so corner
// vertices keep their true degree (decomposition must break edges there).  When
// `planeNormal` (the sketch plane's world normal) is given, the SILHOUETTE edges
// — boundary edges, or edges between a front- and a back-facing face — are
// recorded in `silhouetteEdges`; decomposeFeatureEdges keeps only those chains,
// so a body projects as its outer outline (no internal or hidden edges).
// Returns { nodes, adj, segments, silhouetteEdges:Set|null }.
export function featureEdgeGraph(
  positions,
  indices,
  sharpAngleRad = 0.35,
  planeNormal = null,
) {
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
  const pn = planeNormal;
  // The FULL feature-edge graph is built (so corner vertices keep their true
  // degree and decomposition breaks edges there).  Silhouette membership is
  // recorded per edge — an outline edge is a boundary edge, or one between a
  // front-facing and a non-front-facing face.  decomposeFeatureEdges keeps only
  // the silhouette chains, so projecting a body yields just its outer outline
  // (no internal/visible-interior edges).
  const isSilhouette = (e) => {
    if (!pn) return true;
    if (e.normals.length === 1) return true; // boundary
    let front = false,
      back = false;
    for (const n of e.normals) {
      if (n.x * pn.x + n.y * pn.y + n.z * pn.z > 1e-6) front = true;
      else back = true;
    }
    return front && back;
  };
  const segments = [];
  const silhouetteEdges = pn ? new Set() : null;
  const ekey = (kp, kq) => (kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`);
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
      if (silhouetteEdges && isSilhouette(e))
        silhouetteEdges.add(ekey(e.kp, e.kq));
    }
  });
  return { nodes, adj, segments, silhouetteEdges };
}

// 60°-ish: continue a feature edge across a node only when the turn stays this
// straight, so a smooth rim flows on but a sharp corner ends the edge.
const STRAIGHT_DOT = 0.4;

// Decompose the whole feature-edge graph into ordered chains (maximal smooth
// runs between junctions / sharp corners), so "project all connected edges"
// yields one fitted shape per real edge.  Returns an array of world polylines.
export function decomposeFeatureEdges(graph) {
  const { nodes, adj, silhouetteEdges } = graph;
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
    return keys;
  };
  // Keep a chain only if it has a silhouette (outline) edge — so internal and
  // hidden edges are dropped, while corners stay split because the full graph
  // kept their real junction degree.
  const keep = (keys) => {
    if (!silhouetteEdges) return true;
    for (let i = 0; i < keys.length - 1; i++)
      if (silhouetteEdges.has(ek(keys[i], keys[i + 1]))) return true;
    return false;
  };
  const addChain = (start, next) => {
    const keys = walk(start, next);
    if (keys.length >= 2 && keep(keys))
      chains.push(keys.map((k) => nodes.get(k)));
  };
  // Chains anchored at junction nodes first…
  nodes.forEach((_, k) => {
    const deg = adj.get(k)?.size ?? 0;
    if (deg === 2 || deg === 0) return;
    for (const nb of adj.get(k)) if (!usedEdge.has(ek(k, nb))) addChain(k, nb);
  });
  // …then any remaining all-degree-2 closed loops (e.g. a cylinder rim).
  adj.forEach((nbrs, k) => {
    for (const nb of nbrs) if (!usedEdge.has(ek(k, nb))) addChain(k, nb);
  });
  return chains;
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

// Projected chains (2D polylines on the sketch plane) grouped into connected
// sets: chains whose ends meet within `eps` belong together, so hovering one
// side of a projected outline picks up the whole outline.  Returns an array of
// arrays of chain indices.
export function connectedChainGroups(chains, eps = 1e-4) {
  const parent = chains.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = (p) => `${Math.round(p.x / eps)},${Math.round(p.y / eps)}`;
  const byCell = new Map();
  chains.forEach((c, i) => {
    for (const p of [c[0], c[c.length - 1]]) {
      // An end within eps can round into a neighbouring cell, so look in all
      // nine round it.
      const cx = Math.round(p.x / eps),
        cy = Math.round(p.y / eps);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const j = byCell.get(`${cx + dx},${cy + dy}`);
          if (j != null) parent[find(i)] = find(j);
        }
      byCell.set(cell(p), i);
    }
  });
  const groups = new Map();
  chains.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  return [...groups.values()];
}

// The chain nearest `pt` on the plane, if one passes within `maxDist`:
// { index, distance }, or null.
export function nearestChain(chains, pt, maxDist) {
  let best = null;
  chains.forEach((c, i) => {
    for (let k = 0; k + 1 < c.length; k++) {
      const a = c[k],
        b = c[k + 1];
      const abx = b.x - a.x,
        aby = b.y - a.y;
      const L = abx * abx + aby * aby;
      const t =
        L > 0
          ? Math.max(
              0,
              Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / L),
            )
          : 0;
      const d = Math.hypot(pt.x - a.x - abx * t, pt.y - a.y - aby * t);
      if (d <= maxDist && (!best || d < best.distance))
        best = { index: i, distance: d };
    }
  });
  return best;
}
