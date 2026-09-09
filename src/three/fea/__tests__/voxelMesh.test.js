// The surface handed downstream has to be watertight and correctly wound, or
// the mesh-to-solid path either refuses it or sews it inside out.
import { describe, it, expect } from "vitest";
import { keptVoxels, solidCount, voxelSurface } from "../voxelMesh.js";

const grid = { origin: [0, 0, 0], h: 10, nx: 6, ny: 6, nz: 6 };
const at = (i, j, k) => i + grid.nx * (j + grid.ny * k);

const blockOf = (pred) => {
  const d = new Float64Array(grid.nx * grid.ny * grid.nz);
  for (let k = 0; k < grid.nz; k++)
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) d[at(i, j, k)] = pred(i, j, k) ? 1 : 0;
  return d;
};

// Signed volume of a closed triangle soup.  Zero-ish means it is not closed;
// negative means it is inside out.
const signedVolume = (p) => {
  let v = 0;
  for (let t = 0; t + 8 < p.length; t += 9) {
    const a = [p[t], p[t + 1], p[t + 2]];
    const b = [p[t + 3], p[t + 4], p[t + 5]];
    const c = [p[t + 6], p[t + 7], p[t + 8]];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
};

// Every edge of a closed surface must be shared by exactly two triangles, in
// opposite directions.
const edgesPaired = (p) => {
  const key = (i) =>
    `${p[i].toFixed(4)},${p[i + 1].toFixed(4)},${p[i + 2].toFixed(4)}`;
  const seen = new Map();
  for (let t = 0; t + 8 < p.length; t += 9) {
    const v = [t, t + 3, t + 6].map(key);
    for (let e = 0; e < 3; e++) {
      const a = v[e],
        b = v[(e + 1) % 3];
      seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  for (const [k, count] of seen) {
    if (count !== 1) return false; // an edge used twice the same way
    const [a, b] = k.split("|");
    if ((seen.get(`${b}|${a}`) ?? 0) !== 1) return false; // no opposite twin
  }
  return true;
};

describe("turning kept voxels into a surface", () => {
  it("wraps a solid block at its true volume, right way out", () => {
    const solid = blockOf((i, j, k) => i < 3 && j < 2 && k < 4);
    const p = voxelSurface({ solid, grid });
    // 3 x 2 x 4 voxels of 10mm = 30 x 20 x 40 mm, in scene units 3 x 2 x 4.
    expect(signedVolume(p)).toBeCloseTo(24, 4);
    expect(edgesPaired(p)).toBe(true);
  });

  it("wraps a hollow shell without sealing its cavity", () => {
    // A 6^3 block with the middle 2^3 removed: two closed surfaces, and the
    // inner one must be wound the other way or the solid has no cavity.
    const solid = blockOf(
      (i, j, k) => !(i >= 2 && i < 4 && j >= 2 && j < 4 && k >= 2 && k < 4),
    );
    const p = voxelSurface({ solid, grid });
    expect(signedVolume(p)).toBeCloseTo(6 ** 3 - 2 ** 3, 4);
    expect(edgesPaired(p)).toBe(true);
  });

  it("emits nothing for an empty design", () => {
    expect(voxelSurface({ solid: blockOf(() => false), grid }).length).toBe(0);
  });
});

describe("choosing which voxels to keep", () => {
  it("keeps what the threshold says", () => {
    const d = new Float64Array(grid.nx * grid.ny * grid.nz).fill(0.4);
    d[at(1, 1, 1)] = 0.9;
    expect(solidCount(keptVoxels({ density: d, grid }))).toBe(1);
  });

  it("drops material that floats free of what is held", () => {
    // Two blocks with a gap: only the one containing the seed survives, since
    // the other would print as a loose lump.
    const density = blockOf((i) => i < 2 || i > 3);
    const all = keptVoxels({ density, grid });
    expect(solidCount(all)).toBe(4 * grid.ny * grid.nz);
    const anchored = keptVoxels({
      density,
      grid,
      seeds: [at(0, 0, 0)],
    });
    expect(solidCount(anchored)).toBe(2 * grid.ny * grid.nz);
  });
});
