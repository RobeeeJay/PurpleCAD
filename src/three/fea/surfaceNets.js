// A smooth surface through the optimiser's density field.
//
// SIMP produces a CONTINUOUS density per voxel; the blocky surface came from
// thresholding that to solid-or-void and then wrapping whole cubes, which
// throws away everything the field knew between 0 and 1. The half-density
// isosurface is genuinely defined, so following it is reading the answer more
// carefully rather than inventing detail that was never computed.
//
// Naive surface nets (dual contouring without the QEF): one vertex per cell
// that the surface crosses, placed at the average of the crossings on that
// cell's edges, with a quad joining the four cells around every sign-changing
// edge. Manifold and watertight by construction, and far less code than a
// marching-cubes table.
//
// Pure arrays -- no THREE, no DOM.

// Densities live at voxel CENTRES, so the dual cells span neighbouring
// centres: sample (i,j,k) sits at origin + (i + 0.5) * h.
const EDGES = [
  [0, 1],
  [1, 3],
  [2, 3],
  [0, 2],
  [4, 5],
  [5, 7],
  [6, 7],
  [4, 6],
  [0, 4],
  [1, 5],
  [3, 7],
  [2, 6],
];
// Corner offsets, indexed so bit 0 = +x, bit 1 = +y, bit 2 = +z.
const CORNER = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

export function surfaceNets({
  density,
  grid,
  iso = 0.5,
  mmPerUnit = 10,
  smoothing = 3,
}) {
  const { origin, h, nx, ny, nz } = grid;
  const at = (i, j, k) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz
      ? 0 // outside the design space is void, which closes the surface
      : density[i + nx * (j + ny * k)];

  // One vertex per crossed dual cell, indexed by the cell's low corner.
  const cellVertex = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1);
  const cellIdx = (i, j, k) => i + (nx + 1) * (j + (ny + 1) * k);
  const verts = [];
  const step = h / mmPerUnit;
  const base = origin.map((o) => (o + h / 2) / mmPerUnit);

  for (let k = -1; k < nz; k++)
    for (let j = -1; j < ny; j++)
      for (let i = -1; i < nx; i++) {
        const v = CORNER.map(([a, b, c]) => at(i + a, j + b, k + c));
        let mask = 0;
        for (let c = 0; c < 8; c++) if (v[c] >= iso) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue; // wholly in or wholly out
        // Average the crossings: where along each cut edge the surface sits.
        let sx = 0,
          sy = 0,
          sz = 0,
          n = 0;
        for (const [a, b] of EDGES) {
          const va = v[a],
            vb = v[b];
          if (va >= iso === vb >= iso) continue;
          const t = (iso - va) / (vb - va || 1);
          for (let c = 0; c < 3; c++) {
            const p = CORNER[a][c] + t * (CORNER[b][c] - CORNER[a][c]);
            if (c === 0) sx += p;
            else if (c === 1) sy += p;
            else sz += p;
          }
          n++;
        }
        cellVertex[cellIdx(i + 1, j + 1, k + 1)] = verts.length / 3;
        verts.push(
          base[0] + (i + sx / n) * step,
          base[1] + (j + sy / n) * step,
          base[2] + (k + sz / n) * step,
        );
      }

  // A quad per sign-changing edge, joining the four cells that share it.
  const quads = [];
  const dirs = [
    {
      d: [1, 0, 0],
      around: [
        [0, -1, -1],
        [0, 0, -1],
        [0, 0, 0],
        [0, -1, 0],
      ],
    },
    {
      d: [0, 1, 0],
      around: [
        [-1, 0, -1],
        [-1, 0, 0],
        [0, 0, 0],
        [0, 0, -1],
      ],
    },
    {
      d: [0, 0, 1],
      around: [
        [-1, -1, 0],
        [0, -1, 0],
        [0, 0, 0],
        [-1, 0, 0],
      ],
    },
  ];
  for (let k = -1; k < nz; k++)
    for (let j = -1; j < ny; j++)
      for (let i = -1; i < nx; i++) {
        const here = at(i, j, k) >= iso;
        for (const { d, around } of dirs) {
          const there = at(i + d[0], j + d[1], k + d[2]) >= iso;
          if (here === there) continue;
          const ring = around.map(
            ([a, b, c]) => cellVertex[cellIdx(i + a + 1, j + b + 1, k + c + 1)],
          );
          if (ring.some((r) => r < 0)) continue;
          // Wind so the face points from solid toward void.
          quads.push(here ? ring : [ring[0], ring[3], ring[2], ring[1]]);
        }
      }

  // Taubin smoothing: a shrinking pass followed by an expanding one, so the
  // staircase relaxes without the whole body pulling in on itself the way
  // repeated Laplacian passes make it.
  const positions = Float64Array.from(verts);
  if (smoothing > 0) {
    const neighbours = new Map();
    const link = (a, b) => {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a).add(b);
    };
    for (const q of quads)
      for (let e = 0; e < 4; e++) {
        link(q[e], q[(e + 1) % 4]);
        link(q[(e + 1) % 4], q[e]);
      }
    const pass = (weight) => {
      const next = Float64Array.from(positions);
      for (const [v, ns] of neighbours) {
        let cx = 0,
          cy = 0,
          cz = 0;
        for (const m of ns) {
          cx += positions[m * 3];
          cy += positions[m * 3 + 1];
          cz += positions[m * 3 + 2];
        }
        const k = ns.size || 1;
        next[v * 3] += weight * (cx / k - positions[v * 3]);
        next[v * 3 + 1] += weight * (cy / k - positions[v * 3 + 1]);
        next[v * 3 + 2] += weight * (cz / k - positions[v * 3 + 2]);
      }
      positions.set(next);
    };
    for (let s = 0; s < smoothing; s++) {
      pass(0.5);
      pass(-0.53);
    }
  }

  const indices = [];
  for (const q of quads) indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}
