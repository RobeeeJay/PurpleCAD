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

const eul = (r) => new THREE.Euler(r.x || 0, r.y || 0, r.z || 0);

// The unit normal (+Z) of a frame's rotation.
export function normalOf(rotation) {
  const n = new THREE.Vector3(0, 0, 1).applyEuler(eul(rotation));
  return { x: n.x, y: n.y, z: n.z };
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
