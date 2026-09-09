// End to end through the real path: a baked surface mesh in scene units and
// face picks as triangle indices, out to a von Mises value per vertex --
// checked against beam theory, so the numbers the colours will stand for are
// known to be right before anything is coloured.
import { describe, it, expect } from "vitest";
import { solveStressField } from "../stressField.js";

// The solves here take a good fraction of a second each, against vitest's 5s
// default, and the whole unit suite runs them in parallel with 160 other
// files. An explicit ceiling keeps a loaded machine from failing them on time
// rather than on arithmetic.
const SOLVE_TIMEOUT = 30_000;

const MM_PER_UNIT = 10;
const STEEL = { E: 200000, nu: 0.3 };

// A box as a triangle soup in SCENE units, spanning 0..L in x and centred on
// the other two axes.  Face triangles are grouped so a test can pick one face
// the way the app's face picking would hand it over.
const barMesh = (Lmm, bmm, tmm) => {
  const L = Lmm / MM_PER_UNIT,
    b = bmm / MM_PER_UNIT / 2,
    t = tmm / MM_PER_UNIT / 2;
  const c = [
    [0, -b, -t],
    [L, -b, -t],
    [L, b, -t],
    [0, b, -t],
    [0, -b, t],
    [L, -b, t],
    [L, b, t],
    [0, b, t],
  ];
  const faces = {
    xMin: [
      [0, 4, 7],
      [0, 7, 3],
    ],
    xMax: [
      [1, 2, 6],
      [1, 6, 5],
    ],
    yMin: [
      [0, 1, 5],
      [0, 5, 4],
    ],
    yMax: [
      [3, 7, 6],
      [3, 6, 2],
    ],
    zMin: [
      [0, 2, 1],
      [0, 3, 2],
    ],
    zMax: [
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
  const positions = c.flat();
  const indices = [];
  // Face picks are soups of corner positions, so the groups are built the same
  // way the app's face picking hands them over.
  const groups = {};
  for (const [name, tris] of Object.entries(faces)) {
    groups[name] = [];
    for (const f of tris) {
      indices.push(...f);
      for (const v of f) groups[name].push(...c[v]);
    }
  }
  return { positions, indices, groups };
};

// A curved body, where the picked faces do NOT line up with the grid.
const ball = (rMm, seg = 20) => {
  const r = rMm / MM_PER_UNIT;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= seg; i++) {
    const phi = (i / seg) * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * 2 * Math.PI;
      positions.push(
        r * Math.sin(phi) * Math.cos(th),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(th),
      );
    }
  }
  const at = (i, j) => i * (seg + 1) + j;
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++)
      indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
  const cap = (want) => {
    const soup = [];
    for (let t = 0; t < indices.length / 3; t++) {
      const vs = [0, 1, 2].map((c) => indices[t * 3 + c] * 3);
      if (!vs.every((v) => want(positions[v + 1]))) continue;
      for (const v of vs)
        soup.push(positions[v], positions[v + 1], positions[v + 2]);
    }
    return soup;
  };
  return {
    positions,
    indices,
    bottom: cap((y) => y < -0.85 * r),
    top: cap((y) => y > 0.85 * r),
  };
};

describe("a load whose faces do not line up with the grid", () => {
  // A surface point sits ON the boundary, so some of its eight surrounding
  // grid nodes are outside the body and carry no stiffness.  Force handed to
  // one of those can never be balanced: the system is inconsistent and the
  // conjugate gradient DIVERGES.  Measured on a sphere before the fix -- at
  // resolutions with orphaned nodes it ran every one of its 4000 iterations to
  // a residual of 1e+61 and 5.7e+61, taking 49 seconds to return NaN, while
  // the one resolution that happened to orphan nothing converged in 590.
  const b = ball(50);
  for (const resolution of [24, 32, 40]) {
    it(
      `converges at detail ${resolution}`,
      () => {
        const r = solveStressField({
          positions: b.positions,
          indices: b.indices,
          mmPerUnit: MM_PER_UNIT,
          material: STEEL,
          fixtures: b.bottom,
          loads: [{ soup: b.top, force: [80, -100, 0] }],
          resolution,
        });
        expect(
          r.converged,
          `residual ${r.residual.toExponential(1)} after ${r.iterations} iterations`,
        ).toBe(true);
        expect([...r.vertexStress].every((v) => Number.isFinite(v))).toBe(true);
        // And the load was not quietly lost on the way: the weights of the
        // surviving nodes are renormalised, so nothing is dropped.
        expect(r.unsupportedLoad).toBe(0);
      },
      SOLVE_TIMEOUT,
    );
  }
});

describe("stress on a cantilever, through the mesh path", () => {
  const L = 60,
    b = 10,
    t = 10,
    P = 800;
  const { positions, indices, groups } = barMesh(L, b, t);
  const solved = solveStressField({
    positions,
    indices,
    mmPerUnit: MM_PER_UNIT,
    material: STEEL,
    fixtures: groups.xMin,
    loads: [{ soup: groups.xMax, force: [0, -P, 0] }],
    resolution: 36,
  });

  it("puts the peak stress at the built-in end, not the loaded one", () => {
    // Bending moment is largest where the bar is held and zero at the tip, so
    // any field with this the other way round is wired backwards.
    const xOf = (v) => positions[v * 3] * MM_PER_UNIT;
    let root = 0,
      tip = 0;
    for (let v = 0; v < positions.length / 3; v++)
      if (xOf(v) < L * 0.1) root = Math.max(root, solved.vertexStress[v]);
      else if (xOf(v) > L * 0.9) tip = Math.max(tip, solved.vertexStress[v]);
    expect(root).toBeGreaterThan(tip * 3);
  });

  // What the VOXEL MODEL should read at mid-span, which is not what beam
  // theory says the real bar reads.  Two artefacts sit in between, and both
  // are properties of the discretisation rather than solver error:
  //
  //   - stress is evaluated at each element's CENTRE, half a voxel inside the
  //     surface, and bending stress falls off linearly toward the neutral
  //     axis;
  //   - the cross-section is quantised to whole voxels, and bending stress
  //     goes as b^3, so half a voxel on the width is several percent.
  //
  // Comparing against raw beam theory therefore measures the mesh, not the
  // solve: it read 0.70, 0.85, 0.85, 0.81 of theory at four resolutions with
  // no sign of converging on 1. Against the corrected prediction the same
  // runs give 0.93, 1.02, 0.97, 0.98.
  const midspanPrediction = (solved, moment) => {
    const g = solved.grid;
    const iMid = Math.round((L / 2 - g.origin[0]) / g.h - 0.5);
    const js = new Set(),
      ks = new Set();
    for (let k = 0; k < g.nz; k++)
      for (let j = 0; j < g.ny; j++)
        if (solved.occ[iMid + g.nx * (j + g.ny * k)]) {
          js.add(j);
          ks.add(k);
        }
    const bv = js.size * g.h,
      tv = ks.size * g.h;
    return (moment * (bv / 2 - g.h / 2)) / ((tv * bv ** 3) / 12);
  };
  const midspanStress = (solved) => {
    const g = solved.grid;
    let peak = 0;
    for (let e = 0; e < solved.field.length; e++) {
      const x = g.origin[0] + ((e % g.nx) + 0.5) * g.h;
      if (Math.abs(x - L / 2) < g.h) peak = Math.max(peak, solved.field[e]);
    }
    return peak;
  };

  it(
    "matches what the voxel model should read at mid-span",
    () => {
      const want = midspanPrediction(solved, (P * L) / 2);
      const got = midspanStress(solved);
      expect(
        got / want,
        `read ${got.toFixed(1)} MPa where this discretisation predicts ${want.toFixed(1)} MPa`,
      ).toBeCloseTo(1, 1);
    },
    SOLVE_TIMEOUT,
  );

  it(
    "holds that agreement when the mesh is refined",
    () => {
      // The check has to be resolution-stable, or it is only pinning whichever
      // resolution happened to be chosen.
      const finer = solveStressField({
        positions,
        indices,
        mmPerUnit: MM_PER_UNIT,
        material: STEEL,
        fixtures: groups.xMin,
        loads: [{ soup: groups.xMax, force: [0, -P, 0] }],
        resolution: 48,
      });
      const got = midspanStress(finer) / midspanPrediction(finer, (P * L) / 2);
      expect(
        got,
        `refined run read ${got.toFixed(3)} of prediction`,
      ).toBeCloseTo(1, 1);
    },
    SOLVE_TIMEOUT,
  );

  it(
    "keeps climbing at the built-in corner however fine the mesh",
    () => {
      // NOT a defect to fix: a fully fixed re-entrant edge is a stress
      // singularity, infinite in the continuum, so the computed value rises
      // without limit as the elements shrink (measured 0.68, 1.14, 1.86, 3.40
      // of beam theory at four resolutions).  Pinned here so the peak reading
      // near a fixture is never quoted as the part's real stress.
      const rootStress = (solved) => {
        const g = solved.grid;
        let peak = 0;
        for (let e = 0; e < solved.field.length; e++) {
          const x = g.origin[0] + ((e % g.nx) + 0.5) * g.h;
          if (x > g.h * 1.5 && x < g.h * 3.5)
            peak = Math.max(peak, solved.field[e]);
        }
        return peak;
      };
      const finer = solveStressField({
        positions,
        indices,
        mmPerUnit: MM_PER_UNIT,
        material: STEEL,
        fixtures: groups.xMin,
        loads: [{ soup: groups.xMax, force: [0, -P, 0] }],
        resolution: 56,
      });
      expect(rootStress(finer)).toBeGreaterThan(rootStress(solved) * 1.2);
    },
    SOLVE_TIMEOUT,
  );

  it("gives every surface vertex a number", () => {
    expect(solved.vertexStress.length).toBe(positions.length / 3);
    expect([...solved.vertexStress].every((v) => Number.isFinite(v))).toBe(
      true,
    );
    expect(solved.max).toBeGreaterThan(0);
  });

  it(
    "scales linearly with the load, as a linear solve must",
    () => {
      const half = solveStressField({
        positions,
        indices,
        mmPerUnit: MM_PER_UNIT,
        material: STEEL,
        fixtures: groups.xMin,
        loads: [{ soup: groups.xMax, force: [0, -P / 2, 0] }],
        resolution: 36,
      });
      expect(half.max / solved.max).toBeCloseTo(0.5, 3);
    },
    SOLVE_TIMEOUT,
  );
});
