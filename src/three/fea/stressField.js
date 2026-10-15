// Surface mesh + picked faces -> a von Mises stress per surface vertex.
//
// Ties voxelise.js and hexSolver.js to what the app actually has: an item's
// baked geometryData in SCENE units, and face picks expressed as triangle
// soups (the same currency the emboss face-set tools already deal in).
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
function surroundingNodes(p, grid, supported = null) {
  const { origin, h, nx, ny, nz } = grid;
  // Nodes sit at the voxel CORNERS -- origin + i*h -- so the index is the raw
  // offset in voxels.  Subtracting the half that voxel-CENTRE indexing needs
  // put every load and fixture half a voxel out, and asymmetrically: a point
  // on one face of a symmetric body straddled a supported node and an empty
  // one, so its whole share landed on a single node, while its mirror split
  // evenly between two. Measured on a symmetric box, the two edges of one
  // loaded face took -68.75N and -6.25N.
  const g = [0, 1, 2].map((c) => (p[c] - origin[c]) / h);
  const i0 = Math.floor(g[0]),
    j0 = Math.floor(g[1]),
    k0 = Math.floor(g[2]);
  const f = [g[0] - i0, g[1] - j0, g[2] - k0];
  const out = [];
  let wsum = 0;
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) {
        const i = i0 + a,
          j = j0 + b,
          k = k0 + c;
        if (i < 0 || j < 0 || k < 0 || i > nx || j > ny || k > nz) continue;
        const n = i + (nx + 1) * (j + (ny + 1) * k);
        if (supported && !supported[n]) continue;
        const w =
          (a ? f[0] : 1 - f[0]) * (b ? f[1] : 1 - f[1]) * (c ? f[2] : 1 - f[2]);
        if (w > 0) {
          out.push([n, w]);
          wsum += w;
        }
      }
  // Renormalise over the nodes that survived.  A surface point sits ON the
  // boundary, so some of its eight neighbours are outside the body and carry
  // no stiffness at all; force handed to one of those can never be balanced,
  // which makes the system inconsistent and the conjugate gradient DIVERGE --
  // measured residuals of 1e+61 after grinding out all 4000 iterations, where
  // the same model at a resolution that happened to produce no orphans
  // converged in 590. Dropping them instead of renormalising would quietly
  // lose part of the load.
  if (supported && wsum > 0) for (const pair of out) pair[1] /= wsum;
  return out;
}

const soupTriangles = function* (soup, scale) {
  for (let t = 0; t + 8 < soup.length; t += 9)
    yield [0, 3, 6].map((o) => [
      soup[t + o] * scale,
      soup[t + o + 1] * scale,
      soup[t + o + 2] * scale,
    ]);
};

// Points spread evenly over a triangle, for handing its share of the load to
// the grid.
//
// Lumping at the three CORNERS instead makes the transfer depend on how a face
// was triangulated: a quad splits along one diagonal, so the two corners on it
// collect double, and mirroring the model flips the diagonal. Measured on a
// symmetric box, that put 50N of a 400N load on the wrong side and left a node
// held whose mirror was free -- so a symmetric problem could not produce a
// symmetric answer however careful everything downstream was.
//
// Sub-triangle centroids converge on the true integral of the shape functions
// over the face, which does not know about the triangulation.
// Sub-triangle centroids integrate a LINEAR function exactly; the shape
// functions over a face are bilinear, so a residual remains and shrinks with
// the order. Measured on a symmetric box, the worst mirrored force difference
// went 2.08N at order 4 to well under a tenth of that at order 12, on a 400N
// load -- and loads cover few triangles, so the points are cheap.
const QUADRATURE_ORDER = 12;
function* trianglePoints([a, b, c], order = QUADRATURE_ORDER) {
  for (let i = 0; i < order; i++)
    for (let j = 0; j < order - i; j++) {
      // Each row of the subdivision holds upward sub-triangles and, except at
      // its end, downward ones between them.
      const up = [
        [i + 1 / 3, j + 1 / 3],
        [i + 2 / 3, j + 2 / 3],
      ];
      for (let k = 0; k < (j < order - i - 1 ? 2 : 1); k++) {
        const [x, y] = up[k];
        const u = x / order,
          v = y / order,
          w = 1 - u - v;
        yield [
          [0, 1, 2].map((d) => w * a[d] + u * b[d] + v * c[d]),
          1 / (order * order),
        ];
      }
    }
}

// The node plane nearest a point on each axis (both, on an exact tie).
//
// Fixtures are a yes/no, so the trilinear weights are the wrong tool for them:
// a point landing exactly ON a node plane has zero weight toward the cell on
// one side, and its mirror lands on the other side of the tie, leaving a node
// held whose mirror is free. Taking the whole neighbourhood is symmetric
// however the point falls.
function nodesNear(p, grid, supported) {
  const { origin, h, nx, ny, nz } = grid;
  const g = [0, 1, 2].map((c) => (p[c] - origin[c]) / h);
  // The NEAREST node plane on each axis, both of them on an exact tie.  A full
  // voxel of reach instead holds a whole layer of elements inside the body,
  // whose strain -- and so whose stress -- then reads zero, and the beam it
  // leaves is shorter and stiffer than the one that was modelled.
  const lo = g.map((v) => Math.ceil(v - 0.5 - 1e-9));
  const hi = g.map((v) => Math.floor(v + 0.5 + 1e-9));
  const out = [];
  for (let i = Math.max(0, lo[0]); i <= Math.min(nx, hi[0]); i++)
    for (let j = Math.max(0, lo[1]); j <= Math.min(ny, hi[1]); j++)
      for (let k = Math.max(0, lo[2]); k <= Math.min(nz, hi[2]); k++) {
        const n = i + (nx + 1) * (j + (ny + 1) * k);
        if (!supported || supported[n]) out.push(n);
      }
  return out;
}

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
//   fixtures            : a triangle soup held rigid
//   loads               : [{ soup, force: [fx, fy, fz] }] in newtons, spread
//                         over the picked area by triangle area
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
//   - The peak sits AT the fixture, and is only as good as the mesh there.
//     It converges from below on the beam-theory value as the grid is refined
//     (170, 221, 236, 242, 255 MPa against 288 for the test bar), so it is a
//     real reading rather than a runaway -- but a coarse grid understates it
//     badly, which is why the colour ramp is scaled to the material's yield
//     rather than to whatever the peak happens to be.
// The discretisation and boundary conditions for a load case: the grid, which
// voxels are inside the body, which degrees of freedom are held, and where the
// force goes.  Shared with the topology optimiser, which needs exactly this
// and must not re-derive it -- the handling of load that lands on nodes with
// no material behind them is subtle and was got wrong once already.
export function buildLoadCase({
  positions,
  indices,
  mmPerUnit = 10,
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
  // Which nodes actually have material around them.  Everything else is
  // outside the body: it must take no load, and it must be held, or its
  // free-floating degrees of freedom leave the system singular.
  const supported = new Uint8Array(nNodes);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!occ[i + nx * (j + ny * k)]) continue;
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++)
            for (let c = 0; c < 2; c++)
              supported[i + a + (nx + 1) * (j + b + (ny + 1) * (k + c))] = 1;
      }

  const fixed = new Uint8Array(3 * nNodes);
  for (let n = 0; n < nNodes; n++)
    if (!supported[n]) for (let c = 0; c < 3; c++) fixed[n * 3 + c] = 1;
  for (const tri of soupTriangles(fixtures, mmPerUnit))
    for (const [p] of trianglePoints(tri))
      for (const n of nodesNear(p, grid, supported))
        for (let c = 0; c < 3; c++) fixed[n * 3 + c] = 1;

  const forces = new Float64Array(3 * nNodes);
  let unsupportedLoad = 0;
  for (const { soup, force } of loads) {
    const tris = [...soupTriangles(soup, mmPerUnit)];
    const areas = tris.map(triangleArea);
    const total = areas.reduce((s, a) => s + a, 0);
    if (!(total > 0)) continue;
    tris.forEach((tri, ti) => {
      // The triangle's share of the load, split between its corners and then
      // handed to the grid by the same trilinear weights that interpolate
      // displacement -- consistent load transfer, so a flat face really does
      // come out uniformly stressed.
      const share = areas[ti] / total;
      for (const [p, weight] of trianglePoints(tri)) {
        const nodes = surroundingNodes(p, grid, supported);
        if (!nodes.length) {
          unsupportedLoad += share * weight;
          continue;
        }
        for (const [n, w] of nodes)
          for (let c = 0; c < 3; c++)
            forces[n * 3 + c] += force[c] * share * weight * w;
      }
    });
  }

  return {
    grid,
    occ,
    fixed,
    forces,
    supported,
    unsupportedLoad,
    nNodes,
    nx,
    ny,
    nz,
    h,
  };
}

export function solveStressField({
  positions,
  indices,
  mmPerUnit = 10,
  material,
  fixtures = [],
  loads = [],
  resolution = 40,
  tol,
}) {
  const { grid, occ, fixed, forces, unsupportedLoad, nx, ny, nz, h } =
    buildLoadCase({
      positions,
      indices,
      mmPerUnit,
      fixtures,
      loads,
      resolution,
    });
  const stiff = new Float64Array(nx * ny * nz);
  for (let e = 0; e < occ.length; e++) stiff[e] = occ[e] ? material.E : 0;
  const nu = material.nu;
  const { u, iterations, residual, converged } = solveDisplacements({
    nx,
    ny,
    nz,
    h,
    nu,
    stiff,
    fixed,
    forces,
    ...(tol ? { tol } : {}),
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
    converged,
    elements: stiff.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    // What share of the requested load found no material to act on.  Non-zero
    // means the picked faces are finer than the grid can see.
    unsupportedLoad,
  };
}
