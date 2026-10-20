// What the face / edge / point hover needs from a mesh, worked out once per
// geometry instead of on every mouse move.  On a 1M-triangle import the hover
// rebuilt EdgesGeometry (2.3 s) and a string-keyed edge map over every
// triangle each time the cursor moved; these caches make a move cost a walk
// over the face or curve under the cursor.
import * as THREE from "three";

const caches = new WeakMap();

// The cache for this geometry, emptied when its vertices or index change in
// place.
function cacheFor(g) {
  const pos = g.attributes.position;
  const idx = g.index;
  let c = caches.get(g);
  if (
    !c ||
    c.pos !== pos ||
    c.posVersion !== pos.version ||
    c.idx !== idx ||
    c.idxVersion !== (idx ? idx.version : -1)
  ) {
    c = {
      pos,
      posVersion: pos.version,
      idx,
      idxVersion: idx ? idx.version : -1,
    };
    caches.set(g, c);
  }
  return c;
}

const triCountOf = (g) =>
  g.index ? g.index.count / 3 : g.attributes.position.count / 3;

// Per-triangle normals, and which triangles share each edge.  Vertices are
// matched by POSITION rounded to 1e-3, not by index, so coplanar triangles
// joined through duplicated seam vertices still connect.
export function meshTopology(g) {
  const c = cacheFor(g);
  if (c.topology) return c.topology;
  const p = g.attributes.position;
  const index = g.index;
  const T = triCountOf(g);
  const vi = (k) => (index ? index.getX(k) : k);

  const weld = new Map();
  const weldId = new Int32Array(p.count);
  for (let v = 0; v < p.count; v++) {
    const key = `${Math.round(p.getX(v) * 1000)},${Math.round(p.getY(v) * 1000)},${Math.round(p.getZ(v) * 1000)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = weld.size;
      weld.set(key, id);
    }
    weldId[v] = id;
  }
  const W = weld.size;

  const normals = new Float64Array(3 * T);
  const corner = new Int32Array(3 * T);
  for (let t = 0; t < T; t++) {
    const a = vi(3 * t),
      b = vi(3 * t + 1),
      cc = vi(3 * t + 2);
    corner[3 * t] = weldId[a];
    corner[3 * t + 1] = weldId[b];
    corner[3 * t + 2] = weldId[cc];
    const ux = p.getX(b) - p.getX(a),
      uy = p.getY(b) - p.getY(a),
      uz = p.getZ(b) - p.getZ(a);
    const wx = p.getX(cc) - p.getX(a),
      wy = p.getY(cc) - p.getY(a),
      wz = p.getZ(cc) - p.getZ(a);
    const nx = uy * wz - uz * wy,
      ny = uz * wx - ux * wz,
      nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[3 * t] = nx / l;
    normals[3 * t + 1] = ny / l;
    normals[3 * t + 2] = nz / l;
  }

  // Edge -> triangles, keyed by the welded pair; an edge can have more than
  // two triangles on a non-manifold mesh, and all of them connect.
  const edgeTris = new Map();
  const edgeKey = (a, b) => (a < b ? a * W + b : b * W + a);
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      const a = corner[3 * t + k],
        b = corner[3 * t + ((k + 1) % 3)];
      if (a === b) continue;
      const key = edgeKey(a, b);
      const list = edgeTris.get(key);
      if (list === undefined) edgeTris.set(key, t);
      else if (typeof list === "number") edgeTris.set(key, [list, t]);
      else list.push(t);
    }
  const nbrStart = new Int32Array(T + 1);
  const nbrList = [];
  for (let t = 0; t < T; t++) {
    nbrStart[t] = nbrList.length;
    for (let k = 0; k < 3; k++) {
      const a = corner[3 * t + k],
        b = corner[3 * t + ((k + 1) % 3)];
      if (a === b) continue;
      const list = edgeTris.get(edgeKey(a, b));
      if (typeof list === "number") continue;
      for (const q of list) if (q !== t) nbrList.push(q);
    }
  }
  nbrStart[T] = nbrList.length;
  c.topology = {
    triCount: T,
    normals,
    nbrStart,
    nbr: Int32Array.from(nbrList),
  };
  return c.topology;
}

// Every triangle reachable from `seed` across shared edges whose two sides
// turn by less than the angle whose cosine is `cosThr`.
export function growFace(topology, seed, cosThr) {
  const { normals: n, nbrStart, nbr } = topology;
  const seen = new Uint8Array(topology.triCount);
  const out = [seed];
  seen[seed] = 1;
  for (let head = 0; head < out.length; head++) {
    const t = out[head];
    for (let j = nbrStart[t]; j < nbrStart[t + 1]; j++) {
      const q = nbr[j];
      if (seen[q]) continue;
      const d =
        n[3 * t] * n[3 * q] +
        n[3 * t + 1] * n[3 * q + 1] +
        n[3 * t + 2] * n[3 * q + 2];
      if (d > cosThr) {
        seen[q] = 1;
        out.push(q);
      }
    }
  }
  return out;
}

const CELL = 1e-4;
const cellKey = (x, y, z) =>
  `${Math.round(x / CELL)},${Math.round(y / CELL)},${Math.round(z / CELL)}`;

// The mesh's feature edges as a flat array (six numbers per segment), with a
// lookup of the segments that end at a point, for computeSegmentChain.
export function featureEdges(g) {
  const c = cacheFor(g);
  if (c.edges) return c.edges;
  const eg = new THREE.EdgesGeometry(g);
  const segs = Float32Array.from(eg.getAttribute("position").array);
  eg.dispose();
  const ends = new Map();
  const add = (key, i) => {
    const list = ends.get(key);
    if (list) list.push(i);
    else ends.set(key, [i]);
  };
  for (let i = 0; i < segs.length / 6; i++) {
    add(cellKey(segs[6 * i], segs[6 * i + 1], segs[6 * i + 2]), i);
    add(cellKey(segs[6 * i + 3], segs[6 * i + 4], segs[6 * i + 5]), i);
  }
  // An endpoint within the chain's 1e-4 tolerance can round into a
  // neighbouring cell, so look in all 27.
  const near = (x, y, z) => {
    const out = [];
    const cx = Math.round(x / CELL),
      cy = Math.round(y / CELL),
      cz = Math.round(z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = ends.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list) for (const i of list) out.push(i);
        }
    return out;
  };
  c.edges = { segs, near };
  return c.edges;
}

// The segment nearest a point, and its distance.
export function nearestSegment(segs, x, y, z) {
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < segs.length / 6; i++) {
    const ax = segs[6 * i],
      ay = segs[6 * i + 1],
      az = segs[6 * i + 2];
    const abx = segs[6 * i + 3] - ax,
      aby = segs[6 * i + 4] - ay,
      abz = segs[6 * i + 5] - az;
    const apx = x - ax,
      apy = y - ay,
      apz = z - az;
    const t = Math.max(
      0,
      Math.min(
        1,
        (apx * abx + apy * aby + apz * abz) /
          Math.max(abx * abx + aby * aby + abz * abz, 1e-10),
      ),
    );
    const dx = apx - abx * t,
      dy = apy - aby * t,
      dz = apz - abz * t;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distance: Math.sqrt(bestD) };
}

// The vertex nearest a point.
export function nearestVertex(position, x, y, z) {
  let best = -1,
    bestD = Infinity;
  for (let v = 0; v < position.count; v++) {
    const dx = position.getX(v) - x,
      dy = position.getY(v) - y,
      dz = position.getZ(v) - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
