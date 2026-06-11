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

// Re-pose the plane to the live camera: its normal rotates with the camera and
// it passes through the orbit `target`.  Anchoring to the target (not the world
// origin) makes the cut follow panning — pan moves camera + target together —
// as well as rotation, so the section stays put on screen.  Call once per frame
// while the cross-section view is active.
export function updateCrossSectionPlane(camera, target) {
  _n.copy(_localNormal).applyQuaternion(camera.quaternion).normalize();
  CROSS_SECTION_PLANE.normal.copy(_n);
  CROSS_SECTION_PLANE.constant = target ? -_n.dot(target) : 0;
}
