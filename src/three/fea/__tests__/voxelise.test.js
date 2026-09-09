// Volumes are checked against the analytic ones, because a voxeliser that
// leaks (a missed crossing fills a whole column) or that fills a hollow body
// solid produces a plausible-looking grid and a completely wrong stress field.
import { describe, it, expect } from "vitest";
import { gridFor, voxelise, voxelVolume } from "../voxelise.js";

// Axis-aligned box as a triangle soup, centred on the origin.
const boxMesh = (w, h, d, offset = [0, 0, 0]) => {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const c = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ].map((p) => p.map((v, i) => v + offset[i]));
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
    [0, 4, 7],
    [0, 7, 3],
    [1, 2, 6],
    [1, 6, 5],
  ];
  const positions = [];
  const indices = [];
  for (const p of c) positions.push(...p);
  for (const f of faces) indices.push(...f);
  return { positions, indices };
};

// Icosphere-ish: a UV sphere is enough, and its facets make it slightly
// SMALLER than the true sphere, which the tolerance below accounts for.
const sphereMesh = (r, seg = 48) => {
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
  return { positions, indices };
};

describe("voxelising a solid", () => {
  it("fills a box to its real volume", () => {
    const { positions, indices } = boxMesh(20, 10, 10);
    const grid = gridFor(positions, 40);
    const occ = voxelise(positions, indices, grid);
    // A voxel counts when its CENTRE is inside, so the error is bounded by the
    // half-voxel shell around the surface.
    expect(voxelVolume(occ, grid) / 2000).toBeCloseTo(1, 1);
  });

  it("fills a sphere to its real volume", () => {
    const r = 10;
    const { positions, indices } = sphereMesh(r);
    const grid = gridFor(positions, 48);
    const occ = voxelise(positions, indices, grid);
    const analytic = (4 / 3) * Math.PI * r ** 3;
    expect(voxelVolume(occ, grid) / analytic).toBeCloseTo(1, 1);
  });

  it("leaves the cavity of a hollow body empty", () => {
    // Two nested boxes: the parity fill must switch off between the inner
    // walls, not run straight through from the outer surface.
    const outer = boxMesh(20, 20, 20);
    const inner = boxMesh(10, 10, 10);
    const positions = [...outer.positions, ...inner.positions];
    const indices = [
      ...outer.indices,
      ...inner.indices.map((i) => i + outer.positions.length / 3),
    ];
    const grid = gridFor(positions, 40);
    const occ = voxelise(positions, indices, grid);
    const wall = 20 ** 3 - 10 ** 3;
    expect(voxelVolume(occ, grid) / wall).toBeCloseTo(1, 1);
    // The very centre is inside the cavity, so it must be empty.
    const mid = (n) => Math.floor(n / 2);
    const c = mid(grid.nx) + grid.nx * (mid(grid.ny) + grid.ny * mid(grid.nz));
    expect(occ[c]).toBe(0);
  });

  it("keeps a body that sits off the origin off the origin", () => {
    // Regression guard for index arithmetic: an occupancy grid that ignores
    // the offset still has the right VOLUME while being in the wrong place.
    const { positions, indices } = boxMesh(10, 10, 10, [30, 0, 0]);
    const grid = gridFor(positions, 30);
    const occ = voxelise(positions, indices, grid);
    let sumX = 0,
      n = 0;
    for (let k = 0; k < grid.nz; k++)
      for (let j = 0; j < grid.ny; j++)
        for (let i = 0; i < grid.nx; i++)
          if (occ[i + grid.nx * (j + grid.ny * k)]) {
            sumX += grid.origin[0] + (i + 0.5) * grid.h;
            n++;
          }
    expect(sumX / n).toBeCloseTo(30, 0);
  });
});
