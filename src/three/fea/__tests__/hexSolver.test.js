// The solver is checked against closed-form answers, because a stress plot is
// only ever as trustworthy as the numbers under it: a rainbow over a wrong
// field looks exactly like a rainbow over a right one.
import { describe, it, expect } from "vitest";
import { solveDisplacements, vonMises } from "../hexSolver.js";

const E = 200000; // MPa, steel
const NU = 0.3;

// A rectangular grid of elements with per-node fixing / loading helpers.
const model = ({ nx, ny, nz, h }) => {
  const nn = (nx + 1) * (ny + 1) * (nz + 1);
  return {
    nx,
    ny,
    nz,
    h,
    nu: NU,
    stiff: new Float64Array(nx * ny * nz).fill(E),
    fixed: new Uint8Array(3 * nn),
    forces: new Float64Array(3 * nn),
    nid: (i, j, k) => i + (nx + 1) * (j + (ny + 1) * k),
  };
};

describe("cantilever deflection against Euler-Bernoulli", () => {
  // 60 x 10 x 10 mm, built in at one end, 1000 N down at the tip.
  const L = 60,
    b = 10,
    t = 10,
    P = 1000;
  const analytic = (P * L ** 3) / (3 * E * ((t * b ** 3) / 12));

  const tipDeflection = (elementsThroughThickness) => {
    const h = b / elementsThroughThickness;
    const m = model({
      nx: Math.round(L / h),
      ny: elementsThroughThickness,
      nz: Math.round(t / h),
      h,
    });
    const end = [];
    for (let j = 0; j <= m.ny; j++)
      for (let k = 0; k <= m.nz; k++) {
        for (let c = 0; c < 3; c++) m.fixed[m.nid(0, j, k) * 3 + c] = 1;
        end.push(m.nid(m.nx, j, k));
      }
    for (const n of end) m.forces[n * 3 + 1] = -P / end.length;
    const { u } = solveDisplacements(m);
    return -end.reduce((s, n) => s + u[n * 3 + 1], 0) / end.length;
  };

  it("converges on the analytic deflection as the mesh is refined", () => {
    const coarse = tipDeflection(2);
    const mid = tipDeflection(4);
    const fine = tipDeflection(8);
    // Trilinear hexes are too STIFF in bending, so each refinement must move
    // the deflection UP toward the analytic value, never past it and back.
    expect(coarse).toBeLessThan(mid);
    expect(mid).toBeLessThan(fine);
    expect(
      fine / analytic,
      `8 elements through thickness gave ${fine.toFixed(4)}mm against ${analytic.toFixed(4)}mm`,
    ).toBeCloseTo(1, 1);
    // The coarse mesh is visibly stiff -- worth knowing, since the tool will
    // default to something nearer this than to the fine mesh.
    expect(coarse / analytic).toBeGreaterThan(0.8);
    expect(coarse / analytic).toBeLessThan(0.95);
  });
});

// A bar on symmetry planes rather than a built-in end: fully fixing a face
// restrains Poisson contraction and puts a stress concentration right where
// these checks want a uniform field.
const tensionBar = ({ h = 2.5, L = 40, side = 10, F = 5000 } = {}) => {
  const m = model({ nx: L / h, ny: side / h, nz: side / h, h });
  for (let j = 0; j <= m.ny; j++)
    for (let k = 0; k <= m.nz; k++) m.fixed[m.nid(0, j, k) * 3] = 1;
  for (let i = 0; i <= m.nx; i++)
    for (let k = 0; k <= m.nz; k++) m.fixed[m.nid(i, 0, k) * 3 + 1] = 1;
  for (let i = 0; i <= m.nx; i++)
    for (let j = 0; j <= m.ny; j++) m.fixed[m.nid(i, j, 0) * 3 + 2] = 1;
  const end = [];
  for (let j = 0; j <= m.ny; j++)
    for (let k = 0; k <= m.nz; k++) end.push(m.nid(m.nx, j, k));
  // A uniform traction needs corner / edge / interior nodes weighted 1:2:4.
  // Loading them equally instead overloads the corners, and the bar then
  // stretches 2.3% further than Hooke's law says -- which reads as a solver
  // error when it is really a badly applied load.
  const weight = (n) => {
    const j = Math.floor((n / (m.nx + 1)) % (m.ny + 1));
    const k = Math.floor(n / ((m.nx + 1) * (m.ny + 1)));
    return (j === 0 || j === m.ny ? 1 : 2) * (k === 0 || k === m.nz ? 1 : 2);
  };
  const total = end.reduce((s, n) => s + weight(n), 0);
  for (const n of end) m.forces[n * 3] = (F * weight(n)) / total;
  return { m, end, L, side, F };
};

describe("uniaxial tension", () => {
  it("reports exactly force over area, everywhere", () => {
    const { m, side, F } = tensionBar();
    const { u } = solveDisplacements(m);
    const vm = vonMises({ ...m, E, u });
    const expected = F / (side * side); // 50 MPa
    let lo = Infinity,
      hi = -Infinity;
    for (const v of vm) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo, `lowest element read ${lo.toFixed(3)} MPa`).toBeCloseTo(
      expected,
      2,
    );
    expect(hi, `highest element read ${hi.toFixed(3)} MPa`).toBeCloseTo(
      expected,
      2,
    );
  });

  it("stretches by the amount Hooke's law says", () => {
    const { m, end, L, side, F } = tensionBar();
    const { u } = solveDisplacements(m);
    const stretch = end.reduce((s, n) => s + u[n * 3], 0) / end.length;
    expect(stretch).toBeCloseTo((F * L) / (side * side * E), 5);
  });
});

describe("a model nothing holds", () => {
  it("gives up rather than iterating on a free-floating body", () => {
    const m = model({ nx: 2, ny: 2, nz: 2, h: 1 });
    m.forces[0] = 100;
    const { iterations } = solveDisplacements(m);
    expect(iterations).toBeLessThan(50);
  });
});
