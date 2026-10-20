// Ray picks against large meshes through a cached BVH instead of three.js's
// brute-force Mesh.raycast, which tests every triangle in JS: 32 ms per ray on
// a 1M-triangle imported enclosure, against 0.05 ms with the BVH (built once
// in about 0.2 s).  Hover, the orbit anchor and every tool pick go through
// Mesh.raycast, so patching it reaches all of them.
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

// Below this, building a tree costs more than it saves on a few rays.
export const BVH_MIN_TRIANGLES = 5000;

// three.js's own, kept for small meshes (and for the tests to compare with).
export const bruteRaycast = THREE.Mesh.prototype.raycast;

const triangleCount = (g) =>
  (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;

// The tree for this geometry, rebuilt when its vertices or index changed in
// place: a stale tree would answer for a shape that is no longer drawn.
export function pickBvh(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const t = geometry.boundsTree;
  if (
    t &&
    t._pickPos === pos &&
    t._pickPosVersion === pos.version &&
    t._pickIndex === idx &&
    t._pickIndexVersion === (idx ? idx.version : -1)
  )
    return t;
  // Indirect, so the index buffer the renderer and the face picker read is
  // left in its original order.
  const bvh = new MeshBVH(geometry, { indirect: true });
  bvh._pickPos = pos;
  bvh._pickPosVersion = pos.version;
  bvh._pickIndex = idx;
  bvh._pickIndexVersion = idx ? idx.version : -1;
  geometry.boundsTree = bvh;
  return bvh;
}

export function fastRaycast(raycaster, intersects) {
  const g = this.geometry;
  if (
    !g?.isBufferGeometry ||
    !g.attributes.position ||
    triangleCount(g) < BVH_MIN_TRIANGLES ||
    // Skinned and morphed meshes move their vertices on the GPU.
    this.isSkinnedMesh ||
    g.morphAttributes?.position?.length
  ) {
    if (g?.boundsTree) g.boundsTree = undefined;
    return bruteRaycast.call(this, raycaster, intersects);
  }
  pickBvh(g);
  return acceleratedRaycast.call(this, raycaster, intersects);
}

THREE.Mesh.prototype.raycast = fastRaycast;
