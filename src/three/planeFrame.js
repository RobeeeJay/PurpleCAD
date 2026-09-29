// Geometry helpers for the Plane object: deriving a plane frame from three
// points and applying the creation dialog's rotation + offset adjustments.

import * as THREE from "three";

// A plane frame { position, rotation } from three world points (origin at their
// centroid, +Z along the plane normal, +X along p0→p1).  Returns null when the
// points are coincident/collinear.
export function frameFromPoints(p0, p1, p2) {
  const a = new THREE.Vector3(p0.x, p0.y, p0.z);
  const b = new THREE.Vector3(p1.x, p1.y, p1.z);
  const c = new THREE.Vector3(p2.x, p2.y, p2.z);
  const x = b.clone().sub(a);
  if (x.lengthSq() < 1e-12) return null;
  x.normalize();
  const n = b.clone().sub(a).cross(c.clone().sub(a));
  if (n.lengthSq() < 1e-12) return null;
  n.normalize();
  const y = n.clone().cross(x).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, n),
  );
  const o = a
    .clone()
    .add(b)
    .add(c)
    .multiplyScalar(1 / 3);
  return {
    position: { x: o.x, y: o.y, z: o.z },
    rotation: { x: e.x, y: e.y, z: e.z },
  };
}

// A plane frame { position, rotation } from a world point and a world normal
// (+Z aligned to the normal; +X chosen perpendicular).  Used to seed a Plane
// from a picked object face.  Returns null when the normal is degenerate.
export function frameFromPointNormal(point, normal) {
  const n = new THREE.Vector3(normal.x, normal.y, normal.z);
  if (n.lengthSq() < 1e-12) return null;
  n.normalize();
  // Any axis not parallel to n works as the seed for +X.
  const ref =
    Math.abs(n.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const x = ref.sub(n.clone().multiplyScalar(ref.dot(n))).normalize();
  const y = n.clone().cross(x).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, n),
  );
  return {
    position: { x: point.x, y: point.y, z: point.z },
    rotation: { x: e.x, y: e.y, z: e.z },
  };
}

// A plane frame lying exactly on a clicked triangle (world corners a, b, c),
// through the click point projected onto it.  The raycast's hit point sits a
// float32 hair off the face -- about 1e-6 on a real STL -- and a split plane
// that close to a face grazes it inside OCC's tolerances: on mms2_base the
// difference half came back empty, 1e-6 from a face where the exact plane
// split cleanly.  `towards` orients the normal (the face normal the pick
// already computed, which accounts for mirrored transforms).  Null when the
// triangle is degenerate.
export function frameFromFaceHit(point, a, b, c, towards) {
  const n = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  if (n.lengthSq() < 1e-24) return null;
  n.normalize();
  if (towards && n.dot(towards) < 0) n.negate();
  const p = new THREE.Vector3(point.x, point.y, point.z);
  p.addScaledVector(n, -new THREE.Vector3().subVectors(p, a).dot(n));
  return frameFromPointNormal(p, n);
}

const eul = (r) => new THREE.Euler(r.x || 0, r.y || 0, r.z || 0);

// The unit normal (+Z) of a frame's rotation.
export function normalOf(rotation) {
  const n = new THREE.Vector3(0, 0, 1).applyEuler(eul(rotation));
  return { x: n.x, y: n.y, z: n.z };
}

// Does a frame's plane pass THROUGH a body, given the body's world vertices as a
// flat [x,y,z,...] array?  True only when vertices lie clearly on both sides.
// A face of the body itself has every vertex on one side or in the plane, so it
// cuts nothing -- the split tool used to accept it and hand back a renamed copy.
// `tol` absorbs float noise in vertices that sit on the plane.
export function planeCrossesPoints(frame, positions, tol = 1e-6) {
  const n = normalOf(frame.rotation);
  const o = frame.position;
  let above = false;
  let below = false;
  for (let i = 0; i < positions.length; i += 3) {
    const d =
      (positions[i] - o.x) * n.x +
      (positions[i + 1] - o.y) * n.y +
      (positions[i + 2] - o.z) * n.z;
    if (d > tol) above = true;
    else if (d < -tol) below = true;
    if (above && below) return true;
  }
  return false;
}

// Apply the dialog's per-axis rotation (degrees, in the plane's local frame) and
// an offset along the resulting normal to a base frame → the final
// { position, rotation } stored on the plane item.
export function applyPlaneAdjust(base, rotDeg, offset) {
  const baseQ = new THREE.Quaternion().setFromEuler(eul(base.rotation));
  const offQ = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(rotDeg?.x || 0),
      THREE.MathUtils.degToRad(rotDeg?.y || 0),
      THREE.MathUtils.degToRad(rotDeg?.z || 0),
    ),
  );
  const finalQ = baseQ.clone().multiply(offQ);
  const e = new THREE.Euler().setFromQuaternion(finalQ);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(finalQ);
  const pos = new THREE.Vector3(
    base.position.x,
    base.position.y,
    base.position.z,
  ).add(normal.multiplyScalar(offset || 0));
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: e.x, y: e.y, z: e.z },
  };
}
