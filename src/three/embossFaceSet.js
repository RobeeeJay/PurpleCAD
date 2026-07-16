// Connected-face grow + cylinder fit for the Emboss tool's face selection.
//
// growConnectedFaceSet walks the mesh triangles from a hit across shared edges,
// following neighbours whose dihedral angle is within the curve-detection angle
// — so a flat face, a faceted cylinder, or a gentle wave each select as one set.
// fitCylinderToFaceSet then estimates a cylinder (axis ⟂ the face normals, radius
// from the centroids) so the conform projection can wrap the relief around it; a
// flat set returns null and falls back to centre-face projection.

import * as THREE from "three";

const triIdxOf = (geometry, i) => {
  const idx = geometry.index;
  return idx
    ? [idx.getX(i * 3), idx.getX(i * 3 + 1), idx.getX(i * 3 + 2)]
    : [i * 3, i * 3 + 1, i * 3 + 2];
};

// Returns { positions:[flat local tri verts], normals:[[x,y,z]…], centroids:[…] }
// for the connected face set, or null.
export function growConnectedFaceSet(
  geometry,
  seedFaceIndex,
  seedNormalLocal,
  maxAngleDeg,
) {
  const pos = geometry.getAttribute("position");
  if (!pos) return null;
  const triCount = geometry.index ? geometry.index.count / 3 : pos.count / 3;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const triNormals = new Array(triCount);
  const triCentroids = new Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const [a, b, c] = triIdxOf(geometry, i);
    v[0].set(pos.getX(a), pos.getY(a), pos.getZ(a));
    v[1].set(pos.getX(b), pos.getY(b), pos.getZ(b));
    v[2].set(pos.getX(c), pos.getY(c), pos.getZ(c));
    triNormals[i] = new THREE.Vector3()
      .crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0]))
      .normalize();
    triCentroids[i] = v[0]
      .clone()
      .add(v[1])
      .add(v[2])
      .multiplyScalar(1 / 3);
  }

  let seed = -1;
  const sn = new THREE.Vector3(
    seedNormalLocal.x,
    seedNormalLocal.y,
    seedNormalLocal.z,
  ).normalize();
  if (
    typeof seedFaceIndex === "number" &&
    triNormals[seedFaceIndex] &&
    triNormals[seedFaceIndex].dot(sn) > 0.9
  ) {
    seed = seedFaceIndex;
  } else {
    let best = -1;
    for (let i = 0; i < triCount; i++)
      if (triNormals[i].dot(sn) > 0.99) {
        seed = i;
        best = i;
        break;
      }
    if (best < 0) return null;
  }

  // Edge → adjacent triangles, keyed by ROUNDED vertex positions so welded /
  // split seam verts still connect.
  const round = (x) => Math.round(x * 1000) / 1000;
  const vKey = (idx) =>
    `${round(pos.getX(idx))},${round(pos.getY(idx))},${round(pos.getZ(idx))}`;
  const eKey = (i1, i2) => {
    const k1 = vKey(i1),
      k2 = vKey(i2);
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };
  const edgeToTris = new Map();
  const triEdges = new Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const [a, b, c] = triIdxOf(geometry, i);
    const es = [eKey(a, b), eKey(b, c), eKey(c, a)];
    triEdges[i] = es;
    for (const k of es) {
      let l = edgeToTris.get(k);
      if (!l) edgeToTris.set(k, (l = []));
      l.push(i);
    }
  }

  const cosThr = Math.cos((Math.max(0, maxAngleDeg) * Math.PI) / 180);
  const visited = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const t = queue.shift();
    for (const ek of triEdges[t]) {
      const adj = edgeToTris.get(ek);
      if (!adj) continue;
      for (const nt of adj) {
        if (visited.has(nt)) continue;
        // Follow the local dihedral (current tri vs neighbour) so the set bends
        // gradually around a curve but stops at a sharp edge.
        if (triNormals[t].dot(triNormals[nt]) > cosThr) {
          visited.add(nt);
          queue.push(nt);
        }
      }
    }
  }

  const positions = [];
  const normals = [];
  const centroids = [];
  for (const i of visited) {
    const [a, b, c] = triIdxOf(geometry, i);
    positions.push(
      pos.getX(a),
      pos.getY(a),
      pos.getZ(a),
      pos.getX(b),
      pos.getY(b),
      pos.getZ(b),
      pos.getX(c),
      pos.getY(c),
      pos.getZ(c),
    );
    const n = triNormals[i],
      ct = triCentroids[i];
    normals.push([n.x, n.y, n.z]);
    centroids.push([ct.x, ct.y, ct.z]);
  }
  return { positions, normals, centroids };
}

// Per-triangle normals + centroids for a flat [x,y,z,…] positions array (9 per
// triangle) — the form an accumulated multi-face selection is stored in.
export function triData(positions) {
  const normals = [];
  const centroids = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i + 8 < positions.length; i += 9) {
    a.set(positions[i], positions[i + 1], positions[i + 2]);
    b.set(positions[i + 3], positions[i + 4], positions[i + 5]);
    c.set(positions[i + 6], positions[i + 7], positions[i + 8]);
    const n = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize();
    normals.push([n.x, n.y, n.z]);
    centroids.push([
      (a.x + b.x + c.x) / 3,
      (a.y + b.y + c.y) / 3,
      (a.z + b.z + c.z) / 3,
    ]);
  }
  return { normals, centroids };
}

// True when every triangle of a flat positions array is reachable from the first
// across shared edges whose dihedral is within maxAngleDeg — i.e. the selected
// faces form ONE connected set with no neighbour bending more than that.  Used to
// gate the emboss Confirm: a multi-face pick must be connected within 45°.
export function validateFaceSetConnectivity(positions, maxAngleDeg = 45) {
  const triCount = Math.floor(positions.length / 9);
  if (triCount === 0) return false;
  if (triCount === 1) return true;
  const { normals } = triData(positions);
  const nrm = normals.map((n) => new THREE.Vector3(n[0], n[1], n[2]));
  const round = (x) => Math.round(x * 1000) / 1000;
  const vKey = (i, k) =>
    `${round(positions[i + k * 3])},${round(positions[i + k * 3 + 1])},${round(positions[i + k * 3 + 2])}`;
  const eKey = (ka, kb) => (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
  const edgeToTris = new Map();
  const triEdges = [];
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const k0 = vKey(i, 0),
      k1 = vKey(i, 1),
      k2 = vKey(i, 2);
    const es = [eKey(k0, k1), eKey(k1, k2), eKey(k2, k0)];
    triEdges.push(es);
    for (const e of es) {
      let l = edgeToTris.get(e);
      if (!l) edgeToTris.set(e, (l = []));
      l.push(t);
    }
  }
  const cosThr = Math.cos((Math.max(0, maxAngleDeg) * Math.PI) / 180);
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const t = queue.shift();
    for (const e of triEdges[t]) {
      for (const nt of edgeToTris.get(e) || []) {
        if (visited.has(nt)) continue;
        if (nrm[t].dot(nrm[nt]) > cosThr) {
          visited.add(nt);
          queue.push(nt);
        }
      }
    }
  }
  return visited.size === triCount;
}

// The face of the set whose centroid is nearest the set's overall centroid —
// the "centre-most face" whose plane drives centre-face projection.
export function centerFaceOfSet(normals, centroids) {
  if (!centroids.length) return null;
  let mx = 0,
    my = 0,
    mz = 0;
  for (const c of centroids) {
    mx += c[0];
    my += c[1];
    mz += c[2];
  }
  mx /= centroids.length;
  my /= centroids.length;
  mz /= centroids.length;
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const c = centroids[i];
    const d = (c[0] - mx) ** 2 + (c[1] - my) ** 2 + (c[2] - mz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const n = normals[best],
    c = centroids[best];
  return { nx: n[0], ny: n[1], nz: n[2], cx: c[0], cy: c[1], cz: c[2] };
}

// Symmetric 3x3 eigendecomposition (Jacobi).  Returns ascending eigenvalues and
// matching unit eigenvectors.
function eigenSym3(M) {
  const a = M.map((r) => r.slice());
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    let p = 0,
      q = 1,
      max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) {
      max = Math.abs(a[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(a[1][2]) > max) {
      max = Math.abs(a[1][2]);
      p = 1;
      q = 2;
    }
    if (max < 1e-12) break;
    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(tau * tau + 1));
    const c = 1 / Math.sqrt(t * t + 1),
      s = t * c;
    for (let r = 0; r < 3; r++) {
      const arp = a[r][p],
        arq = a[r][q];
      a[r][p] = c * arp - s * arq;
      a[r][q] = s * arp + c * arq;
    }
    for (let r = 0; r < 3; r++) {
      const apr = a[p][r],
        aqr = a[q][r];
      a[p][r] = c * apr - s * aqr;
      a[q][r] = s * apr + c * aqr;
    }
    for (let r = 0; r < 3; r++) {
      const vrp = V[r][p],
        vrq = V[r][q];
      V[r][p] = c * vrp - s * vrq;
      V[r][q] = s * vrp + c * vrq;
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return idx.map((i) => ({
    value: a[i][i],
    vec: [V[0][i], V[1][i], V[2][i]],
  }));
}

// Fit a cylinder to the face set: axis ⟂ the normals (smallest eigenvector of
// Σ nnᵀ), radius+centre from the centroids projected onto the ⟂ plane.  Returns
// null when the normals barely vary (a flat set → not a cylinder).
export function fitCylinderToFaceSet(normals, centroids) {
  if (normals.length < 3) return null;
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const n of normals) {
    for (let r = 0; r < 3; r++)
      for (let cc = 0; cc < 3; cc++) M[r][cc] += n[r] * n[cc];
  }
  const eig = eigenSym3(M); // ascending
  // A cylinder's normals span a plane: smallest eigenvalue ≈ 0 (the axis), the
  // other two sizeable.  A flat set has TWO tiny eigenvalues → reject; a sphere
  // has THREE sizeable ones (no axis), so reject it here too and let the sphere
  // fit claim it.
  if (eig[1].value < 0.05 * eig[2].value) return null;
  if (eig[0].value > 0.12 * eig[2].value) return null;
  const A = new THREE.Vector3(...eig[0].vec).normalize();

  // Basis in the plane ⟂ A.
  const tmp =
    Math.abs(A.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(A, tmp).normalize();
  const e2 = new THREE.Vector3().crossVectors(A, e1).normalize();

  // Project centroids to (u,v) and fit a circle (Kåsa: linear least squares).
  let mu = 0,
    mv = 0;
  const uv = centroids.map((c) => {
    const cv = new THREE.Vector3(c[0], c[1], c[2]);
    return { u: cv.dot(e1), v: cv.dot(e2) };
  });
  for (const p of uv) {
    mu += p.u;
    mv += p.v;
  }
  mu /= uv.length;
  mv /= uv.length;
  let Suu = 0,
    Svv = 0,
    Suv = 0,
    Suuu = 0,
    Svvv = 0,
    Suvv = 0,
    Svuu = 0;
  for (const p of uv) {
    const u = p.u - mu,
      vv = p.v - mv;
    Suu += u * u;
    Svv += vv * vv;
    Suv += u * vv;
    Suuu += u * u * u;
    Svvv += vv * vv * vv;
    Suvv += u * vv * vv;
    Svuu += vv * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-12) return null;
  const bu = 0.5 * (Suuu + Suvv);
  const bv = 0.5 * (Svvv + Svuu);
  const uc = (bu * Svv - bv * Suv) / det;
  const vc = (bv * Suu - bu * Suv) / det;
  const radius = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / uv.length);
  const cu = uc + mu,
    cv2 = vc + mv;
  const center = e1
    .clone()
    .multiplyScalar(cu)
    .add(e2.clone().multiplyScalar(cv2));
  return {
    ax: A.x,
    ay: A.y,
    az: A.z,
    cx: center.x,
    cy: center.y,
    cz: center.z,
    radius,
  };
}

// Extract the developable (extruded-curve) profile of a face set: the body is a
// curve extruded along an axis, so its wall is a straight ruling along that axis
// over an arbitrary cross-section curve.  A single fitted cylinder can't follow a
// non-circular curve (e.g. two joined beziers), so the conform wrap unrolls THIS
// instead.  Returns { axis, e1, e2, curve:[{u,v}], arc:[s], norms:[{u,v}] } in an
// orthonormal frame through the origin (world = u·e1 + v·e2 + along·axis), or null
// when the set isn't a clean single-curve developable.
export function extractDevelopableProfile(positions, normals) {
  if (positions.length < 18 || normals.length < 2) return null;
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const n of normals)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) M[r][c] += n[r] * n[c];
  const eig = eigenSym3(M);
  // Developable like a cylinder: one tiny eigenvalue (the axis the normals avoid),
  // two sizeable.  Reject flat (two tiny) and spherical (none tiny).
  if (eig[1].value < 0.05 * eig[2].value) return null;
  if (eig[0].value > 0.12 * eig[2].value) return null;
  const A = new THREE.Vector3(...eig[0].vec).normalize();
  const tmp =
    Math.abs(A.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(A, tmp).normalize();
  const e2 = new THREE.Vector3().crossVectors(A, e1).normalize();

  // Collapse the wall's axial rulings into cross-section columns: vertices that
  // project to the same (u,v) are the same curve point at different heights.
  const round = (x) => Math.round(x * 1000) / 1000;
  const colKey = new Map();
  const cols = [];
  const vertCol = [];
  for (let i = 0; i < positions.length; i += 3) {
    const u =
        positions[i] * e1.x + positions[i + 1] * e1.y + positions[i + 2] * e1.z,
      v =
        positions[i] * e2.x + positions[i + 1] * e2.y + positions[i + 2] * e2.z;
    const k = `${round(u)},${round(v)}`;
    let c = colKey.get(k);
    if (c == null) {
      c = cols.length;
      cols.push({ u, v });
      colKey.set(k, c);
    }
    vertCol.push(c);
  }
  if (cols.length < 2) return null;

  // Adjacency between columns from triangle edges that cross columns (rails).
  const adj = cols.map(() => new Set());
  for (let t = 0; t + 2 < vertCol.length; t += 3) {
    const a = vertCol[t],
      b = vertCol[t + 1],
      c = vertCol[t + 2];
    if (a !== b) {
      adj[a].add(b);
      adj[b].add(a);
    }
    if (b !== c) {
      adj[b].add(c);
      adj[c].add(b);
    }
    if (c !== a) {
      adj[c].add(a);
      adj[a].add(c);
    }
  }
  // A clean single curve has max degree 2; branching → not a simple curve.
  if (cols.some((_, i) => adj[i].size > 2)) return null;
  let start = cols.findIndex((_, i) => adj[i].size === 1); // open-curve endpoint
  if (start < 0) start = 0; // closed
  const order = [start];
  const seen = new Set([start]);
  let cur = start,
    prev = -1;
  for (;;) {
    const next = [...adj[cur]].find((n) => n !== prev && !seen.has(n));
    if (next == null) break;
    order.push(next);
    seen.add(next);
    prev = cur;
    cur = next;
  }
  if (order.length < cols.length * 0.8) return null; // couldn't trace one curve

  const curve = order.map((id) => ({ u: cols[id].u, v: cols[id].v }));
  const arc = [0];
  for (let i = 1; i < curve.length; i++)
    arc.push(
      arc[i - 1] +
        Math.hypot(curve[i].u - curve[i - 1].u, curve[i].v - curve[i - 1].v),
    );
  // Outward normal per curve point = the LOCAL face normals at that column
  // (projected to u,v).  Using the local (not a global average) normal is what
  // makes an S-curve work: the outward direction rotates — even flips relative to
  // the chord — along the curve, and each column's own face normals capture that.
  const colNorm = cols.map(() => ({ u: 0, v: 0 }));
  for (let t = 0; t < normals.length; t++) {
    const nu =
      normals[t][0] * e1.x + normals[t][1] * e1.y + normals[t][2] * e1.z;
    const nv =
      normals[t][0] * e2.x + normals[t][1] * e2.y + normals[t][2] * e2.z;
    for (const vi of [3 * t, 3 * t + 1, 3 * t + 2]) {
      const col = vertCol[vi];
      if (col != null) {
        colNorm[col].u += nu;
        colNorm[col].v += nv;
      }
    }
  }
  const norms = order.map((colId, i) => {
    const cn = colNorm[colId];
    let nu = cn.u,
      nv = cn.v;
    if (Math.hypot(nu, nv) < 1e-9) {
      // No face normal here (shouldn't happen) — fall back to the chord perp.
      const a = curve[Math.max(0, i - 1)],
        b = curve[Math.min(curve.length - 1, i + 1)];
      nu = -(b.v - a.v);
      nv = b.u - a.u;
    }
    const l = Math.hypot(nu, nv) || 1;
    return { u: nu / l, v: nv / l };
  });

  // The wall's axial extent (min/max along A) — its centre is where the relief
  // is centred vertically, so the text sits mid-face instead of at the click
  // height (and stays centred when the wall is resized).
  let aMin = Infinity,
    aMax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const a =
      positions[i] * A.x + positions[i + 1] * A.y + positions[i + 2] * A.z;
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
  }

  return {
    axis: [A.x, A.y, A.z],
    e1: [e1.x, e1.y, e1.z],
    e2: [e2.x, e2.y, e2.z],
    curve,
    arc,
    norms,
    aMin,
    aMax,
  };
}

// Solve a 4x4 linear system (Gaussian elimination with partial pivoting).
function solve4(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++)
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 5; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [0, 1, 2, 3].map((i) => m[i][4] / m[i][i]);
}

// Fit a sphere to the face set's VERTICES (on-surface points) by the standard
// algebraic least-squares fit: |p|² = 2·c·p + (R² − |c|²).  Returns null when the
// normals don't span all three axes (a flat or cylindrical set, not a sphere).
export function fitSphereToFaceSet(normals, positions) {
  if (normals.length < 4 || positions.length < 12) return null;
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const n of normals)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) M[r][c] += n[r] * n[c];
  const eig = eigenSym3(M);
  // A near-zero smallest eigenvalue means an axis the normals avoid → plane or
  // cylinder, not a sphere.
  if (eig[0].value < 0.12 * eig[2].value) return null;

  const A = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const bb = [0, 0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
      bb[r] += row[r] * rhs;
    }
  }
  const sol = solve4(A, bb);
  if (!sol) return null;
  const [cx, cy, cz, d] = sol;
  const r2 = d + cx * cx + cy * cy + cz * cz;
  if (!(r2 > 1e-9) || !Number.isFinite(r2)) return null;
  return { cx, cy, cz, radius: Math.sqrt(r2) };
}
