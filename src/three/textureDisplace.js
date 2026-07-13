// 3D bump-map displacement for the Texture tool: weld → refine the selected
// region to a target edge length (crack-free) → displace region vertices along
// their surface normals by a sampled heightfield.  Pure arrays in/out — no
// THREE, no DOM — so it runs identically in the renderer and under vitest
// (heightfields are injected; PNG decoding lives in textureImage.js).

// ── Welding ──────────────────────────────────────────────────────────────────

const keyOf = (x, y, z) => {
  const r = (v) => Math.round(v * 1e5) / 1e5;
  return `${r(x)},${r(y)},${r(z)}`;
};

// OCC tessellations and baked meshes duplicate vertices per face; displacement
// needs shared topology so a moved vertex moves every triangle that uses it.
export function weldMesh(positions, indices) {
  const map = new Map();
  const verts = [];
  const remap = (x, y, z) => {
    const k = keyOf(x, y, z);
    let i = map.get(k);
    if (i === undefined) {
      i = verts.length / 3;
      map.set(k, i);
      verts.push(x, y, z);
    }
    return i;
  };
  const tris = [];
  const idx = indices && indices.length ? indices : null;
  const triCount = idx ? idx.length / 3 : positions.length / 9;
  for (let t = 0; t < triCount; t++) {
    const tri = [];
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx[t * 3 + k] : t * 3 + k;
      tri.push(
        remap(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]),
      );
    }
    // Drop triangles degenerate after welding.
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2])
      tris.push(tri[0], tri[1], tri[2]);
  }
  return { verts, tris };
}

// ── Region membership ────────────────────────────────────────────────────────

// Distance from point to triangle (squared), standard region test against the
// pick-time faceTris soup.
function pointTriDist2(px, py, pz, p, i) {
  const ax = p[i],
    ay = p[i + 1],
    az = p[i + 2];
  const bx = p[i + 3],
    by = p[i + 4],
    bz = p[i + 5];
  const cx = p[i + 6],
    cy = p[i + 7],
    cz = p[i + 8];
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const acx = cx - ax,
    acy = cy - ay,
    acz = cz - az;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // Project onto the plane, clamp barycentric — good enough for a membership
  // tolerance test (exact edge-region Voronoi cases don't matter here).
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const nn = nx * nx + ny * ny + nz * nz || 1;
  const dist = (apx * nx + apy * ny + apz * nz) / Math.sqrt(nn);
  const qx = px - dist * (nx / Math.sqrt(nn));
  const qy = py - dist * (ny / Math.sqrt(nn));
  const qz = pz - dist * (nz / Math.sqrt(nn));
  // Barycentric of q.
  const d00 = abx * abx + aby * aby + abz * abz;
  const d01 = abx * acx + aby * acy + abz * acz;
  const d11 = acx * acx + acy * acy + acz * acz;
  const aqx = qx - ax,
    aqy = qy - ay,
    aqz = qz - az;
  const d20 = aqx * abx + aqy * aby + aqz * abz;
  const d21 = aqx * acx + aqy * acy + aqz * acz;
  const den = d00 * d11 - d01 * d01 || 1;
  let v = (d11 * d20 - d01 * d21) / den;
  let w = (d00 * d21 - d01 * d20) / den;
  v = clamp01(v);
  w = clamp01(w);
  if (v + w > 1) {
    const s = v + w;
    v /= s;
    w /= s;
  }
  const rx = ax + v * abx + w * acx - px;
  const ry = ay + v * aby + w * acy - py;
  const rz = az + v * abz + w * acz - pz;
  return rx * rx + ry * ry + rz * rz;
}

// Membership closure: a point is "in region" when it lies within `tol` of any
// pick-time region triangle.  faceTris is the flat 9-per-tri soup the picker
// stored (same as emboss).
export function regionTest(faceTris, tol = 0.02) {
  const tol2 = tol * tol;
  const n = faceTris.length;
  return (x, y, z) => {
    for (let i = 0; i + 8 < n; i += 9)
      if (pointTriDist2(x, y, z, faceTris, i) <= tol2) return true;
    return false;
  };
}

// ── Refinement ───────────────────────────────────────────────────────────────

// Crack-free midpoint refinement: an EDGE splits when it is longer than
// targetLen and touches a region triangle; every triangle is then
// re-triangulated by its own split-edge pattern (1, 2 or 3 split edges), and
// midpoints are shared through an edge-keyed cache — a neighbour outside the
// region still consumes the midpoint on its shared edge, so no T-junctions.
export function refineMesh(
  verts,
  tris,
  inRegionTri,
  targetLen,
  maxPasses = 12,
) {
  // inRegionTri(t, tris, verts) — the CURRENT arrays are passed because they
  // are rebuilt every pass; a closure over the caller's originals goes stale.
  const t2 = targetLen * targetLen;
  for (let pass = 0; pass < maxPasses; pass++) {
    const edgeSplit = new Map(); // "a_b" (a<b) -> midpoint index (lazy)
    const wantSplit = new Set();
    const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const len2 = (a, b) => {
      const dx = verts[a * 3] - verts[b * 3];
      const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
      const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    // Pass 1: mark long edges of region triangles.
    for (let t = 0; t < tris.length; t += 3) {
      if (!inRegionTri(t, tris, verts)) continue;
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      if (len2(a, b) > t2) wantSplit.add(ekey(a, b));
      if (len2(b, c) > t2) wantSplit.add(ekey(b, c));
      if (len2(c, a) > t2) wantSplit.add(ekey(c, a));
    }
    if (wantSplit.size === 0) return { verts, tris };
    const midpoint = (a, b) => {
      const k = ekey(a, b);
      let m = edgeSplit.get(k);
      if (m === undefined) {
        m = verts.length / 3;
        verts.push(
          (verts[a * 3] + verts[b * 3]) / 2,
          (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2,
          (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2,
        );
        edgeSplit.set(k, m);
      }
      return m;
    };
    // Pass 2: rebuild every triangle by its split pattern.
    const out = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t],
        b = tris[t + 1],
        c = tris[t + 2];
      const sab = wantSplit.has(ekey(a, b)) ? midpoint(a, b) : -1;
      const sbc = wantSplit.has(ekey(b, c)) ? midpoint(b, c) : -1;
      const sca = wantSplit.has(ekey(c, a)) ? midpoint(c, a) : -1;
      const n = (sab >= 0) + (sbc >= 0) + (sca >= 0);
      if (n === 0) out.push(a, b, c);
      else if (n === 3)
        out.push(a, sab, sca, sab, b, sbc, sca, sbc, c, sab, sbc, sca);
      else if (n === 1) {
        if (sab >= 0) out.push(a, sab, c, sab, b, c);
        else if (sbc >= 0) out.push(b, sbc, a, sbc, c, a);
        else out.push(c, sca, b, sca, a, b);
      } else {
        // Two split edges: rotate so the unsplit edge is (a,b).
        let A = a,
          B = b,
          C = c,
          m1,
          m2;
        if (sab < 0) {
          m1 = sbc;
          m2 = sca; // splits on (b,c) and (c,a)
        } else if (sbc < 0) {
          A = b;
          B = c;
          C = a;
          m1 = sca;
          m2 = sab;
        } else {
          A = c;
          B = a;
          C = b;
          m1 = sab;
          m2 = sbc;
        }
        // C's corner + quad split along the shorter diagonal for quality.
        out.push(m2, m1, C);
        if (len2(A, m1) < len2(B, m2)) out.push(A, B, m1, A, m1, m2);
        else out.push(A, B, m2, B, m1, m2);
      }
    }
    tris = out;
  }
  return { verts, tris };
}

// ── UV mapping + displacement ────────────────────────────────────────────────

const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

// Build the (u,v) parameterisation in scene units, centred on the picked
// face's anchor point, for the four surface classes.  Returns
// { uv(x,y,z) -> [u,v], normal(x,y,z) -> [nx,ny,nz] } or null.
export function buildMapping(face, faceSet, projection) {
  const anchor = [face.cx, face.cy, face.cz];
  if (projection !== "conform" || !faceSet) {
    // Flat/centre projection: an in-plane basis around the anchor.
    const n = norm3(face.nx, face.ny, face.nz);
    const tmp = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = norm3(
      n[1] * tmp[2] - n[2] * tmp[1],
      n[2] * tmp[0] - n[0] * tmp[2],
      n[0] * tmp[1] - n[1] * tmp[0],
    );
    const t2 = [
      n[1] * t1[2] - n[2] * t1[1],
      n[2] * t1[0] - n[0] * t1[2],
      n[0] * t1[1] - n[1] * t1[0],
    ];
    return {
      uv: (x, y, z) => {
        const dx = x - anchor[0],
          dy = y - anchor[1],
          dz = z - anchor[2];
        return [
          dx * t1[0] + dy * t1[1] + dz * t1[2],
          dx * t2[0] + dy * t2[1] + dz * t2[2],
        ];
      },
      normal: null, // use the per-vertex mesh normal
    };
  }
  if (faceSet.cylinder) {
    const { ax, ay, az, cx, cy, cz, radius } = faceSet.cylinder;
    const A = norm3(ax, ay, az);
    const tmp = Math.abs(A[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = norm3(
      A[1] * tmp[2] - A[2] * tmp[1],
      A[2] * tmp[0] - A[0] * tmp[2],
      A[0] * tmp[1] - A[1] * tmp[0],
    );
    const e2 = [
      A[1] * e1[2] - A[2] * e1[1],
      A[2] * e1[0] - A[0] * e1[2],
      A[0] * e1[1] - A[1] * e1[0],
    ];
    const theta = (x, y, z) => {
      const dx = x - cx,
        dy = y - cy,
        dz = z - cz;
      return Math.atan2(
        dx * e2[0] + dy * e2[1] + dz * e2[2],
        dx * e1[0] + dy * e1[1] + dz * e1[2],
      );
    };
    const theta0 = theta(...anchor);
    const v0 =
      (anchor[0] - cx) * A[0] +
      (anchor[1] - cy) * A[1] +
      (anchor[2] - cz) * A[2];
    return {
      uv: (x, y, z) => {
        let dth = theta(x, y, z) - theta0;
        while (dth > Math.PI) dth -= 2 * Math.PI;
        while (dth < -Math.PI) dth += 2 * Math.PI;
        const dv = (x - cx) * A[0] + (y - cy) * A[1] + (z - cz) * A[2] - v0;
        return [dth * radius, dv];
      },
      normal: (x, y, z) => {
        const dv = (x - cx) * A[0] + (y - cy) * A[1] + (z - cz) * A[2];
        return norm3(
          x - cx - dv * A[0],
          y - cy - dv * A[1],
          z - cz - dv * A[2],
        );
      },
      circumference: 2 * Math.PI * radius,
    };
  }
  if (faceSet.sphere) {
    const { cx, cy, cz, radius } = faceSet.sphere;
    const nA = norm3(anchor[0] - cx, anchor[1] - cy, anchor[2] - cz);
    const tmp = Math.abs(nA[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = norm3(
      nA[1] * tmp[2] - nA[2] * tmp[1],
      nA[2] * tmp[0] - nA[0] * tmp[2],
      nA[0] * tmp[1] - nA[1] * tmp[0],
    );
    const t2 = [
      nA[1] * t1[2] - nA[2] * t1[1],
      nA[2] * t1[0] - nA[0] * t1[2],
      nA[0] * t1[1] - nA[1] * t1[0],
    ];
    return {
      uv: (x, y, z) => {
        const d = norm3(x - cx, y - cy, z - cz);
        // Azimuth/elevation arc lengths around the anchor direction.
        const du = d[0] * t1[0] + d[1] * t1[1] + d[2] * t1[2];
        const dv = d[0] * t2[0] + d[1] * t2[1] + d[2] * t2[2];
        const dn = d[0] * nA[0] + d[1] * nA[1] + d[2] * nA[2];
        return [Math.atan2(du, dn) * radius, Math.atan2(dv, dn) * radius];
      },
      normal: (x, y, z) => norm3(x - cx, y - cy, z - cz),
    };
  }
  if (faceSet.developable) {
    const { axis, e1, e2, curve, arc, norms } = faceSet.developable;
    const A = [axis.x ?? axis[0], axis.y ?? axis[1], axis.z ?? axis[2]];
    const E1 = [e1.x ?? e1[0], e1.y ?? e1[1], e1.z ?? e1[2]];
    const E2 = [e2.x ?? e2[0], e2.y ?? e2[1], e2.z ?? e2[2]];
    const total = arc[arc.length - 1];
    // Closed loop when the curve ends where it starts (same rule as the
    // emboss conform wrap — see the seam-wrap landmine).
    const gx = curve[0].u - curve[curve.length - 1].u;
    const gy = curve[0].v - curve[curve.length - 1].v;
    const closed = Math.hypot(gx, gy) < 1e-3 * Math.max(1, total);
    const nearest = (u, v) => {
      let best = 0,
        bestD = Infinity;
      for (let i = 0; i < curve.length; i++) {
        const du = curve[i].u - u,
          dv = curve[i].v - v;
        const d = du * du + dv * dv;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const anchorU = anchor[0] * E1[0] + anchor[1] * E1[1] + anchor[2] * E1[2];
    const anchorV = anchor[0] * E2[0] + anchor[1] * E2[1] + anchor[2] * E2[2];
    const s0 = arc[nearest(anchorU, anchorV)];
    const w0 = anchor[0] * A[0] + anchor[1] * A[1] + anchor[2] * A[2];
    return {
      uv: (x, y, z) => {
        const u = x * E1[0] + y * E1[1] + z * E1[2];
        const v = x * E2[0] + y * E2[1] + z * E2[2];
        let ds = arc[nearest(u, v)] - s0;
        if (closed) {
          // Wrap the arc-length delta modulo the loop, not clamp.
          while (ds > total / 2) ds -= total;
          while (ds < -total / 2) ds += total;
        }
        const w = x * A[0] + y * A[1] + z * A[2] - w0;
        return [ds, w];
      },
      normal: (x, y, z) => {
        const u = x * E1[0] + y * E1[1] + z * E1[2];
        const v = x * E2[0] + y * E2[1] + z * E2[2];
        const n2 = norms[nearest(u, v)];
        return norm3(
          n2.u * E1[0] + n2.v * E2[0],
          n2.u * E1[1] + n2.v * E2[1],
          n2.u * E1[2] + n2.v * E2[2],
        );
      },
      circumference: closed ? total : null,
    };
  }
  return null;
}

// Bilinear heightfield sample; u/v in [0,1] texture space.  wrap tiles,
// clamp returns null outside (no displacement).
export function sampleHeight(hf, u, v, wrap) {
  if (wrap) {
    u = ((u % 1) + 1) % 1;
    v = ((v % 1) + 1) % 1;
  } else if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const fx = u * (hf.width - 1);
  const fy = (1 - v) * (hf.height - 1); // image rows top-down, v up
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, hf.width - 1);
  const y1 = Math.min(y0 + 1, hf.height - 1);
  const tx = fx - x0,
    ty = fy - y0;
  const at = (x, y) => hf.data[y * hf.width + x];
  return (
    at(x0, y0) * (1 - tx) * (1 - ty) +
    at(x1, y0) * tx * (1 - ty) +
    at(x0, y1) * (1 - tx) * ty +
    at(x1, y1) * tx * ty
  );
}

// Area-weighted vertex normals for the welded mesh.
function vertexNormals(verts, tris) {
  const n = new Float64Array(verts.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3,
      b = tris[t + 1] * 3,
      c = tris[t + 2] * 3;
    const ux = verts[b] - verts[a],
      uy = verts[b + 1] - verts[a + 1],
      uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a],
      vy = verts[c + 1] - verts[a + 1],
      vz = verts[c + 2] - verts[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += nx;
      n[i + 1] += ny;
      n[i + 2] += nz;
    }
  }
  return n;
}

// The whole pipeline.  mesh = { positions, indices } in the SOURCE's local
// frame; faceTris = pick-time region soup (same frame); params in scene units
// (callers convert mm): { sizeU, depth, offsetU, offsetV, rotationRad, wrap,
// resolution, projection }.  Returns { positions, indices, normals }.
export function displaceMesh({
  mesh,
  face,
  faceSet,
  faceTris,
  heightfield,
  params,
}) {
  const mapping = buildMapping(face, faceSet, params.projection);
  if (!mapping || !heightfield || !faceTris?.length) return null;
  const { verts: v0, tris: t0 } = weldMesh(mesh.positions, mesh.indices);
  const inRegion = regionTest(
    faceTris,
    Math.max(0.02, params.resolution * 0.5),
  );

  const verts = v0.slice();
  let tris = t0.slice();
  const triInRegion = (t, T, V) => {
    const cx = (V[T[t] * 3] + V[T[t + 1] * 3] + V[T[t + 2] * 3]) / 3;
    const cy =
      (V[T[t] * 3 + 1] + V[T[t + 1] * 3 + 1] + V[T[t + 2] * 3 + 1]) / 3;
    const cz =
      (V[T[t] * 3 + 2] + V[T[t + 1] * 3 + 2] + V[T[t + 2] * 3 + 2]) / 3;
    return inRegion(cx, cy, cz);
  };
  const refined = refineMesh(verts, tris, triInRegion, params.resolution);
  tris = refined.tris;

  // Vertex classification: displace verts whose EVERY adjacent triangle is in
  // the region (interior); boundary verts stay put so the seam is watertight.
  const nVerts = verts.length / 3;
  const inCount = new Uint32Array(nVerts);
  const adjCount = new Uint32Array(nVerts);
  for (let t = 0; t < tris.length; t += 3) {
    const inside = triInRegion(t, tris, verts);
    for (let k = 0; k < 3; k++) {
      adjCount[tris[t + k]]++;
      if (inside) inCount[tris[t + k]]++;
    }
  }
  const meshNormals = vertexNormals(verts, tris);

  const sizeU = params.sizeU;
  const sizeV = (sizeU * heightfield.height) / heightfield.width;
  const cosR = Math.cos(params.rotationRad || 0);
  const sinR = Math.sin(params.rotationRad || 0);
  for (let i = 0; i < nVerts; i++) {
    if (inCount[i] === 0 || inCount[i] < adjCount[i]) continue; // outside or boundary
    const x = verts[i * 3],
      y = verts[i * 3 + 1],
      z = verts[i * 3 + 2];
    let [u, v] = mapping.uv(x, y, z);
    // Rotate about the anchor, then offset, then normalise to texture space
    // (texture centred on the anchor).
    const ru = u * cosR - v * sinR;
    const rv = u * sinR + v * cosR;
    u = (ru + (params.offsetU || 0)) / sizeU + 0.5;
    v = (rv + (params.offsetV || 0)) / sizeV + 0.5;
    const h = sampleHeight(heightfield, u, v, !!params.wrap);
    if (h == null || h === 0) continue;
    const n = mapping.normal
      ? mapping.normal(x, y, z)
      : norm3(
          meshNormals[i * 3],
          meshNormals[i * 3 + 1],
          meshNormals[i * 3 + 2],
        );
    const d = h * params.depth;
    verts[i * 3] += n[0] * d;
    verts[i * 3 + 1] += n[1] * d;
    verts[i * 3 + 2] += n[2] * d;
  }

  const outNormals = vertexNormals(verts, tris);
  const normals = new Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    const [nx, ny, nz] = norm3(
      outNormals[i],
      outNormals[i + 1],
      outNormals[i + 2],
    );
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
  return { positions: verts, indices: Array.from(tris), normals };
}
