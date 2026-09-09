// End to end through the real path: a baked surface mesh in scene units and
// face picks as triangle indices, out to a von Mises value per vertex --
// checked against beam theory, so the numbers the colours will stand for are
// known to be right before anything is coloured.
import { describe, it, expect } from "vitest";
import { solveStressField } from "../stressField.js";

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
  const groups = {};
  for (const [name, tris] of Object.entries(faces)) {
    groups[name] = [];
    for (const f of tris) {
      groups[name].push(indices.length / 3);
      indices.push(...f);
    }
  }
  return { positions, indices, groups };
};

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
    loads: [{ triangles: groups.xMax, force: [0, -P, 0] }],
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

  it("matches what the voxel model should read at mid-span", () => {
    const want = midspanPrediction(solved, (P * L) / 2);
    const got = midspanStress(solved);
    expect(
      got / want,
      `read ${got.toFixed(1)} MPa where this discretisation predicts ${want.toFixed(1)} MPa`,
    ).toBeCloseTo(1, 1);
  });

  it("holds that agreement when the mesh is refined", () => {
    // The check has to be resolution-stable, or it is only pinning whichever
    // resolution happened to be chosen.
    const finer = solveStressField({
      positions,
      indices,
      mmPerUnit: MM_PER_UNIT,
      material: STEEL,
      fixtures: groups.xMin,
      loads: [{ triangles: groups.xMax, force: [0, -P, 0] }],
      resolution: 48,
    });
    const got = midspanStress(finer) / midspanPrediction(finer, (P * L) / 2);
    expect(got, `refined run read ${got.toFixed(3)} of prediction`).toBeCloseTo(
      1,
      1,
    );
  });

  it("keeps climbing at the built-in corner however fine the mesh", () => {
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
      loads: [{ triangles: groups.xMax, force: [0, -P, 0] }],
      resolution: 56,
    });
    expect(rootStress(finer)).toBeGreaterThan(rootStress(solved) * 1.2);
  });

  it("gives every surface vertex a number", () => {
    expect(solved.vertexStress.length).toBe(positions.length / 3);
    expect([...solved.vertexStress].every((v) => Number.isFinite(v))).toBe(
      true,
    );
    expect(solved.max).toBeGreaterThan(0);
  });

  it("scales linearly with the load, as a linear solve must", () => {
    const half = solveStressField({
      positions,
      indices,
      mmPerUnit: MM_PER_UNIT,
      material: STEEL,
      fixtures: groups.xMin,
      loads: [{ triangles: groups.xMax, force: [0, -P / 2, 0] }],
      resolution: 36,
    });
    expect(half.max / solved.max).toBeCloseTo(0.5, 3);
  });
});
