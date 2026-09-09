// Topology optimisation by SIMP: keep the material that carries load, remove
// the rest.
//
// Solid Isotropic Material with Penalisation, on the voxel grid the stress view
// already builds.  Each voxel gets a density between 0 and 1; its stiffness is
// density^p, with p > 1 so that intermediate densities buy less stiffness than
// they cost volume and the result drives itself toward solid-or-void.  The
// objective is compliance -- the work the load does -- so minimising it is
// maximising stiffness for the volume allowed.
//
// The sensitivity of compliance to a voxel's density has a closed form for
// this discretisation, which is why the method is tractable: no finite
// differencing, one solve per iteration.
//
// Pure arrays -- no THREE, no DOM -- so it runs in vitest and in a worker.

import {
  elementStiffness,
  elementNodes,
  solveDisplacements,
} from "./hexSolver.js";

// Void is not zero: a genuinely zero-stiffness element makes the system
// singular.  This is the usual floor, small enough not to carry load.
const E_MIN_FRACTION = 1e-9;

// Blur the sensitivities over a radius before they are used.
//
// Without it SIMP produces checkerboards -- alternating solid and void voxels,
// which the discretisation scores as artificially stiff -- and the result
// depends on the grid rather than the problem.
export function filterSensitivities({ nx, ny, nz, radius, density, dc }) {
  const out = new Float64Array(dc.length);
  const r = Math.ceil(radius);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let sum = 0,
          wsum = 0;
        for (let dk = -r; dk <= r; dk++)
          for (let dj = -r; dj <= r; dj++)
            for (let di = -r; di <= r; di++) {
              const a = i + di,
                b = j + dj,
                c = k + dk;
              if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz)
                continue;
              const w = radius - Math.hypot(di, dj, dk);
              if (w <= 0) continue;
              const e = a + nx * (b + ny * c);
              sum += w * density[e] * dc[e];
              wsum += w;
            }
        const e = i + nx * (j + ny * k);
        out[e] = sum / (wsum * Math.max(density[e], 1e-3));
      }
  return out;
}

// Bisection on the Lagrange multiplier for the volume constraint: the standard
// optimality-criteria update.  Each density moves toward where its sensitivity
// says it should be, limited per step, and the multiplier is chosen so the
// volume comes out exactly at the target.
export function updateDensities({
  density,
  dc,
  keep,
  targetVolume,
  move = 0.2,
}) {
  let lo = 1e-9,
    hi = 1e9;
  const next = new Float64Array(density.length);
  for (let iter = 0; iter < 80 && (hi - lo) / (hi + lo) > 1e-6; iter++) {
    const mid = 0.5 * (lo + hi);
    let volume = 0;
    for (let e = 0; e < density.length; e++) {
      if (!keep[e]) {
        next[e] = 0;
        continue;
      }
      const scaled = density[e] * Math.sqrt(Math.max(0, -dc[e] / mid));
      next[e] = Math.min(
        1,
        Math.min(
          density[e] + move,
          Math.max(0.001, Math.max(density[e] - move, scaled)),
        ),
      );
      volume += next[e];
    }
    if (volume > targetVolume) lo = mid;
    else hi = mid;
  }
  return next;
}

// One SIMP run.  `occ` marks which voxels are inside the body at all -- the
// design space -- and `fixed`/`forces` are the same arrays the stress solve
// takes, so a load case set up for the stress view drives this unchanged.
export function optimiseTopology({
  grid,
  occ,
  fixed,
  forces,
  material,
  volumeFraction = 0.4,
  penalty = 3,
  filterRadius = 1.5,
  iterations = 30,
  onIteration = null,
}) {
  const { nx, ny, nz, h } = grid;
  const ne = nx * ny * nz;
  const Ke = elementStiffness(h, material.nu);
  const solid = [];
  for (let e = 0; e < ne; e++) if (occ[e]) solid.push(e);
  const targetVolume = solid.length * volumeFraction;

  let density = new Float64Array(ne);
  for (const e of solid) density[e] = volumeFraction;

  const stiff = new Float64Array(ne);
  const ue = new Float64Array(24);
  const history = [];

  for (let iter = 0; iter < iterations; iter++) {
    for (let e = 0; e < ne; e++)
      stiff[e] = occ[e]
        ? material.E *
          (E_MIN_FRACTION + (1 - E_MIN_FRACTION) * density[e] ** penalty)
        : 0;
    const { u } = solveDisplacements({
      nx,
      ny,
      nz,
      h,
      nu: material.nu,
      stiff,
      fixed,
      forces,
    });

    // Compliance and its sensitivity.  For this discretisation both come from
    // the same per-element quantity, u' Ke u, so one solve gives the whole
    // gradient -- no finite differences over thousands of elements.
    let compliance = 0;
    const dc = new Float64Array(ne);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const e = i + nx * (j + ny * k);
          if (!occ[e]) continue;
          const nodes = elementNodes(i, j, k, nx, ny);
          for (let a = 0; a < 8; a++) {
            const d = nodes[a] * 3;
            ue[a * 3] = u[d];
            ue[a * 3 + 1] = u[d + 1];
            ue[a * 3 + 2] = u[d + 2];
          }
          let energy = 0;
          for (let a = 0; a < 24; a++) {
            let s = 0;
            for (let b = 0; b < 24; b++) s += Ke[a * 24 + b] * ue[b];
            energy += ue[a] * s;
          }
          const rho = density[e];
          compliance +=
            material.E *
            (E_MIN_FRACTION + (1 - E_MIN_FRACTION) * rho ** penalty) *
            energy;
          dc[e] =
            -penalty *
            material.E *
            (1 - E_MIN_FRACTION) *
            rho ** (penalty - 1) *
            energy;
        }

    const filtered = filterSensitivities({
      nx,
      ny,
      nz,
      radius: filterRadius,
      density,
      dc,
    });
    const next = updateDensities({
      density,
      dc: filtered,
      keep: occ,
      targetVolume,
    });
    let change = 0;
    for (let e = 0; e < ne; e++)
      change = Math.max(change, Math.abs(next[e] - density[e]));
    density = next;
    history.push({ iteration: iter, compliance, change });
    onIteration?.({ iteration: iter, compliance, change, density });
    // Converged: the densities have stopped moving.
    if (change < 0.01) break;
  }

  return { density, history, designElements: solid.length, targetVolume };
}
