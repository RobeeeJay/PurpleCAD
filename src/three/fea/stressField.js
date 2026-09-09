// Surface mesh + picked faces -> a von Mises stress per surface vertex.
//
// Ties voxelise.js and hexSolver.js to what the app actually has: an item's
// baked geometryData in SCENE units, and face picks expressed as triangle
// indices (the same currency the emboss face-set tools already deal in).
//
// Everything inside is mm / N / MPa.  Scene units are mm / MM_PER_UNIT, and
// the conversion happens here so neither the solver nor the caller has to
// think about it.
//
// Pure arrays -- no THREE, no DOM -- so it runs in vitest and in a worker.

import { gridFor, voxelise } from "./voxelise.js";
import { solveDisplacements, vonMises } from "./hexSolver.js";

// The 8 grid nodes around a point, with their trilinear weights.  Used for
// both load transfer and fixing, so a load spread over a flat face comes out
// weighted 1:2:4 across corner / edge / interior nodes without anyone having
// to say so.
function surroundingNodes(p, grid) {
  const { origin, h, nx, ny, nz } = grid;
  const g = [0, 1, 2].map((c) => (p[c] - origin[c]) / h - 0.5);
  const i0 = Math.floor(g[0]),
    j0 = Math.floor(g[1]),
    k0 = Math.floor(g[2]);
  const f = [g[0] - i0, g[1] - j0, g[2] - k0];
  const out = [];
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) {
        const i = i0 + a,
          j = j0 + b,
          k = k0 + c;
        if (i < 0 || j < 0 || k < 0 || i > nx || j > ny || k > nz) continue;
        const w =
          (a ? f[0] : 1 - f[0]) * (b ? f[1] : 1 - f[1]) * (c ? f[2] : 1 - f[2]);
        if (w > 0) out.push([i + (nx + 1) * (j + (ny + 1) * k), w]);
      }
  return out;
}

const triangleOf = (positions, indices, t, scale) => {
  const v = (c) => {
    const i = (indices ? indices[t * 3 + c] : t * 3 + c) * 3;
    return [
      positions[i] * scale,
      positions[i + 1] * scale,
      positions[i + 2] * scale,
    ];
  };
  return [v(0), v(1), v(2)];
};

const triangleArea = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    0.5 *
    Math.hypot(
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    )
  );
};

// A stress field for one body.
//
//   positions / indices : the item's baked surface mesh, scene units
//   fixtures            : triangle indices held rigid
//   loads               : [{ triangles, force: [fx, fy, fz] }] in newtons,
//                         spread over the picked area
//
// Returns per-vertex von Mises in MPa plus the raw field, so a caller can
// colour the mesh and quote real numbers in a legend.
//
// Two things the display layer has to respect:
//
//   - Surface values UNDER-READ. Stress is computed at each element's centre,
//     half a voxel inside the surface, so in bending a vertex reads roughly
//     (c - h/2)/c of the true surface stress -- about 8% at 12 voxels through
//     a section, and worse on a coarse grid.
//   - The peak near a FIXTURE is meaningless. A fully fixed edge is a stress
//     singularity: its computed value climbs without limit as the grid is
//     refined (see stressField.test.js), so it must never be quoted as the
//     part's stress or used to scale the colour ramp.
export function solveStressField({
  positions,
  indices,
  mmPerUnit = 10,
  material,
  fixtures = [],
  loads = [],
  resolution = 40,
}) {
  const scaled = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i++)
    scaled[i] = positions[i] * mmPerUnit;
  const grid = gridFor(scaled, resolution);
  const occ = voxelise(scaled, indices, grid);
  const { nx, ny, nz, h } = grid;
  const nNodes = (nx + 1) * (ny + 1) * (nz + 1);
  const stiff = new Float64Array(nx * ny * nz);
  for (let e = 0; e < occ.length; e++) stiff[e] = occ[e] ? material.E : 0;

  const fixed = new Uint8Array(3 * nNodes);
  for (const t of fixtures)
    for (const p of triangleOf(positions, indices, t, mmPerUnit))
      for (const [n] of surroundingNodes(p, grid))
        for (let c = 0; c < 3; c++) fixed[n * 3 + c] = 1;

  const forces = new Float64Array(3 * nNodes);
  for (const { triangles, force } of loads) {
    const areas = triangles.map((t) =>
      triangleArea(triangleOf(positions, indices, t, mmPerUnit)),
    );
    const total = areas.reduce((s, a) => s + a, 0);
    if (!(total > 0)) continue;
    triangles.forEach((t, ti) => {
      // The triangle's share of the load, split between its corners and then
      // handed to the grid by the same trilinear weights that interpolate
      // displacement -- consistent load transfer, so a flat face really does
      // come out uniformly stressed.
      const share = areas[ti] / total / 3;
      for (const p of triangleOf(positions, indices, t, mmPerUnit))
        for (const [n, w] of surroundingNodes(p, grid))
          for (let c = 0; c < 3; c++) forces[n * 3 + c] += force[c] * share * w;
    });
  }

  const nu = material.nu;
  const { u, iterations, residual } = solveDisplacements({
    nx,
    ny,
    nz,
    h,
    nu,
    stiff,
    fixed,
    forces,
  });
  const field = vonMises({ nx, ny, nz, h, nu, E: material.E, stiff, u });

  // Back onto the surface: average the occupied elements touching each vertex.
  // Nearest-element alone reads whichever single voxel the vertex happens to
  // fall in, which on a staircase boundary is often the one poking out into
  // the void and carrying almost no load.
  const nVerts = positions.length / 3;
  const vertexStress = new Float32Array(nVerts);
  for (let v = 0; v < nVerts; v++) {
    const p = [
      positions[v * 3] * mmPerUnit,
      positions[v * 3 + 1] * mmPerUnit,
      positions[v * 3 + 2] * mmPerUnit,
    ];
    const gi = Math.floor((p[0] - grid.origin[0]) / h - 0.5);
    const gj = Math.floor((p[1] - grid.origin[1]) / h - 0.5);
    const gk = Math.floor((p[2] - grid.origin[2]) / h - 0.5);
    let sum = 0,
      n = 0;
    for (let a = 0; a <= 1; a++)
      for (let b = 0; b <= 1; b++)
        for (let c = 0; c <= 1; c++) {
          const i = gi + a,
            j = gj + b,
            k = gk + c;
          if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz)
            continue;
          const e = i + nx * (j + ny * k);
          if (!occ[e]) continue;
          sum += field[e];
          n++;
        }
    vertexStress[v] = n ? sum / n : 0;
  }
  let max = 0;
  for (const s of vertexStress) max = Math.max(max, s);
  return {
    vertexStress,
    max,
    field,
    grid,
    occ,
    displacement: u,
    iterations,
    residual,
  };
}
