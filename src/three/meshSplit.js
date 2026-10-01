// Splitting an imported mesh along a plane, in the renderer -- the fallback
// when OCC can't rebuild the target as a solid.  (This file also held a
// three-bvh-csg boolean for imported meshes; its results leaked -- hundreds to
// thousands of open edges along every intersection curve -- so booleans go
// through OCC now.)

import * as THREE from "three";

// Split with OCC, and with the exact mesh split below wherever OCC fails --
// by throwing, as it does on an imported mesh it can't rebuild as a solid,
// or by handing back one side only.  The second used to be reported as "that
// cut doesn't pass through" for a cut that plainly did: a plane grazing a
// face of mms2_base inside OCC's tolerances came back with an empty
// difference, while the mesh split cut it into 11,384 and 10,004 triangles.
// Returns { result } with both parts, or { result, error } for the caller to
// explain: one side only (the cut misses), or nothing at all.
export async function splitWithFallback(occSplit, meshFallback) {
  let result = null;
  let error = null;
  try {
    result = await occSplit();
  } catch (err) {
    error = err;
  }
  if (result?.partA && result?.partB) return { result };
  const mesh = meshFallback();
  if (mesh?.partA && mesh?.partB) return { result: mesh, viaMesh: true };
  return { result: result ?? mesh ?? null, error };
}

// Split a world-space scene mesh into two parts along a plane -- the fallback
// when OCC can't rebuild the target as a solid.  partA is the +normal side,
// partB the -normal side.
//
// This used three-bvh-csg (the body intersected with, and subtracted from, a
// half-space box).  Its output is a triangle soup whose cut boundary is full of
// T-junctions -- a wall edge meeting two cap edges at a vertex it doesn't own --
// so no piece came back closed: 12 open edges on each half of a plain cube,
// thousands on a clean imported STL, at any weld tolerance.  OCC then sewed an
// open shell, and anything fused into the piece came out leaky.  The split is
// now exact: each crossing edge is cut at ONE point shared by both triangles
// that use it, and each part's cap is triangulated from its own boundary
// vertices, so a closed input gives closed parts.  An open input stays open
// where it was open; nothing is invented.
export function meshSplit(mesh, plane) {
  if (!mesh?.geometry) return null;
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry.getAttribute("position");
  const idxAttr = mesh.geometry.index;
  const m = mesh.matrixWorld;

  // Weld by exact position: an imported STL stores three private vertices per
  // triangle, and the split must see which edges are shared.
  const pts = [];
  const vid = new Map();
  const remap = new Array(src.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i).applyMatrix4(m);
    const key = `${v.x},${v.y},${v.z}`;
    let id = vid.get(key);
    if (id === undefined) {
      id = pts.length / 3;
      vid.set(key, id);
      pts.push(v.x, v.y, v.z);
    }
    remap[i] = id;
  }
  const triCount = idxAttr ? idxAttr.count / 3 : src.count / 3;
  const corner = (t, k) => remap[idxAttr ? idxAttr.getX(3 * t + k) : 3 * t + k];

  const n = new THREE.Vector3(0, 0, 1).applyEuler(
    new THREE.Euler(
      plane.rotation?.x || 0,
      plane.rotation?.y || 0,
      plane.rotation?.z || 0,
    ),
  );
  const o = plane.position;
  // Signed distances, with anything within a hair of the plane snapped onto it
  // so a vertex lying on the cut is shared, not split around.
  let extent = 0;
  for (let i = 0; i < pts.length; i++)
    extent = Math.max(extent, Math.abs(pts[i]));
  // Float32 positions -- every imported STL -- carry about 1e-7 of relative
  // precision.  A vertex closer than that is ON the plane; at 1e-9 one sat just
  // outside, and the crossing on its edge landed at its own position: two
  // vertices in one place, and a zero-area sliver in the cap.
  const EPS = 1e-7 * Math.max(1, extent);
  const vCount = pts.length / 3;
  const dist = new Float64Array(vCount);
  for (let i = 0; i < vCount; i++) {
    const d =
      (pts[3 * i] - o.x) * n.x +
      (pts[3 * i + 1] - o.y) * n.y +
      (pts[3 * i + 2] - o.z) * n.z;
    dist[i] = Math.abs(d) < EPS ? 0 : d;
  }

  // One intersection vertex per crossing EDGE, whichever triangle asks first.
  const cut = new Map();
  const onPlane = new Set();
  for (let i = 0; i < vCount; i++) if (dist[i] === 0) onPlane.add(i);
  const crossing = (a, b) => {
    const key = a < b ? a * vCount + b : b * vCount + a;
    let id = cut.get(key);
    if (id === undefined) {
      const t = dist[a] / (dist[a] - dist[b]);
      id = pts.length / 3;
      for (let k = 0; k < 3; k++)
        pts.push(pts[3 * a + k] + t * (pts[3 * b + k] - pts[3 * a + k]));
      cut.set(key, id);
      onPlane.add(id);
    }
    return id;
  };

  const sideA = [];
  const sideB = [];
  const emit = (poly, out) => {
    for (let k = 1; k + 1 < poly.length; k++)
      out.push(poly[0], poly[k], poly[k + 1]);
  };
  const side = (i) => (dist[i] > 0 ? 1 : dist[i] < 0 ? -1 : 0);
  for (let t = 0; t < triCount; t++) {
    const tri = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const s = tri.map(side);
    if (s.every((x) => x >= 0) && s.some((x) => x > 0)) {
      sideA.push(...tri);
      continue;
    }
    if (s.every((x) => x <= 0) && s.some((x) => x < 0)) {
      sideB.push(...tri);
      continue;
    }
    if (s.every((x) => x === 0)) {
      // A face lying ON the cut plane is a boundary of the solid: it belongs to
      // the side its material is on, i.e. opposite its outward normal.
      const [a, b, c] = tri.map((i) =>
        new THREE.Vector3().fromArray(pts, 3 * i),
      );
      const fn = b.clone().sub(a).cross(c.clone().sub(a));
      (fn.dot(n) < 0 ? sideA : sideB).push(...tri);
      continue;
    }
    // Crosses the plane: walk the triangle, dropping on-plane vertices into both
    // polygons and inserting the shared edge crossing between opposite signs.
    const polyA = [];
    const polyB = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const sa = s[k];
      const sb = s[(k + 1) % 3];
      if (sa >= 0) polyA.push(a);
      if (sa <= 0) polyB.push(a);
      if (sa * sb < 0) {
        const x = crossing(a, b);
        polyA.push(x);
        polyB.push(x);
      }
    }
    if (polyA.length >= 3) emit(polyA, sideA);
    if (polyB.length >= 3) emit(polyB, sideB);
  }

  const capA = capOnPlane(sideA, pts, onPlane, n);
  const partA = sideA.length ? toPart(pts, [...sideA, ...capA]) : null;
  // B's cap is A's, facing the other way: the same vertices, so the two parts
  // meet along identical edges.
  const capB = [];
  for (let i = 0; i < capA.length; i += 3)
    capB.push(capA[i], capA[i + 2], capA[i + 1]);
  const partB = sideB.length ? toPart(pts, [...sideB, ...capB]) : null;
  if (!partA && !partB) return null;
  return { partA, partB };
}

// The part's open boundary on the cut plane, as loops.  An edge a -> b used by
// the part with nothing running b -> a is open; the cap must run b -> a, so
// each loop comes out already in the direction the cap has to traverse.
export function openLoopsOnPlane(tris, onPlane) {
  const used = new Set();
  const key = (a, b) => `${a}_${b}`;
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++)
      used.add(key(tris[t + k], tris[t + ((k + 1) % 3)]));
  // A vertex can have SEVERAL open edges leaving it: two cap loops touching at
  // one point.  Keeping one successor per vertex broke both loops there and
  // they were silently dropped, leaving that part of the cut open.
  const out = new Map();
  used.forEach((k) => {
    const [a, b] = k.split("_").map(Number);
    if (onPlane.has(a) && onPlane.has(b) && !used.has(key(b, a))) {
      if (!out.has(b)) out.set(b, []);
      out.get(b).push(a);
    }
  });
  const loops = [];
  for (const start of out.keys()) {
    while (out.get(start).length) {
      // Walk a closed trail, using each open edge once.
      const trail = [start];
      let cur = start;
      do {
        const list = out.get(cur);
        if (!list?.length) break;
        cur = list.pop();
        trail.push(cur);
      } while (cur !== start);
      if (cur !== start) continue; // an open chain bounds nothing
      // Cut it into simple loops wherever it revisits a vertex, so a pinch
      // gives two loops rather than one figure-eight.
      const stack = [];
      const at = new Map();
      for (const v of trail) {
        if (at.has(v)) {
          const loop = stack.splice(at.get(v));
          for (const x of loop) at.delete(x);
          if (loop.length >= 3) loops.push(loop);
        }
        at.set(v, stack.length);
        stack.push(v);
      }
    }
  }
  return loops;
}

// Triangles closing a part's open boundary ON the cut plane.  A closed input
// leaves exactly the cut loops open; they are sorted into outlines and holes
// and triangulated with no new vertices, so the cap shares every edge with the
// wall it closes.
function capOnPlane(tris, pts, onPlane, n) {
  const loops = openLoopsOnPlane(tris, onPlane);
  if (!loops.length) return [];

  // 2D coordinates in the plane, with (u, v, n) right-handed so a loop that
  // runs counter-clockwise in 2D faces +n.
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(u.dot(n)) > 0.9) u.set(0, 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const w = n.clone().cross(u);
  const to2d = (i) =>
    new THREE.Vector2(
      pts[3 * i] * u.x + pts[3 * i + 1] * u.y + pts[3 * i + 2] * u.z,
      pts[3 * i] * w.x + pts[3 * i + 1] * w.y + pts[3 * i + 2] * w.z,
    );
  const rings = loops.map((l) => {
    const p2 = l.map(to2d);
    return { verts: l, p2, area: THREE.ShapeUtils.area(p2) };
  });
  // The cap closes part A (material on +n), so it faces -n: its outlines run
  // clockwise in 2D, and the holes inside them counter-clockwise.
  const outlines = rings.filter((r) => r.area < 0);
  const holes = rings.filter((r) => r.area > 0);
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (
        poly[i].y > pt.y !== poly[j].y > pt.y &&
        pt.x <
          ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) /
            (poly[j].y - poly[i].y) +
            poly[i].x
      )
        c = !c;
    return c;
  };
  const holesOf = new Map(outlines.map((r) => [r, []]));
  for (const h of holes) {
    // The smallest outline around it owns it.
    let owner = null;
    for (const r of outlines)
      if (
        inside(h.p2[0], r.p2) &&
        (!owner || Math.abs(r.area) < Math.abs(owner.area))
      )
        owner = r;
    if (owner) holesOf.get(owner).push(h);
  }
  const cap = [];
  for (const r of outlines) {
    const hs = holesOf.get(r);
    const verts = [...r.verts, ...hs.flatMap((h) => h.verts)];
    const faces = THREE.ShapeUtils.triangulateShape(
      r.p2,
      hs.map((h) => h.p2),
    );
    // triangulateShape returns counter-clockwise faces; the cap faces -n.
    for (const [a, b, c] of faces) cap.push(verts[a], verts[c], verts[b]);
  }

  // Earcut drops near-duplicate and collinear points on tight features, and
  // the triangles around them go with it: on a real imported part it returned
  // 144 of 147, leaving two slivers of the cut open.  Whatever is still open
  // on the plane is filled loop by loop -- each loop already runs the way its
  // fill must -- falling back to a fan where earcut can't place a sliver.
  for (let pass = 0; pass < 3; pass++) {
    const residual = openLoopsOnPlane([...tris, ...cap], onPlane);
    if (!residual.length) break;
    for (const loop of residual) {
      const p2 = loop.map(to2d);
      const faces = THREE.ShapeUtils.triangulateShape(p2, []);
      if (faces.length === loop.length - 2) {
        // Counter-clockwise faces; flip them to follow a clockwise loop.
        const ccw = THREE.ShapeUtils.area(p2) > 0;
        for (const [a, b, c] of faces)
          if (ccw) cap.push(loop[a], loop[b], loop[c]);
          else cap.push(loop[a], loop[c], loop[b]);
      } else {
        for (let k = 1; k + 1 < loop.length; k++)
          cap.push(loop[0], loop[k], loop[k + 1]);
      }
    }
  }
  return cap;
}

// A bbox-centred geometryData + world centre from welded points and triangles,
// keeping only the vertices the part uses.
function toPart(pts, tris) {
  const local = new Map();
  const positions = [];
  const indices = [];
  for (const i of tris) {
    let j = local.get(i);
    if (j === undefined) {
      j = positions.length / 3;
      local.set(i, j);
      positions.push(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    }
    indices.push(j);
  }
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], positions[i + k]);
      mx[k] = Math.max(mx[k], positions[i + k]);
    }
  const c = mn.map((a, k) => (a + mx[k]) / 2);
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) positions[i + k] -= c[k];
  return {
    // Welded across its sharp edges (the cut rim), so drawn flat.
    geometryData: { positions, normals: null, indices, flat: true },
    position: { x: c[0], y: c[1], z: c[2] },
  };
}
