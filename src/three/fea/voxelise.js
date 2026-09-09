// Surface mesh -> occupancy grid.
//
// FEA needs a VOLUMETRIC discretisation and OCC only ever hands us a surface
// triangle mesh (geometryData = {positions, normals, indices}), so this is the
// bridge.  A regular grid is deliberate rather than a compromise: every voxel
// is then the same 8-node hex, so the element stiffness matrix is built once
// and reused for the whole model (see hexSolver.js), which is what makes the
// solve tractable in JS at all.
//
// Pure arrays -- no THREE, no DOM -- so it runs in vitest and in a worker.

// Ray-parity fill: for each grid column along X, collect every triangle
// crossing, sort them, and fill between pairs.  Valid because an OCC solid's
// tessellation is watertight.
//
// The sampling ray is nudged off the exact voxel centre by an irrational
// fraction of a voxel: a mesh whose faces line up with the grid (a box, and
// every part built from one) otherwise sends rays exactly along shared edges,
// where a crossing is counted twice or not at all and the whole column fills
// or empties wrongly.
const JITTER_Y = 0.0013;
const JITTER_Z = 0.0007;

// { origin: [x,y,z], h, nx, ny, nz } covering a mesh's bbox with `pad` voxels
// of clearance, sized so the longest side gets `target` voxels.
export function gridFor(positions, target = 48, pad = 1) {
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const h = Math.max(...span) / target;
  const n = span.map((s) => Math.max(1, Math.ceil(s / h) + 2 * pad));
  return {
    origin: [
      lo[0] - pad * h - h / 2,
      lo[1] - pad * h - h / 2,
      lo[2] - pad * h - h / 2,
    ],
    h,
    nx: n[0],
    ny: n[1],
    nz: n[2],
  };
}

// Occupancy as a Uint8Array of nx*ny*nz, 1 where the voxel centre is inside.
export function voxelise(positions, indices, grid) {
  const { origin, h, nx, ny, nz } = grid;
  const occ = new Uint8Array(nx * ny * nz);
  const tris = indices ? indices.length / 3 : positions.length / 9;
  const vert = (t, c) => {
    const v = indices ? indices[t * 3 + c] * 3 : (t * 3 + c) * 3;
    return [positions[v], positions[v + 1], positions[v + 2]];
  };
  // One crossing list per (j,k) column, built in a single pass over triangles.
  const columns = new Map();
  const push = (j, k, x) => {
    const key = j * nz + k;
    let list = columns.get(key);
    if (!list) columns.set(key, (list = []));
    list.push(x);
  };
  for (let t = 0; t < tris; t++) {
    const a = vert(t, 0),
      b = vert(t, 1),
      c = vert(t, 2);
    const yLo = Math.min(a[1], b[1], c[1]),
      yHi = Math.max(a[1], b[1], c[1]),
      zLo = Math.min(a[2], b[2], c[2]),
      zHi = Math.max(a[2], b[2], c[2]);
    const j0 = Math.max(0, Math.ceil((yLo - origin[1]) / h - 0.5 - JITTER_Y));
    const j1 = Math.min(
      ny - 1,
      Math.floor((yHi - origin[1]) / h - 0.5 - JITTER_Y),
    );
    const k0 = Math.max(0, Math.ceil((zLo - origin[2]) / h - 0.5 - JITTER_Z));
    const k1 = Math.min(
      nz - 1,
      Math.floor((zHi - origin[2]) / h - 0.5 - JITTER_Z),
    );
    if (j1 < j0 || k1 < k0) continue;
    // Barycentric test in the YZ plane; the crossing's X comes from the same
    // weights, so a triangle seen edge-on (zero area in YZ) contributes
    // nothing -- correct, since a ray along X cannot cross it transversally.
    const den = (b[2] - c[2]) * (a[1] - c[1]) + (c[1] - b[1]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-20) continue;
    for (let j = j0; j <= j1; j++) {
      const py = origin[1] + (j + 0.5 + JITTER_Y) * h;
      for (let k = k0; k <= k1; k++) {
        const pz = origin[2] + (k + 0.5 + JITTER_Z) * h;
        const w0 =
          ((b[2] - c[2]) * (py - c[1]) + (c[1] - b[1]) * (pz - c[2])) / den;
        const w1 =
          ((c[2] - a[2]) * (py - c[1]) + (a[1] - c[1]) * (pz - c[2])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        push(j, k, w0 * a[0] + w1 * b[0] + w2 * c[0]);
      }
    }
  }
  for (const [key, list] of columns) {
    if (list.length < 2) continue;
    list.sort((p, q) => p - q);
    const j = Math.floor(key / nz),
      k = key % nz;
    for (let s = 0; s + 1 < list.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((list[s] - origin[0]) / h - 0.5));
      const i1 = Math.min(
        nx - 1,
        Math.floor((list[s + 1] - origin[0]) / h - 0.5),
      );
      for (let i = i0; i <= i1; i++) occ[i + nx * (j + ny * k)] = 1;
    }
  }
  return occ;
}

export const voxelVolume = (occ, grid) => {
  let n = 0;
  for (let i = 0; i < occ.length; i++) n += occ[i];
  return n * grid.h ** 3;
};
