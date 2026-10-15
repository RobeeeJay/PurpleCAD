// Linear-elastic FEA on the voxel grid: 8-node trilinear hexes, one stiffness
// matrix for the whole model, solved matrix-free.
//
// Every voxel is the same cube, so Ke is built ONCE and every element reuses
// it scaled by its own stiffness.  That is what keeps this in plain JS: the
// global matrix is never assembled (a 60x60x60 grid is ~660k dofs), the
// conjugate gradient only ever needs K*v, and K*v is a gather / 24x24 multiply
// / scatter per element.
//
// Units are N, mm, MPa -- self-consistent, and mm is already the app's
// user-facing unit.  Scene units are mm / MM_PER_UNIT, so callers convert at
// the boundary.
//
// Pure arrays -- no THREE, no DOM -- so it runs in vitest and in a worker.

const GAUSS = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];

// Shape-function corner signs, in the node order the element uses:
// 0(0,0,0) 1(1,0,0) 2(1,1,0) 3(0,1,0) 4(0,0,1) 5(1,0,1) 6(1,1,1) 7(0,1,1)
const CORNER = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

// Isotropic constitutive matrix for E = 1 (Ke scales linearly with E, so each
// element's own modulus is applied at multiply time rather than stored).
function elasticity(nu) {
  const lam = nu / ((1 + nu) * (1 - 2 * nu));
  const mu = 1 / (2 * (1 + nu));
  const D = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) D[i][j] = lam + (i === j ? 2 * mu : 0);
  for (let i = 3; i < 6; i++) D[i][i] = mu;
  return D;
}

// Strain-displacement matrix (6x24) at a natural point of a cube of side h.
function strainDisp(xi, eta, zeta, h) {
  const B = Array.from({ length: 6 }, () => new Float64Array(24));
  const scale = 2 / h; // d(natural)/d(physical) for a cube
  for (let n = 0; n < 8; n++) {
    const [sx, sy, sz] = CORNER[n];
    const dx = 0.125 * sx * (1 + sy * eta) * (1 + sz * zeta) * scale;
    const dy = 0.125 * sy * (1 + sx * xi) * (1 + sz * zeta) * scale;
    const dz = 0.125 * sz * (1 + sx * xi) * (1 + sy * eta) * scale;
    const c = n * 3;
    B[0][c] = dx;
    B[1][c + 1] = dy;
    B[2][c + 2] = dz;
    B[3][c] = dy;
    B[3][c + 1] = dx;
    B[4][c + 1] = dz;
    B[4][c + 2] = dy;
    B[5][c] = dz;
    B[5][c + 2] = dx;
  }
  return B;
}

// Ke for a unit-modulus cube of side h, by 2x2x2 Gauss integration.
export function elementStiffness(h, nu) {
  const D = elasticity(nu);
  const Ke = new Float64Array(24 * 24);
  const detJ = (h / 2) ** 3;
  for (const xi of GAUSS)
    for (const eta of GAUSS)
      for (const zeta of GAUSS) {
        const B = strainDisp(xi, eta, zeta, h);
        // Ke += B' D B * detJ  (weights are all 1 at these points)
        const DB = Array.from({ length: 6 }, () => new Float64Array(24));
        for (let r = 0; r < 6; r++)
          for (let c = 0; c < 24; c++) {
            let s = 0;
            for (let k = 0; k < 6; k++) s += D[r][k] * B[k][c];
            DB[r][c] = s;
          }
        for (let a = 0; a < 24; a++)
          for (let b = 0; b < 24; b++) {
            let s = 0;
            for (let r = 0; r < 6; r++) s += B[r][a] * DB[r][b];
            Ke[a * 24 + b] += s * detJ;
          }
      }
  return Ke;
}

// The 8 node indices of element (i,j,k) on an nx*ny*nz grid.
export function elementNodes(i, j, k, nx, ny) {
  const sx = nx + 1,
    sy = ny + 1;
  const n = (a, b, c) => a + sx * (b + sy * c);
  return [
    n(i, j, k),
    n(i + 1, j, k),
    n(i + 1, j + 1, k),
    n(i, j + 1, k),
    n(i, j, k + 1),
    n(i + 1, j, k + 1),
    n(i + 1, j + 1, k + 1),
    n(i, j + 1, k + 1),
  ];
}

// K*v, element by element.  `stiff` is each element's modulus (0 = absent).
function multiply(v, out, ctx) {
  const { nx, ny, nz, Ke, stiff, fixed } = ctx;
  out.fill(0);
  const ue = new Float64Array(24);
  const ke = new Float64Array(24);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const e = i + nx * (j + ny * k);
        const E = stiff[e];
        if (E <= 0) continue;
        const nodes = elementNodes(i, j, k, nx, ny);
        for (let a = 0; a < 8; a++) {
          const d = nodes[a] * 3;
          ue[a * 3] = v[d];
          ue[a * 3 + 1] = v[d + 1];
          ue[a * 3 + 2] = v[d + 2];
        }
        for (let a = 0; a < 24; a++) {
          let s = 0;
          for (let b = 0; b < 24; b++) s += Ke[a * 24 + b] * ue[b];
          ke[a] = s * E;
        }
        for (let a = 0; a < 8; a++) {
          const d = nodes[a] * 3;
          out[d] += ke[a * 3];
          out[d + 1] += ke[a * 3 + 1];
          out[d + 2] += ke[a * 3 + 2];
        }
      }
  // A fixed dof is held at zero: keeping its row as the identity leaves the
  // system symmetric positive-definite, which the conjugate gradient needs.
  for (let d = 0; d < out.length; d++) if (fixed[d]) out[d] = v[d];
}

// Solve K u = f by Jacobi-preconditioned conjugate gradient.
//
// Returns `converged`: false means the answer is not usable, which callers
// must check rather than colouring whatever came back.
export function solveDisplacements({
  nx,
  ny,
  nz,
  h,
  nu,
  stiff,
  fixed,
  forces,
  // Measured on a 58k-element model: tightening past this changes neither the
  // mean nor the peak stress by so much as 0.01%, and costs 20% more time
  // (886 iterations at 1e-8 against 749 here).
  tol = 1e-5,
  maxIter = 4000,
}) {
  const Ke = elementStiffness(h, nu);
  const ndof = 3 * (nx + 1) * (ny + 1) * (nz + 1);
  const ctx = { nx, ny, nz, Ke, stiff, fixed };

  // Jacobi preconditioner: the assembled diagonal, which needs no matrix.
  const diag = new Float64Array(ndof);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const E = stiff[i + nx * (j + ny * k)];
        if (E <= 0) continue;
        const nodes = elementNodes(i, j, k, nx, ny);
        for (let a = 0; a < 8; a++)
          for (let c = 0; c < 3; c++) {
            const l = a * 3 + c;
            diag[nodes[a] * 3 + c] += Ke[l * 24 + l] * E;
          }
      }
  for (let d = 0; d < ndof; d++) if (fixed[d] || diag[d] <= 0) diag[d] = 1;

  const u = new Float64Array(ndof);
  const r = new Float64Array(ndof);
  const z = new Float64Array(ndof);
  const p = new Float64Array(ndof);
  const Ap = new Float64Array(ndof);
  for (let d = 0; d < ndof; d++) r[d] = fixed[d] ? 0 : forces[d];
  for (let d = 0; d < ndof; d++) z[d] = r[d] / diag[d];
  p.set(z);
  let rz = 0;
  for (let d = 0; d < ndof; d++) rz += r[d] * z[d];
  const f0 = Math.sqrt(rz) || 1;
  let iterations = 0;
  let residual = Math.sqrt(rz);
  let converged = rz === 0;
  // Conjugate gradient cannot diverge on a well-posed system, so growth by
  // orders of magnitude means the system is not one -- a load with nothing to
  // push against, most often.  Without this the run grinds out every iteration
  // and returns garbage: measured residuals of 1e+61 after 4000 iterations and
  // 49 seconds, where a well-posed model of the same size converged in 590.
  const DIVERGED = 1e6;
  for (; iterations < maxIter; iterations++) {
    if (Math.sqrt(rz) / f0 < tol) {
      converged = true;
      break;
    }
    if (Math.sqrt(Math.abs(rz)) / f0 > DIVERGED || !Number.isFinite(rz)) break;
    multiply(p, Ap, ctx);
    let pAp = 0;
    for (let d = 0; d < ndof; d++) pAp += p[d] * Ap[d];
    if (!(pAp > 0)) break; // a free-floating model: nothing holds it
    const alpha = rz / pAp;
    for (let d = 0; d < ndof; d++) {
      u[d] += alpha * p[d];
      r[d] -= alpha * Ap[d];
    }
    for (let d = 0; d < ndof; d++) z[d] = r[d] / diag[d];
    let rzNew = 0;
    for (let d = 0; d < ndof; d++) rzNew += r[d] * z[d];
    const beta = rzNew / rz;
    for (let d = 0; d < ndof; d++) p[d] = z[d] + beta * p[d];
    rz = rzNew;
    residual = Math.sqrt(Math.abs(rz));
  }
  return { u, iterations, residual: residual / f0, converged };
}

// Von Mises stress at each element's centre, in MPa.
export function vonMises({ nx, ny, nz, h, nu, E, stiff, u }) {
  const B = strainDisp(0, 0, 0, h);
  const D = elasticity(nu);
  const out = new Float64Array(nx * ny * nz);
  const ue = new Float64Array(24);
  const eps = new Float64Array(6);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const e = i + nx * (j + ny * k);
        if (stiff[e] <= 0) continue;
        const nodes = elementNodes(i, j, k, nx, ny);
        for (let a = 0; a < 8; a++) {
          const d = nodes[a] * 3;
          ue[a * 3] = u[d];
          ue[a * 3 + 1] = u[d + 1];
          ue[a * 3 + 2] = u[d + 2];
        }
        for (let r = 0; r < 6; r++) {
          let s = 0;
          for (let c = 0; c < 24; c++) s += B[r][c] * ue[c];
          eps[r] = s;
        }
        const sig = new Float64Array(6);
        for (let r = 0; r < 6; r++) {
          let s = 0;
          for (let c = 0; c < 6; c++) s += D[r][c] * eps[c];
          // D is built for unit modulus; the element carries the real one.
          sig[r] = s * E;
        }
        const [sx, sy, sz, txy, tyz, tzx] = sig;
        out[e] = Math.sqrt(
          0.5 *
            ((sx - sy) ** 2 +
              (sy - sz) ** 2 +
              (sz - sx) ** 2 +
              6 * (txy * txy + tyz * tyz + tzx * tzx)),
        );
      }
  return out;
}
