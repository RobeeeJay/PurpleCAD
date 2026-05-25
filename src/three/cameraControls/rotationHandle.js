// Pure helpers for the transform-handle rotation drag — kept out of
// cameraControls.js so the sign convention per axis is unit-testable
// without driving the full canvas event pipeline.

import * as THREE from "three";

// Mouse-drag sign per axis.  Horizontal drag (dxPx > 0) feels like
// "rotate clockwise from above / from the object's natural viewing
// direction" for every axis — but the raw right-hand-rule sign about
// each world axis isn't the same, so we negate selectively.
//
// X / Z: dxPx > 0 → negative angle about +axis (CW from camera POV).
// Y:     dxPx > 0 → positive angle about +Y    (CW from above when
//        looking down -Y); the unflipped sign gave CCW, which the
//        user reported as "dragged clockwise but went anticlockwise".
export function rotationSignForHandle(handleType) {
  if (handleType === "rotY") return 1;
  return -1;
}

export function rotationAxisForHandle(handleType) {
  if (handleType === "rotX") return new THREE.Vector3(1, 0, 0);
  if (handleType === "rotY") return new THREE.Vector3(0, 1, 0);
  if (handleType === "rotZ") return new THREE.Vector3(0, 0, 1);
  return null;
}

export const ROTATION_PIXELS_TO_RADIANS = 0.01;

export function rotationDeltaFromDrag(handleType, dxPx) {
  const sign = rotationSignForHandle(handleType);
  return sign * dxPx * ROTATION_PIXELS_TO_RADIANS;
}

// Compose a new world quaternion for the dragged mesh: the delta
// rotation about the handle's world axis premultiplied with the
// orientation captured when the drag began.  Returns null for an
// unknown handle.
export function rotationQuaternionForDrag(handleType, startQuat, dxPx) {
  const axis = rotationAxisForHandle(handleType);
  if (!axis) return null;
  const delta = rotationDeltaFromDrag(handleType, dxPx);
  const dq = new THREE.Quaternion().setFromAxisAngle(axis, delta);
  return new THREE.Quaternion().copy(startQuat).premultiply(dq);
}
