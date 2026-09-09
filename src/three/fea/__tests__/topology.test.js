// SIMP is checked on the canonical cantilever: fixed along one end, loaded at
// the middle of the other.  The known-good answer is a truss -- flanges at the
// held end, diagonals converging on the load, a hollow middle -- and the tests
// below assert the properties that shape has, rather than a picture of it.
import { describe, it, expect } from "vitest";
import { optimiseTopology } from "../topology.js";

// Each run is a few seconds of conjugate gradient against vitest's 5s default.
const RUN_TIMEOUT = 60_000;

// Big enough for the truss to actually form: on a 24x12 domain the structure
// is still half-resolved after 25 iterations (grey fraction 0.47, and a probe
// point that should be hollow reading 0.78), so a test there measures how
// unconverged it is rather than whether it is right.
const cantilever = ({ nx = 32, ny = 16, nz = 3, load = 100 } = {}) => {
  const grid = { origin: [0, 0, 0], h: 1, nx, ny, nz };
  const occ = new Uint8Array(nx * ny * nz).fill(1);
  const nn = (nx + 1) * (ny + 1) * (nz + 1);
  const fixed = new Uint8Array(3 * nn);
  const forces = new Float64Array(3 * nn);
  const nid = (i, j, k) => i + (nx + 1) * (j + (ny + 1) * k);
  for (let j = 0; j <= ny; j++)
    for (let k = 0; k <= nz; k++)
      for (let c = 0; c < 3; c++) fixed[nid(0, j, k) * 3 + c] = 1;
  for (let k = 0; k <= nz; k++)
    forces[nid(nx, Math.round(ny / 2), k) * 3 + 1] = -load / (nz + 1);
  return { grid, occ, fixed, forces, material: { E: 200000, nu: 0.3 } };
};

const run = (opts = {}) =>
  optimiseTopology({
    ...cantilever(),
    volumeFraction: 0.4,
    iterations: 25,
    ...opts,
  });

// How often neighbouring voxels sit at opposite extremes: the signature of a
// checkerboard, which the discretisation scores as stiff but which is an
// artefact of the elements rather than a real structure.
const flipRate = ({ density, grid: { nx, ny, nz } }) => {
  let flips = 0,
    pairs = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i + 1 < nx; i++) {
        const a = density[i + nx * (j + ny * k)];
        const b = density[i + 1 + nx * (j + ny * k)];
        pairs++;
        if (Math.abs(a - b) > 0.6) flips++;
      }
  return flips / pairs;
};

describe("SIMP on a cantilever", () => {
  it(
    "spends exactly the volume it was given",
    () => {
      const r = run();
      const used = [...r.density].reduce((s, d) => s + d, 0);
      expect(used).toBeCloseTo(r.targetVolume, 3);
    },
    RUN_TIMEOUT,
  );

  it(
    "makes the part far stiffer than spreading the same material evenly",
    () => {
      // Iteration 0 IS the uniform design at the target volume, so the ratio
      // is a like-for-like measure of what the optimisation bought.
      const r = run();
      const first = r.history[0].compliance;
      const last = r.history.at(-1).compliance;
      expect(
        last / first,
        `compliance went ${first.toExponential(2)} -> ${last.toExponential(2)}`,
      ).toBeLessThan(0.35);
    },
    RUN_TIMEOUT,
  );

  it(
    "puts the material on the load path and empties the rest",
    () => {
      const r = run();
      const { nx, ny, nz } = cantilever().grid;
      const at = (i, j) => r.density[i + nx * (j + ny * Math.floor(nz / 2))];
      // The extreme fibres where the bar is held carry the bending, so they
      // end up solid.
      expect(at(1, 0)).toBeGreaterThan(0.9);
      expect(at(1, ny - 1)).toBeGreaterThan(0.9);
      // And a real share of the block is thrown away.  A named interior point
      // is the wrong probe -- whether one voxel lands in a pocket or on a
      // diagonal depends on the grid, not on whether the answer is right.
      const empty = [...r.density].filter((d) => d < 0.1).length;
      expect(
        empty / r.designElements,
        `only ${((empty / r.designElements) * 100).toFixed(0)}% of the block was emptied`,
      ).toBeGreaterThan(0.3);
    },
    RUN_TIMEOUT,
  );

  it(
    "resolves toward solid and void rather than a grey smear",
    () => {
      // Penalisation is what makes the answer manufacturable: intermediate
      // density is not a material anyone can make.
      const r = run();
      const grey = [...r.density].filter((d) => d > 0.15 && d < 0.85).length;
      expect(grey / r.designElements).toBeLessThan(0.45);
    },
    RUN_TIMEOUT,
  );

  it(
    "needs its sensitivity filter to avoid checkerboarding",
    () => {
      // The filter is not cosmetic.  With it effectively off the result breaks
      // into alternating solid and void voxels -- measured flip rate 0.000
      // with the default radius against 0.145 without -- and the checkerboard
      // even scores a LOWER compliance, which is exactly why it has to be
      // suppressed rather than trusted.
      const filtered = run();
      const raw = run({ filterRadius: 0.6 });
      expect(flipRate({ ...filtered, grid: cantilever().grid })).toBeLessThan(
        0.02,
      );
      expect(flipRate({ ...raw, grid: cantilever().grid })).toBeGreaterThan(
        0.05,
      );
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "leaves voxels outside the body alone",
    () => {
      // The design space is the part, not its bounding box: a voxel the
      // voxeliser marked empty must never be given material.
      const base = cantilever();
      const { nx, ny, nz } = base.grid;
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++) base.occ[nx - 1 + nx * (j + ny * k)] = 0;
      const r = optimiseTopology({
        ...base,
        volumeFraction: 0.4,
        iterations: 6,
      });
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          expect(r.density[nx - 1 + nx * (j + ny * k)]).toBe(0);
    },
    RUN_TIMEOUT,
  );
});
