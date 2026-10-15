// Collision between a moving component's bodies and everything else, for the
// component motion animation.  Built on three-mesh-bvh: each body's geometry
// gets a bounding-volume hierarchy once, and a check casts one hierarchy
// against another under their current relative transform.
//
// Two rules keep ordinary assemblies from "colliding" all the time:
//  - Faces lying flat against each other (a part resting on another) are
//    contact, not collision: only surfaces that CROSS count.  The BVH reports
//    coplanar triangles as intersecting too, and gives no crossing line for
//    them, so they are skipped; and where two touching bodies' faces meet
//    along a shared edge the "crossing" runs only along both triangles'
//    borders, so a crossing must pass through the inside of at least one.
//  - Contact that already exists at rest -- a pin in its hole, whose two
//    cylinders' facets cross everywhere -- is recorded when the animation
//    starts (restContacts) and ignored for that pair.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { primitiveDimensions } from "./sceneObjects/dimensions.js";

const PRIMITIVES = ["sphere", "cylinder", "torus", "cone"];

// The real surface of a body.  Most meshes are their surface; the analytic
// primitives are drawn by a shader on a bounding box, so they get a stand-in
// built from their dimensions, as the wireframe view does.
export function collisionGeometry(mesh, item) {
  if (!PRIMITIVES.includes(item?.type)) return mesh.geometry;
  const d = primitiveDimensions(item);
  switch (item.type) {
    case "sphere":
      return new THREE.SphereGeometry(d.radius, 32, 16);
    case "cylinder":
      return new THREE.CylinderGeometry(d.radius, d.radius, d.height, 32);
    case "cone":
      return new THREE.CylinderGeometry(
        d.radiusTop,
        d.radiusBottom,
        d.height,
        32,
      );
    default:
      return new THREE.TorusGeometry(d.major, d.minor, 16, 48);
  }
}

// One BVH per geometry, kept on the geometry itself so a body that doesn't
// change isn't re-indexed every frame.  Indirect, so the BVH keeps its own
// triangle order: by default it reorders the geometry's index in place, and
// this is the rendered mesh's own geometry, which picking reads.
export function bvhFor(geometry) {
  if (!geometry.userData.collisionBvh)
    geometry.userData.collisionBvh = new MeshBVH(geometry, { indirect: true });
  return geometry.userData.collisionBvh;
}

const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _bary = new THREE.Vector3();

// Is p strictly inside the triangle, not on or past an edge?
const inside = (tri, p) => {
  tri.getBarycoord(p, _bary);
  const eps = 1e-6;
  return _bary.x > eps && _bary.y > eps && _bary.z > eps;
};

// Where two bodies' surfaces cross, or null.  Each body is { geometry,
// matrixWorld }.  The point is the centre of the crossing, weighted by length,
// so a long seam counts for more than a pinprick.
export function crossingCentre(a, b) {
  const bvhA = bvhFor(a.geometry);
  const bvhB = bvhFor(b.geometry);
  // b's geometry into a's local frame.
  const bToA = new THREE.Matrix4()
    .copy(a.matrixWorld)
    .invert()
    .multiply(b.matrixWorld);
  if (!bvhA.intersectsGeometry(b.geometry, bToA)) return null;
  const sum = new THREE.Vector3();
  let weight = 0;
  bvhA.bvhcast(bvhB, bToA, {
    intersectsTriangles(t1, t2) {
      t1.getNormal(_n1);
      t2.getNormal(_n2);
      if (Math.abs(_n1.dot(_n2)) > 1 - 1e-9) return false; // flat contact
      if (!t1.intersectsTriangle(t2, _line)) return false;
      const len = _line.distance();
      if (!(len > 1e-9)) return false;
      _line.getCenter(_mid);
      if (!inside(t1, _mid) && !inside(t2, _mid)) return false; // edge contact
      sum.addScaledVector(_mid, len);
      weight += len;
      return false;
    },
  });
  if (!(weight > 0)) return null;
  return sum.multiplyScalar(1 / weight).applyMatrix4(a.matrixWorld);
}

const pairKey = (a, b) => `${a}|${b}`;

// Pairs (moving id, static id) whose surfaces already cross at rest.
export function restContacts(moving, others) {
  const found = new Set();
  for (const m of moving)
    for (const o of others)
      if (crossingCentre(m, o)) found.add(pairKey(m.id, o.id));
  return found;
}

// The first new collision between a moving body and a static one, as
// { point, movingId, otherId }, or null.  Bodies are { id, geometry,
// matrixWorld }; `ignore` is restContacts' set.  Bounding boxes are compared
// first so distant bodies cost nothing.
export function findCollision(moving, others, ignore = new Set()) {
  const boxA = new THREE.Box3();
  const boxB = new THREE.Box3();
  for (const m of moving) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    boxA.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    for (const o of others) {
      if (ignore.has(pairKey(m.id, o.id))) continue;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      boxB.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (!boxA.intersectsBox(boxB)) continue;
      const point = crossingCentre(m, o);
      if (point) return { point, movingId: m.id, otherId: o.id };
    }
  }
  return null;
}
