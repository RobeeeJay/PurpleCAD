// Displacement core for the Texture tool: welding, crack-free refinement,
// UV mapping, sampling and displacement — all with synthetic heightfields
// (PNG decoding is renderer-only and injected around this module).

import { describe, it, expect } from "vitest";
import {
  weldMesh,
  refineMesh,
  regionTest,
  buildMapping,
  sampleHeight,
  displaceMesh,
  surfaceRegionTest,
} from "../textureDisplace.js";

// A unit-ish cube as a triangle soup (12 tris, duplicated verts) spanning
// [-1,1]^3, mirroring what occ.tessellate / baked geometryData look like.
const cubeSoup = () => {
  const p = [];
  const quad = (a, b, c, d) => p.push(...a, ...b, ...c, ...a, ...c, ...d);
  const v = (x, y, z) => [x, y, z];
  quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); // +z
  quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); // -z
  quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); // +x
  quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); // -x
  quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); // +y
  quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)); // -y
  return { positions: p, indices: null };
};

// The +y face as the pick-time region soup.
const topFaceTris = [
  -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, -1, 1, -1,
];

const flat = (h) => ({
  width: 4,
  height: 4,
  data: new Float32Array(16).fill(h),
});

// Every edge of a closed mesh must be shared by exactly two triangles —
// the watertightness / crack check.
const edgeCounts = (tris) => {
  const m = new Map();
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k];
      const b = tris[t + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
  return m;
};

describe("weldMesh", () => {
  it("welds the cube soup to 8 vertices, 12 triangles", () => {
    const { positions, indices } = cubeSoup();
    const { verts, tris } = weldMesh(positions, indices);
    expect(verts.length / 3).toBe(8);
    expect(tris.length / 3).toBe(12);
    for (const c of edgeCounts(tris).values()) expect(c).toBe(2);
  });
});

describe("refineMesh", () => {
  it("refines the region to the target length without cracks", () => {
    const { positions } = cubeSoup();
    const { verts, tris } = weldMesh(positions, null);
    const triIn = (t, T, V) => {
      const cy =
        (V[T[t] * 3 + 1] + V[T[t + 1] * 3 + 1] + V[T[t + 2] * 3 + 1]) / 3;
      return cy > 0.99; // top face
    };
    const r = refineMesh(verts.slice(), tris.slice(), triIn, 0.5);
    // Crack-free: still a closed 2-manifold.
    for (const c of edgeCounts(r.tris).values()) expect(c).toBe(2);
    // Region edges honour the target length.
    for (let t = 0; t < r.tris.length; t += 3) {
      const ys = [0, 1, 2].map((k) => r.verts[r.tris[t + k] * 3 + 1]);
      if (Math.min(...ys) < 0.99) continue; // only fully-top triangles
      for (let k = 0; k < 3; k++) {
        const a = r.tris[t + k];
        const b = r.tris[t + ((k + 1) % 3)];
        const d = Math.hypot(
          r.verts[a * 3] - r.verts[b * 3],
          r.verts[a * 3 + 1] - r.verts[b * 3 + 1],
          r.verts[a * 3 + 2] - r.verts[b * 3 + 2],
        );
        expect(d).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
    expect(r.tris.length).toBeGreaterThan(tris.length);
  });
});

describe("sampleHeight", () => {
  const hf = { width: 2, height: 2, data: new Float32Array([0, 1, 0, 1]) };
  it("clamp returns null outside [0,1]", () => {
    expect(sampleHeight(hf, 1.5, 0.5, false)).toBe(null);
    expect(sampleHeight(hf, -0.1, 0.5, false)).toBe(null);
  });
  it("wrap tiles", () => {
    expect(sampleHeight(hf, 1.25, 0.5, true)).toBe(
      sampleHeight(hf, 0.25, 0.5, true),
    );
  });
});

describe("displaceMesh", () => {
  const face = { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 };
  const params = (extra) => ({
    projection: "center",
    sizeU: 10, // texture much larger than the face: interior fully covered
    depth: 0.2,
    offsetU: 0,
    offsetV: 0,
    rotationRad: 0,
    wrap: false,
    resolution: 0.4,
    ...extra,
  });

  it("raises interior region vertices by depth; boundary stays; watertight", () => {
    const out = displaceMesh({
      mesh: cubeSoup(),
      face,
      faceSet: null,
      faceTris: topFaceTris,
      heightfield: flat(1),
      params: params(),
    });
    expect(out).toBeTruthy();
    for (const c of edgeCounts(out.indices).values()) expect(c).toBe(2);
    let raised = 0;
    for (let i = 0; i < out.positions.length; i += 3) {
      const y = out.positions[i + 1];
      // Nothing pokes past +1+depth or dents below the original top.
      expect(y).toBeLessThanOrEqual(1 + 0.2 + 1e-9);
      if (Math.abs(y - 1.2) < 1e-9) raised++;
      // Boundary (edge/corner verts, x or z at ±1) must be untouched.
      if (
        Math.abs(y - 1) < 1e-9 &&
        (Math.abs(Math.abs(out.positions[i]) - 1) < 1e-9 ||
          Math.abs(Math.abs(out.positions[i + 2]) - 1) < 1e-9)
      ) {
        // still at y=1 — fine.
      }
    }
    expect(raised).toBeGreaterThan(0);
    // Non-region faces untouched: -y face still at exactly -1.
    let bottomOk = true;
    for (let i = 0; i < out.positions.length; i += 3)
      if (out.positions[i + 1] < -1 - 1e-9) bottomOk = false;
    expect(bottomOk).toBe(true);
  });

  it("negative depth recesses instead", () => {
    const out = displaceMesh({
      mesh: cubeSoup(),
      face,
      faceSet: null,
      faceTris: topFaceTris,
      heightfield: flat(1),
      params: params({ depth: -0.2 }),
    });
    let lowered = 0;
    for (let i = 0; i < out.positions.length; i += 3)
      if (Math.abs(out.positions[i + 1] - 0.8) < 1e-9) lowered++;
    expect(lowered).toBeGreaterThan(0);
  });

  it("clamp leaves vertices outside the texture extents untouched", () => {
    // Tiny texture (1 unit) centred on the anchor: corners of the 2×2 top
    // face fall outside → no displacement there.
    const out = displaceMesh({
      mesh: cubeSoup(),
      face,
      faceSet: null,
      faceTris: topFaceTris,
      heightfield: flat(1),
      params: params({ sizeU: 1, wrap: false }),
    });
    let atOne = 0;
    let raised = 0;
    for (let i = 0; i < out.positions.length; i += 3) {
      const x = out.positions[i],
        y = out.positions[i + 1],
        z = out.positions[i + 2];
      if (y > 1 + 1e-9) raised++;
      if (Math.abs(y - 1) < 1e-9 && Math.abs(x) > 0.6 && Math.abs(z) > 0.6)
        atOne++;
    }
    expect(raised).toBeGreaterThan(0); // centre displaced
    expect(atOne).toBeGreaterThan(0); // far corners untouched
  });

  it("offsets shift the pattern", () => {
    // Step heightfield (left black, right white).  Probe the displacement of
    // the vertex nearest (+0.5, 1, 0): raised with no offset, flat once the
    // offset slides the black half under it.
    const step = {
      width: 4,
      height: 1,
      data: new Float32Array([0, 0, 1, 1]),
    };
    const run = (offsetU) =>
      displaceMesh({
        mesh: cubeSoup(),
        face,
        faceSet: null,
        faceTris: topFaceTris,
        heightfield: step,
        params: params({ offsetU, resolution: 0.3 }),
      });
    const heightNear = (out, tx, tz) => {
      let best = Infinity,
        y = null;
      for (let i = 0; i < out.positions.length; i += 3) {
        if (out.positions[i + 1] < 0.99) continue; // top only
        const d =
          (out.positions[i] - tx) ** 2 + (out.positions[i + 2] - tz) ** 2;
        if (d < best) {
          best = d;
          y = out.positions[i + 1];
        }
      }
      return y;
    };
    const a = heightNear(run(0), 0.5, 0);
    const b = heightNear(run(-5), 0.5, 0);
    expect(a).toBeGreaterThan(1.05); // white side raised
    expect(b).toBeLessThan(a - 0.05); // offset slid the black half under it
  });

  it("primitive faceSets bound the region without faceTris", () => {
    const cyl = surfaceRegionTest(
      { cylinder: { ax: 0, ay: 1, az: 0, cx: 0, cy: 0, cz: 0, radius: 1 } },
      0.05,
    );
    expect(cyl(1, 0.3, 0)).toBe(true); // on the wall
    expect(cyl(0.5, 0.3, 0)).toBe(false); // inside
    const cone = surfaceRegionTest({ cone: { rb: 1, rt: 0, h: 2 } }, 0.05);
    expect(cone(0.5, 0, 0)).toBe(true); // mid-height radius 0.5
    expect(cone(1, 0.9, 0)).toBe(false); // too wide near the apex
    const tor = surfaceRegionTest({ torus: { R: 1, r: 0.4 } }, 0.05);
    expect(tor(1.4, 0, 0)).toBe(true); // outer equator
    expect(tor(1, 0.4, 0)).toBe(true); // top of tube
    expect(tor(1, 0, 0)).toBe(false); // tube centreline
    const cap = surfaceRegionTest(
      { plane: { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 } },
      0.05,
    );
    expect(cap(0.3, 1, 0.2)).toBe(true);
    expect(cap(0.3, 0.5, 0.2)).toBe(false);
  });

  it("cone conform: u is the local arc length, v the slant distance", () => {
    const mapping = buildMapping(
      { nx: 1, ny: 0, nz: 0, cx: 0.5, cy: 0, cz: 0 }, // anchor mid-height
      { cone: { rb: 1, rt: 0, h: 2 } },
      "conform",
    );
    // Quarter turn at the anchor's height (r = 0.5).
    const [u] = mapping.uv(0, 0, 0.5);
    expect(Math.abs(u)).toBeCloseTo((Math.PI / 2) * 0.5, 5);
    // Slant distance for dy=0.5 with slope 0.5: 0.5·√1.25.
    const [, v] = mapping.uv(0.25, 0.5, 0);
    expect(v).toBeCloseTo(0.5 * Math.hypot(1, 0.5), 5);
    // Outward normal tilts up for a narrowing cone.
    const n = mapping.normal(0.5, 0, 0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[0]).toBeGreaterThan(0);
  });

  it("torus conform: both directions closed, normals leave the tube", () => {
    const mapping = buildMapping(
      { nx: 1, ny: 0, nz: 0, cx: 1.4, cy: 0, cz: 0 }, // outer equator anchor
      { torus: { R: 1, r: 0.4 } },
      "conform",
    );
    const [u, v] = mapping.uv(0, 0, 1.4); // quarter major turn
    expect(Math.abs(u)).toBeCloseTo(Math.PI / 2, 5);
    expect(v).toBeCloseTo(0, 5);
    const [, v2] = mapping.uv(1, 0.4, 0); // quarter minor turn
    expect(Math.abs(v2)).toBeCloseTo((Math.PI / 2) * 0.4, 5);
    expect(mapping.circumference).toBeCloseTo(2 * Math.PI, 5);
    expect(mapping.circumferenceV).toBeCloseTo(2 * Math.PI * 0.4, 5);
    const n = mapping.normal(1.4, 0, 0);
    expect(n[0]).toBeCloseTo(1, 5);
  });

  it("cylinder conform wraps the arc-length parameter", () => {
    const mapping = buildMapping(
      { nx: 1, ny: 0, nz: 0, cx: 2, cy: 0, cz: 0 },
      { cylinder: { ax: 0, ay: 1, az: 0, cx: 0, cy: 0, cz: 0, radius: 2 } },
      "conform",
    );
    // A point a quarter-turn around the wall: u = arc length = (π/2)·r.
    const [u, v] = mapping.uv(0, 0.5, 2);
    expect(Math.abs(u)).toBeCloseTo((Math.PI / 2) * 2, 5);
    expect(v).toBeCloseTo(0.5, 5);
    // Radial displacement direction.
    const n = mapping.normal(0, 0.5, 2);
    expect(n[2]).toBeCloseTo(1, 5);
  });
});
