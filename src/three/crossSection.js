// Clip plane for the cross-section view.  Mutated in place each frame so the
// material.clippingPlanes references that point at it stay valid.
//
// The home-view cut is the world ZY plane (x=0) with normal -X, seen from
// (10,10,10).  Rather than leaving it fixed in world space, the plane is
// LOCKED TO THE CAMERA: its normal is stored in the home camera's local frame
// and re-projected through the live camera each frame, so the section moves
// with the view (the same relative cut, whatever angle you orbit to).
//
// Kept half-space: normal·p + constant >= 0 (the far side; the camera side is
// clipped away).

import * as THREE from "three";

export const CROSS_SECTION_PLANE = new THREE.Plane(
  new THREE.Vector3(-1, 0, 0),
  0,
);

const _homeQuat = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().lookAt(
    new THREE.Vector3(10, 10, 10),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ),
);
// World -X expressed in the home camera's local frame.
const _localNormal = new THREE.Vector3(-1, 0, 0)
  .applyQuaternion(_homeQuat.clone().invert())
  .normalize();

const _n = new THREE.Vector3();

// Re-pose the plane from an ORIENTATION quaternion (the camera's, or — while the
// camera is frozen in cross-section mode — one built from the live orbit angles
// so the cut rotates while the view stays put).  It passes through the orbit
// `target`, so panning translates the cut.  Call once per frame while active.
export function updateCrossSectionPlane(orientQuat, target) {
  _n.copy(_localNormal).applyQuaternion(orientQuat).normalize();
  CROSS_SECTION_PLANE.normal.copy(_n);
  CROSS_SECTION_PLANE.constant = target ? -_n.dot(target) : 0;
}

// Camera-orientation quaternion for a pair of orbit angles — the same pose the
// navigation would give the camera.  Used to spin the cut plane from the orbit
// gesture while the camera itself is held frozen.
const _ZERO = new THREE.Vector3(0, 0, 0);
const _UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
export function orientationFromAngles(rotX, rotY) {
  _dir.set(
    Math.sin(rotY) * Math.cos(rotX),
    Math.sin(rotX),
    Math.cos(rotY) * Math.cos(rotX),
  );
  _m.lookAt(_dir, _ZERO, _UP);
  return _q.setFromRotationMatrix(_m);
}

// The plane in VIEW space (for the analytic primitive shaders, which test their
// computed surface point — already in view space — against it).  Mutates and
// returns the shared `_viewPlane`.
const _viewPlane = new THREE.Plane();
export function crossSectionViewPlane(camera) {
  return _viewPlane
    .copy(CROSS_SECTION_PLANE)
    .applyMatrix4(camera.matrixWorldInverse);
}
