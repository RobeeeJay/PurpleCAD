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
  // other two sizeable.  A flat set has TWO tiny eigenvalues → reject.
  if (eig[1].value < 0.05 * eig[2].value) return null;
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
