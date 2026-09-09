// The kept voxels of an optimisation, as a surface.
//
// SIMP hands back a density per voxel; what a user needs is a body. Every
// voxel is a cube, so the surface is exactly the faces that have solid on one
// side and nothing on the other -- no marching-cubes table, no interpolation
// invented between samples, and watertight by construction, which is what the
// mesh-to-solid path needs.
//
// `voxelSurface` wraps whole cubes and is therefore blocky at the voxel scale.
// It is NOT what ships any more -- surfaceNets.js follows the continuous
// density instead, which is smooth and just as faithful to what was computed
// (see its header). This stays as the baseline the smoothness test measures
// against: a cube wrapper emits nothing but axis-aligned faces, which is
// exactly the property an isosurface has to beat.
//
// Pure arrays -- no THREE, no DOM.

// Outward face definitions: the four corner offsets of the +X, -X, +Y, -Y, +Z
// and -Z faces of a unit cube, wound counter-clockwise seen from outside.
const FACES = [
  {
    d: [1, 0, 0],
    c: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    d: [-1, 0, 0],
    c: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    d: [0, 1, 0],
    c: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    d: [0, -1, 0],
    c: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    d: [0, 0, 1],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    d: [0, 0, -1],
    c: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
];

// Which voxels survive: density at or above the threshold, and reachable from
// a voxel that is held.  An optimiser can leave a stiff-looking island that
// touches nothing -- it would print as a loose lump, so it is dropped.
export function keptVoxels({ density, grid, threshold = 0.5, seeds = null }) {
  const { nx, ny, nz } = grid;
  const solid = new Uint8Array(density.length);
  for (let e = 0; e < density.length; e++)
    solid[e] = density[e] >= threshold ? 1 : 0;
  if (!seeds || !seeds.length) return solid;

  const kept = new Uint8Array(density.length);
  const stack = seeds.filter((e) => solid[e]);
  for (const e of stack) kept[e] = 1;
  while (stack.length) {
    const e = stack.pop();
    const i = e % nx,
      j = Math.floor(e / nx) % ny,
      k = Math.floor(e / (nx * ny));
    for (const { d } of FACES) {
      const a = i + d[0],
        b = j + d[1],
        c = k + d[2];
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const m = a + nx * (b + ny * c);
      if (solid[m] && !kept[m]) {
        kept[m] = 1;
        stack.push(m);
      }
    }
  }
  return kept;
}

// The boundary surface of a set of voxels, in SCENE units.
export function voxelSurface({ solid, grid, mmPerUnit = 10 }) {
  const { origin, h, nx, ny, nz } = grid;
  const positions = [];
  const at = (i, j, k, c) =>
    (origin[c] + (c === 0 ? i : c === 1 ? j : k) * h) / mmPerUnit;
  const step = h / mmPerUnit;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!solid[i + nx * (j + ny * k)]) continue;
        for (const { d, c } of FACES) {
          const a = i + d[0],
            b = j + d[1],
            e = k + d[2];
          const inside =
            a >= 0 &&
            b >= 0 &&
            e >= 0 &&
            a < nx &&
            b < ny &&
            e < nz &&
            solid[a + nx * (b + ny * e)];
          if (inside) continue; // an interior face: no surface there
          // The voxel's own corner, then the face's four corners as offsets.
          const x0 = at(i, j, k, 0),
            y0 = at(i, j, k, 1),
            z0 = at(i, j, k, 2);
          const p = c.map(([dx, dy, dz]) => [
            x0 + dx * step,
            y0 + dy * step,
            z0 + dz * step,
          ]);
          positions.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
        }
      }
  return new Float32Array(positions);
}

export const solidCount = (solid) => {
  let n = 0;
  for (let i = 0; i < solid.length; i++) n += solid[i];
  return n;
};
