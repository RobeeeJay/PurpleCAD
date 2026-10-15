// Smoothness is a measurable property, not a matter of taste: a voxel wrapper
// emits nothing but axis-aligned faces, and an isosurface through the same
// field emits very few.  The surface still has to be closed and the right way
// out, or the body it becomes is not one.
import { describe, it, expect } from "vitest";
import { surfaceNets } from "../surfaceNets.js";
import { voxelSurface } from "../voxelMesh.js";

const grid = { origin: [0, 0, 0], h: 10, nx: 20, ny: 20, nz: 20 };

// A ball as a DENSITY field, the shape SIMP hands over: values fall smoothly
// through the half-density surface rather than jumping from 1 to 0.
const ballDensity = (rMm) => {
  const d = new Float64Array(grid.nx * grid.ny * grid.nz);
  const c = (grid.nx * grid.h) / 2;
  for (let k = 0; k < grid.nz; k++)
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const p = [i, j, k].map((v) => (v + 0.5) * grid.h - c);
        const dist = Math.hypot(...p);
        // A one-voxel transition band centred on the radius.
        d[i + grid.nx * (j + grid.ny * k)] = Math.min(
          1,
          Math.max(0, 0.5 + (rMm - dist) / grid.h),
        );
      }
  return d;
};

const tri = (p, idx, t) =>
  [0, 1, 2].map((c) => {
    const v = idx[t * 3 + c] * 3;
    return [p[v], p[v + 1], p[v + 2]];
  });

const signedVolume = ({ positions: p, indices: idx }) => {
  let v = 0;
  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = tri(p, idx, t);
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
};

// Share of faces whose normal points straight down an axis -- the signature of
// a voxel wrapper.
const axisAlignedShare = ({ positions: p, indices: idx }) => {
  let flat = 0,
    total = 0;
  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = tri(p, idx, t);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    total++;
    if (n.some((v) => Math.abs(Math.abs(v) / len - 1) < 1e-6)) flat++;
  }
  return flat / total;
};

const edgesPaired = ({ indices: idx }) => {
  const seen = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    for (let e = 0; e < 3; e++)
      seen.set(
        `${v[e]}|${v[(e + 1) % 3]}`,
        (seen.get(`${v[e]}|${v[(e + 1) % 3]}`) ?? 0) + 1,
      );
  }
  for (const [k, n] of seen) {
    if (n !== 1) return false;
    const [a, b] = k.split("|");
    if ((seen.get(`${b}|${a}`) ?? 0) !== 1) return false;
  }
  return true;
};

describe("an isosurface through the density field", () => {
  const density = ballDensity(60);
  const net = surfaceNets({ density, grid });

  it("is smooth where the voxel wrapper is not", () => {
    const solid = Uint8Array.from(density, (d) => (d >= 0.5 ? 1 : 0));
    const blocky = voxelSurface({ solid, grid });
    // The wrapper emits cube faces and nothing else.
    const blockyShare = axisAlignedShare({
      positions: blocky,
      indices: Uint32Array.from({ length: blocky.length / 3 }, (_, i) => i),
    });
    expect(blockyShare).toBeCloseTo(1, 2);
    const smoothShare = axisAlignedShare(net);
    expect(
      smoothShare,
      `${(smoothShare * 100).toFixed(1)}% of faces still axis-aligned`,
    ).toBeLessThan(0.05);
  });

  it("is closed, and the right way out", () => {
    expect(edgesPaired(net)).toBe(true);
    expect(signedVolume(net)).toBeGreaterThan(0);
  });

  it("keeps the volume the field describes", () => {
    // A 60mm ball in scene units: 4/3 pi r^3 with r = 6.
    const analytic = (4 / 3) * Math.PI * 6 ** 3;
    expect(signedVolume(net) / analytic).toBeCloseTo(1, 1);
  });

  it("smooths without collapsing the shape", () => {
    // Taubin alternates a shrinking and an expanding pass for exactly this
    // reason: repeated Laplacian smoothing would pull the ball inward.
    const raw = surfaceNets({ density, grid, smoothing: 0 });
    const heavy = surfaceNets({ density, grid, smoothing: 6 });
    expect(signedVolume(heavy) / signedVolume(raw)).toBeCloseTo(1, 1);
    expect(axisAlignedShare(heavy)).toBeLessThanOrEqual(
      axisAlignedShare(raw) + 1e-9,
    );
  });

  it("returns nothing for a field with no surface in it", () => {
    const empty = surfaceNets({
      density: new Float64Array(grid.nx * grid.ny * grid.nz),
      grid,
    });
    expect(empty.indices.length).toBe(0);
  });
});
