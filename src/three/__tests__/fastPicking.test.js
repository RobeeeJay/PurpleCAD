// Picking a big mesh: the BVH ray and the hover caches must answer exactly
// what the brute-force versions did, and must never answer for a shape that
// has since changed under them.  A 1M-triangle import spent 32 ms per ray and
// seconds per hover before these, so both run on every mouse move.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  fastRaycast,
  bruteRaycast,
  BVH_MIN_TRIANGLES,
} from "../fastRaycast.js";
import {
  meshTopology,
  growFace,
  featureEdges,
  nearestSegment,
} from "../meshPickCache.js";
import { computeSegmentChain } from "../segmentChain.js";

// Twenty rays from around a mesh towards points near its middle.
const rays = (size) =>
  Array.from({ length: 20 }, (_, i) => {
    const o = new THREE.Vector3(
      size * 3 * Math.cos(i),
      size * (i % 5) * 0.4 - size,
      size * 3 * Math.sin(i),
    );
    const t = new THREE.Vector3((i % 3) * 0.1, (i % 4) * 0.1, 0);
    return new THREE.Ray(o, t.sub(o).normalize());
  });

const hitsOf = (mesh, ray, cast) => {
  const rc = new THREE.Raycaster(ray.origin, ray.direction);
  const out = [];
  cast.call(mesh, rc, out);
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, 1).map((h) => ({
    faceIndex: h.faceIndex,
    distance: +h.distance.toFixed(9),
  }));
};

describe("picking through the BVH", () => {
  it("hits the same triangle at the same distance as the brute-force ray", () => {
    const g = new THREE.TorusKnotGeometry(1, 0.3, 400, 32);
    expect(g.index.count / 3).toBeGreaterThan(BVH_MIN_TRIANGLES);
    const indexBefore = g.index.array.slice();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const plain = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial());
    for (const ray of rays(1.5)) {
      const fast = hitsOf(mesh, ray, fastRaycast);
      const slow = hitsOf(plain, ray, bruteRaycast);
      expect(fast, "first hit through the BVH").toEqual(slow);
    }
    // The renderer and the face picker read this index; an in-place reorder
    // would scramble both.
    expect(g.index.array).toEqual(indexBefore);
  });

  it("rebuilds its tree when the vertices move in place", () => {
    const g = new THREE.SphereGeometry(1, 96, 64);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    const down = (x) =>
      new THREE.Ray(new THREE.Vector3(x, 0, 10), new THREE.Vector3(0, 0, -1));
    expect(hitsOf(mesh, down(0), fastRaycast)[0].distance).toBeCloseTo(9, 2);
    // Move the sphere 3 sideways, as an edit that rewrites the buffer would.
    // A stale tree's boxes are still round the old place, so a ray through
    // the new one finds nothing.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + 3);
    p.needsUpdate = true;
    g.computeBoundingSphere();
    const d = hitsOf(mesh, down(3), fastRaycast)[0]?.distance;
    expect(d, `hit distance after the move: ${d}`).toBeCloseTo(9, 2);
  });
});

describe("the hover caches", () => {
  it("grow a cylinder's side as one face and stop at its rims", () => {
    const g = new THREE.CylinderGeometry(1, 1, 2, 64, 4);
    const topo = meshTopology(g);
    // A side triangle: its normal has no y.
    let seed = 0;
    while (Math.abs(topo.normals[3 * seed + 1]) > 0.1) seed++;
    const face = growFace(topo, seed, Math.cos((30 * Math.PI) / 180));
    const sides = [];
    for (let t = 0; t < topo.triCount; t++)
      if (Math.abs(topo.normals[3 * t + 1]) < 0.1) sides.push(t);
    expect(face.sort((a, b) => a - b)).toEqual(sides);
  });

  it("walk the same edge chain with the endpoint lookup as without it", () => {
    const g = new THREE.CylinderGeometry(1, 1, 2, 48);
    const { segs, near } = featureEdges(g);
    const start = nearestSegment(segs, 1, 1, 0).index;
    const indexed = computeSegmentChain(segs, start, 30, near);
    const scanned = computeSegmentChain(segs, start, 30);
    expect(indexed.length, "a rim of 48 segments").toBe(48);
    expect([...indexed].sort((a, b) => a - b)).toEqual(
      [...scanned].sort((a, b) => a - b),
    );
  });

  it("are built once per geometry, and again after it changes", () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    expect(meshTopology(g)).toBe(meshTopology(g));
    expect(featureEdges(g)).toBe(featureEdges(g));
    const before = featureEdges(g);
    g.attributes.position.needsUpdate = true;
    expect(featureEdges(g)).not.toBe(before);
  });
});
