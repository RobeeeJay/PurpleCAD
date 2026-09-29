// meshSplit: renderer-side fallback that cuts a baked mesh into two parts along
// a plane.  A 2x2x2 cube split by the XY plane (z=0) yields a
// top half (z in [0,1]) and a bottom half (z in [-1,0]).

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { meshSplit, openLoopsOnPlane } from "../meshSplit.js";

const zRange = (positions) => {
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    mn = Math.min(mn, positions[i]);
    mx = Math.max(mx, positions[i]);
  }
  return [mn, mx];
};

describe("meshSplit", () => {
  it("cuts a cube into a +normal half and a -normal half", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.updateMatrixWorld(true);
    const res = meshSplit(mesh, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(res).toBeTruthy();
    expect(res.partA).toBeTruthy();
    expect(res.partB).toBeTruthy();

    // Parts are bbox-centred; reconstruct world z via the part position.
    const worldZ = (part) => {
      const [mn, mx] = zRange(part.geometryData.positions);
      return [mn + part.position.z, mx + part.position.z];
    };
    const [aMin, aMax] = worldZ(res.partA); // +normal side → top half
    const [bMin, bMax] = worldZ(res.partB); // -normal side → bottom half
    expect(aMin).toBeCloseTo(0, 4);
    expect(aMax).toBeCloseTo(1, 4);
    expect(bMin).toBeCloseTo(-1, 4);
    expect(bMax).toBeCloseTo(0, 4);
  });
});

// The fallback used three-bvh-csg, whose output has T-junctions all along the
// cut, so no piece came back closed -- 12 open edges on each half of a plain
// cube, thousands on a clean imported STL -- and a body fused into one later
// came out leaky.  A closed input must now give closed parts.

// Edges used by exactly one / more than two triangles, after welding by
// position (the parts carry their own index buffers, but weld anyway so a
// duplicated vertex can't hide a crack).
const topology = ({ positions, indices }) => {
  const id = new Map();
  const vid = [];
  for (let i = 0; i < positions.length; i += 3) {
    const k = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
    if (!id.has(k)) id.set(k, id.size);
    vid.push(id.get(k));
  }
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      let a = vid[indices[t + k]];
      let b = vid[indices[t + ((k + 1) % 3)]];
      if (a > b) [a, b] = [b, a];
      const key = `${a}_${b}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  let open = 0;
  let nonManifold = 0;
  for (const c of edges.values()) {
    if (c === 1) open++;
    else if (c > 2) nonManifold++;
  }
  return { open, nonManifold };
};

// Signed volume (divergence theorem): positive only when every face points out.
const volume = ({ positions: p, indices: I }) => {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => 3 * i);
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
};

// A closed torus around Z with shared seam vertices (THREE's own duplicates
// them, a hair apart, which would read as a crack).
const closedTorus = (R = 2, r = 0.5, N = 48, M = 24) => {
  const positions = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const u = (i / N) * 2 * Math.PI;
      const w = (j / M) * 2 * Math.PI;
      positions.push(
        (R + r * Math.cos(w)) * Math.cos(u),
        (R + r * Math.cos(w)) * Math.sin(u),
        r * Math.sin(w),
      );
    }
  const indices = [];
  const at = (i, j) => (i % N) * M + (j % M);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++)
      indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return new THREE.Mesh(g);
};

const XY = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };

describe("meshSplit gives closed parts", () => {
  it("halves a cube into two closed boxes", () => {
    const res = meshSplit(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)), XY);
    for (const part of [res.partA, res.partB]) {
      expect(topology(part.geometryData)).toEqual({ open: 0, nonManifold: 0 });
      expect(volume(part.geometryData)).toBeCloseTo(4, 6);
    }
  });

  it("caps a ring cut across its hole with a ring, hole and all", () => {
    // The XY plane cuts the torus into top and bottom halves; each cap is an
    // annulus -- an outline with a hole in it.
    const mesh = closedTorus();
    const whole = volume({
      positions: Array.from(mesh.geometry.getAttribute("position").array),
      indices: Array.from(mesh.geometry.index.array),
    });
    const res = meshSplit(mesh, XY);
    for (const part of [res.partA, res.partB])
      expect(topology(part.geometryData)).toEqual({ open: 0, nonManifold: 0 });
    const a = volume(res.partA.geometryData);
    const b = volume(res.partB.geometryData);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect((a + b) / whole).toBeCloseTo(1, 6);
  });

  it("caps a ring cut through its axis with two separate discs", () => {
    // The plane x = 0 crosses the tube twice: two outlines, no holes.
    const res = meshSplit(closedTorus(), {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
    });
    for (const part of [res.partA, res.partB]) {
      expect(topology(part.geometryData)).toEqual({ open: 0, nonManifold: 0 });
      expect(volume(part.geometryData)).toBeGreaterThan(0);
    }
  });

  it("leaves an open input open where it was open, and nowhere else", () => {
    // A box with no top face, cut halfway up: the cut is capped, the missing
    // top stays missing -- four open edges on the upper part, none below.
    const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const pos = g.getAttribute("position");
    const kept = [];
    for (let t = 0; t < pos.count; t += 3) {
      const allTop = [0, 1, 2].every((k) => pos.getY(t + k) > 0.99);
      if (!allTop)
        for (let k = 0; k < 3; k++)
          kept.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
    }
    const open = new THREE.BufferGeometry();
    open.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    const res = meshSplit(new THREE.Mesh(open), {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    });
    expect(topology(res.partA.geometryData).open).toBe(4);
    expect(topology(res.partB.geometryData).open).toBe(0);
  });

  it("caps two outlines that touch at a single point", () => {
    // Two blocks meeting along one vertical edge, cut across that edge: the two
    // square caps touch at a point.  Keeping one successor per vertex broke
    // both loops there and they were silently dropped, leaving the cut open.
    const box = (x0, y0) => {
      const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      g.translate(x0 + 0.5, y0 + 0.5, 0.5);
      return Array.from(g.getAttribute("position").array);
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([...box(0, 0), ...box(1, 1)], 3),
    );
    const res = meshSplit(new THREE.Mesh(g), {
      position: { x: 0, y: 0, z: 0.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    for (const part of [res.partA, res.partB]) {
      expect(topology(part.geometryData).open).toBe(0);
      expect(volume(part.geometryData)).toBeCloseTo(1, 6);
    }
  });

  it("finds both loops of a figure-eight that meets at one vertex", () => {
    // Two triangles sharing only vertex 0, all on the plane: two open loops
    // pinched at a point.  With one successor kept per vertex, one loop (or
    // both) was lost -- on a real part both survived every capping pass and
    // left the cut open.
    const loops = openLoopsOnPlane(
      [0, 1, 2, 0, 3, 4],
      new Set([0, 1, 2, 3, 4]),
    );
    expect(loops.map((l) => l.length).sort()).toEqual([3, 3]);
    const all = loops.flat().sort();
    expect(all).toEqual([0, 0, 1, 2, 3, 4]);
  });
});
