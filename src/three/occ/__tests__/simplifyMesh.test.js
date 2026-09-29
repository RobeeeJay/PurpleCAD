// The native simplify (meshoptimizer, vendored).  Its promises are the point
// of it: the result stays within the deviation asked for -- a bound checked
// here against brute force, because meshoptimizer's own error estimate ran to
// three times the request on a real part and probing only vertices and
// midpoints missed deviation inside the triangles -- it stays closed, and it
// never pinches two sheets of the surface together.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A closed UV sphere: poles and seam shared, as a good STL is once welded.
const sphere = (r = 1, seg = 48) => {
  const positions = [0, r, 0];
  for (let i = 1; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const v = (i / seg) * Math.PI;
      const u = (j / seg) * 2 * Math.PI;
      positions.push(
        r * Math.sin(v) * Math.cos(u),
        r * Math.cos(v),
        r * Math.sin(v) * Math.sin(u),
      );
    }
  positions.push(0, -r, 0);
  const south = positions.length / 3 - 1;
  const at = (i, j) =>
    i === 0 ? 0 : i === seg ? south : 1 + (i - 1) * seg + (j % seg);
  const indices = [];
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      if (i !== 0) indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
      if (i !== seg - 1)
        indices.push(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
    }
  return { positions, indices };
};

// The same surface as an STL stores it: three private vertices per triangle.
const soup = ({ positions, indices }) => ({
  positions: indices.flatMap((i) => positions.slice(3 * i, 3 * i + 3)),
  indices: null,
});

const torus = (R, r, nu, nv) => {
  const positions = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const u = (i / nu) * 2 * Math.PI;
      const v = (j / nv) * 2 * Math.PI;
      positions.push(
        (R + r * Math.cos(v)) * Math.cos(u),
        r * Math.sin(v),
        (R + r * Math.cos(v)) * Math.sin(u),
      );
    }
  const at = (i, j) => (i % nu) * nv + (j % nv);
  const indices = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++)
      indices.push(
        at(i, j),
        at(i, j + 1),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i + 1, j),
      );
  return { positions, indices };
};

// A cube whose faces are each an n x n grid: all that detail is flat.
const gridCube = (n) => {
  const positions = [];
  const seen = new Map();
  const v = (p) => {
    const k = p.join();
    if (!seen.has(k)) {
      seen.set(k, positions.length / 3);
      positions.push(...p);
    }
    return seen.get(k);
  };
  const g = (i) => -1 + (2 * i) / n;
  const indices = [];
  // Each face: a fixed axis and sign, and two in-plane axes wound outward.
  for (const [axis, s] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ]) {
    const [a, b] =
      s > 0
        ? [(axis + 1) % 3, (axis + 2) % 3]
        : [(axis + 2) % 3, (axis + 1) % 3];
    const point = (i, j) => {
      const p = [0, 0, 0];
      p[axis] = s;
      p[a] = g(i);
      p[b] = g(j);
      return v(p);
    };
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        indices.push(
          point(i, j),
          point(i + 1, j),
          point(i + 1, j + 1),
          point(i, j),
          point(i + 1, j + 1),
          point(i, j + 1),
        );
  }
  return { positions, indices };
};

// Brute force: the largest distance from area-weighted random points (and
// every vertex) of one surface to the other, by checking every triangle.
function pointTriangle(p, a, b, c) {
  const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  const at = (s, t) => [0, 1, 2].map((k) => a[k] + s * ab[k] + t * ac[k]);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const cp = sub(p, c);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = at(d1 / (d1 - d3), 0);
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = at(0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      q = [0, 1, 2].map((k) => b[k] + w * (c[k] - b[k]));
    } else {
      const den = 1 / (va + vb + vc);
      q = at(vb * den, vc * den);
    }
  }
  const d = sub(p, q);
  return Math.sqrt(dot(d, d));
}
const triangles = ({ positions, indices }) => {
  const I =
    indices ?? positions.map((_, i) => i).slice(0, positions.length / 3);
  const out = [];
  for (let t = 0; t < I.length; t += 3)
    out.push(
      [0, 1, 2].map((k) => positions.slice(3 * I[t + k], 3 * I[t + k] + 3)),
    );
  return out;
};
let seed = 11;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const samplePoints = (T, n) => {
  const pts = T.flat();
  for (let i = 0; i < n; i++) {
    const [a, b, c] = T[Math.floor(random() * T.length)];
    let u = random();
    let w = random();
    if (u + w > 1) [u, w] = [1 - u, 1 - w];
    pts.push(
      [0, 1, 2].map((k) => a[k] + u * (b[k] - a[k]) + w * (c[k] - a[k])),
    );
  }
  return pts;
};
const farthest = (points, T) => {
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (const [a, b, c] of T) {
      best = Math.min(best, pointTriangle(p, a, b, c));
      if (best <= worst) break;
    }
    worst = Math.max(worst, best);
  }
  return worst;
};
const bruteDeviation = (before, after) => {
  const A = triangles(before);
  const B = triangles(after);
  return Math.max(
    farthest(samplePoints(A, 3000), B),
    farthest(samplePoints(B, 3000), A),
  );
};

describe("simplifyMesh", () => {
  it("keeps a sphere within the deviation it was given, checked by brute force", () => {
    const input = sphere(1, 48);
    const r = ops.simplifyMesh({ ...input, mode: "deviation", value: 0.01 });
    expect(r.trianglesAfter).toBeLessThan(r.trianglesBefore * 0.8);
    expect(r.maxDeviation).toBeLessThanOrEqual(0.01);
    const brute = bruteDeviation(input, r);
    // The reported figure is a bound: nothing found by sampling may exceed it.
    expect(
      brute,
      `brute force ${brute} against the reported bound ${r.maxDeviation}`,
    ).toBeLessThanOrEqual(r.maxDeviation * (1 + 1e-9));
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
  }, 120000);

  it("welds an STL's triangle soup before simplifying it", () => {
    // Unwelded, no two triangles share a vertex and there is nothing to
    // collapse.
    const r = ops.simplifyMesh({
      ...soup(sphere(1, 32)),
      mode: "deviation",
      value: 0.01,
    });
    expect(r.trianglesAfter).toBeLessThan(r.trianglesBefore * 0.8);
    expect(r.openEdges).toBe(0);
  });

  it("collapses flat detail without moving the surface", () => {
    // 0.01 mm.  Much finer and meshoptimizer's own estimate stops it early:
    // it prices sliding a vertex along a straight crease, which moves nothing.
    const r = ops.simplifyMesh({
      ...gridCube(8),
      mode: "deviation",
      value: 1e-3,
    });
    expect(r.trianglesBefore).toBe(768);
    expect(r.trianglesAfter).toBe(12);
    expect(r.maxDeviation).toBe(0);
    expect(r.openEdges).toBe(0);
  });

  it("reaches a triangle count and bounds how far that moved the surface", () => {
    const input = sphere(1, 32);
    const r = ops.simplifyMesh({ ...input, mode: "triangles", value: 200 });
    expect(r.trianglesAfter).toBeLessThanOrEqual(200);
    const brute = bruteDeviation(input, r);
    expect(
      brute,
      `brute force ${brute} against the reported bound ${r.maxDeviation}`,
    ).toBeLessThanOrEqual(r.maxDeviation * (1 + 1e-9));
    // A bound, but not a wild one.
    expect(r.maxDeviation).toBeLessThan(brute * 3);
  }, 120000);

  it("never pinches two sheets of the surface together", () => {
    // A torus with a tiny hole, cut to 200 triangles: plain simplification
    // closes the hole into edges shared by four triangles (three here; up to
    // 31 on a real part).
    const r = ops.simplifyMesh({
      ...torus(1, 0.98, 80, 40),
      mode: "triangles",
      value: 200,
    });
    expect(r.nonManifoldEdges, "pinched edges").toBe(0);
    expect(r.openEdges).toBe(0);
  });

  it("leaves an open mesh's border where it was", () => {
    // The northern half of a sphere: its rim is open.  Simplifying must not
    // move or close it -- that would reshape the hole, not the surface.
    const full = sphere(1, 32);
    const half = { positions: full.positions, indices: [] };
    for (let t = 0; t < full.indices.length; t += 3) {
      const tri = full.indices.slice(t, t + 3);
      if (tri.every((i) => full.positions[3 * i + 1] >= -1e-12))
        half.indices.push(...tri);
    }
    const before = ops.weldMesh(half);
    const r = ops.simplifyMesh({ ...half, mode: "deviation", value: 0.01 });
    expect(r.openEdges).toBe(before.openEdges);
    expect(r.trianglesAfter).toBeLessThan(r.trianglesBefore);
  });

  it("rejects a mode it doesn't know", () => {
    expect(() =>
      ops.simplifyMesh({ ...sphere(1, 8), mode: "fast", value: 1 }),
    ).toThrow(/mode must be deviation or triangles/);
  });
});
