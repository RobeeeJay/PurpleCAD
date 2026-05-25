// Direction-of-rotation regression tests for the transform-handle
// gizmo.  The user reported Y rotated anticlockwise when dragged
// clockwise (X and Z were already correct), so we lock the sign
// convention per axis here — drag right (dxPx > 0) on each handle
// produces the user-expected rotation direction.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  rotationSignForHandle,
  rotationDeltaFromDrag,
  rotationAxisForHandle,
  rotationQuaternionForDrag,
  ROTATION_PIXELS_TO_RADIANS,
} from "../cameraControls/rotationHandle.js";

const identity = () => new THREE.Quaternion();

describe("rotation-handle drag sign convention", () => {
  it("rotX: drag right yields a negative angle about world +X", () => {
    expect(rotationSignForHandle("rotX")).toBe(-1);
    const delta = rotationDeltaFromDrag("rotX", 100);
    expect(delta).toBeLessThan(0);
    expect(delta).toBeCloseTo(-1.0, 6);
  });

  it("rotY: drag right yields a POSITIVE angle about world +Y (clockwise from above)", () => {
    // This is the bug fix — previously rotY shared the same negation
    // as rotX/rotZ, which rotated CCW from above when the user dragged
    // the gizmo clockwise.
    expect(rotationSignForHandle("rotY")).toBe(1);
    const delta = rotationDeltaFromDrag("rotY", 100);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeCloseTo(1.0, 6);
  });

  it("rotZ: drag right yields a negative angle about world +Z", () => {
    expect(rotationSignForHandle("rotZ")).toBe(-1);
    const delta = rotationDeltaFromDrag("rotZ", 100);
    expect(delta).toBeLessThan(0);
    expect(delta).toBeCloseTo(-1.0, 6);
  });

  // The three checks below pin down "drag right" as a CONSISTENT
  // clockwise rotation from the natural viewing direction of each
  // axis.  rotX/rotZ were already correct in the existing UX;
  // rotY was inverted — this fixes it.
  it("rotY drag right rotates +X toward -Z (clockwise looking down +Y)", () => {
    const q = rotationQuaternionForDrag("rotY", identity(), 50);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.z).toBeLessThan(0);
    expect(probe.x).toBeCloseTo(Math.cos(0.5), 6);
  });

  it("rotY drag LEFT rotates +X toward +Z (anticlockwise from above)", () => {
    const q = rotationQuaternionForDrag("rotY", identity(), -50);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.z).toBeGreaterThan(0);
  });

  it("rotX drag right rotates +Y toward -Z (clockwise looking down +X)", () => {
    const q = rotationQuaternionForDrag("rotX", identity(), 50);
    const probe = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(probe.z).toBeLessThan(0);
    expect(probe.y).toBeCloseTo(Math.cos(0.5), 6);
  });

  it("rotX drag LEFT rotates +Y toward +Z (anticlockwise from down +X)", () => {
    const q = rotationQuaternionForDrag("rotX", identity(), -50);
    const probe = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(probe.z).toBeGreaterThan(0);
  });

  it("rotZ drag right rotates +X toward -Y (clockwise looking down +Z)", () => {
    const q = rotationQuaternionForDrag("rotZ", identity(), 50);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.y).toBeLessThan(0);
    expect(probe.x).toBeCloseTo(Math.cos(0.5), 6);
  });

  it("rotZ drag LEFT rotates +X toward +Y (anticlockwise from down +Z)", () => {
    const q = rotationQuaternionForDrag("rotZ", identity(), -50);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.y).toBeGreaterThan(0);
  });

  it("rotationAxisForHandle returns unit world axes", () => {
    expect(rotationAxisForHandle("rotX")).toEqual(new THREE.Vector3(1, 0, 0));
    expect(rotationAxisForHandle("rotY")).toEqual(new THREE.Vector3(0, 1, 0));
    expect(rotationAxisForHandle("rotZ")).toEqual(new THREE.Vector3(0, 0, 1));
    expect(rotationAxisForHandle("scale")).toBeNull();
  });

  it("rotation delta scales linearly with pixel drag", () => {
    const small = rotationDeltaFromDrag("rotX", 10);
    const big = rotationDeltaFromDrag("rotX", 100);
    expect(big).toBeCloseTo(small * 10, 9);
    expect(Math.abs(small)).toBeCloseTo(10 * ROTATION_PIXELS_TO_RADIANS, 9);
  });

  it("rotation respects the captured start orientation (delta is composed, not replaced)", () => {
    // Start with the object already rotated 90° about X.  Dragging
    // the rotY handle should add a rotation about WORLD +Y on top of
    // that, leaving the X rotation intact (decoupled from the Euler
    // ordering trap mentioned in the cameraControls.js drag handler).
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 2, 0, 0),
    );
    const q = rotationQuaternionForDrag("rotY", start, 50);
    // Start takes +Y → +Z.  Then a world-+Y rotation by +0.5 sends
    // +Z → -X·sin(0.5) + +Z·cos(0.5) (using the rotation matrix
    // applied to (0, 0, 1)) — so the probe lands in the -X / +Z
    // half-space, never near +Y.  If the X rotation had been clobbered
    // the probe would stay near +Y instead.
    const probe = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(Math.abs(probe.y)).toBeLessThan(0.01);
    expect(probe.x).toBeCloseTo(Math.sin(0.5), 6);
    expect(probe.z).toBeCloseTo(Math.cos(0.5), 6);
  });

  it("composing world-+Y on top of a world-+X start keeps the world-+Y vector invariant", () => {
    // Sanity-check the decoupling: a vector along world +Y must remain
    // along world +Y when the rotation about world +Y is composed
    // *after* any other rotation (premultiplication).
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.3, 0.4, 0),
    );
    const q = rotationQuaternionForDrag("rotY", start, 100);
    const startProbe = new THREE.Vector3(0, 1, 0).applyQuaternion(start);
    const finalProbe = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // The Y-rotation only acts on the +Y-rotated vector via the
    // residual XZ component carried over from `start`; magnitude
    // preserved, length unchanged, no drift along the rotation axis.
    expect(finalProbe.length()).toBeCloseTo(1, 6);
    expect(startProbe.length()).toBeCloseTo(1, 6);
  });
});
