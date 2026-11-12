// panelAwareLookAt yaws the camera by a small additional angle after lookAt
// so the pivot renders at the visible area's true centre (NDC +frac, 0)
// instead of the raw canvas centre. That yaw must be a PURE horizontal NDC
// shift regardless of how the camera is pitched — using rotateOnWorldAxis
// (the world Y axis) instead of rotateOnAxis (the camera's own LOCAL up,
// which coincides with world Y only when pitch is 0) picks up a roll-like
// component as pitch moves away from level, so the pivot visibly swings
// left/right as the view is rotated up/down. Pin the invariant directly:
// NDC-x of the target must stay constant across a wide range of pitch
// angles for a fixed canvas/panel width.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { panelAwareLookAt } from "../sceneSetup.js";

const CANVAS_W = 1400;

function ndcXAtPitch(pitchRad, distance = 20) {
  const camera = new THREE.PerspectiveCamera(35, CANVAS_W / 900, 0.1, 1000);
  const target = new THREE.Vector3(0, 0, 0);
  camera.position.set(
    Math.sin(0.7) * Math.cos(pitchRad) * distance,
    Math.sin(pitchRad) * distance,
    Math.cos(0.7) * Math.cos(pitchRad) * distance,
  );
  panelAwareLookAt(camera, target, CANVAS_W);
  camera.updateMatrixWorld(true);
  return target.clone().project(camera).x;
}

describe("panelAwareLookAt", () => {
  it("keeps the pivot's NDC-x constant across a wide range of pitch angles", () => {
    const pitches = [-1.4, -0.8, -0.3, 0, 0.3, 0.8, 1.4];
    const values = pitches.map((p) => ndcXAtPitch(p));
    for (const v of values) {
      expect(v).toBeCloseTo(values[0], 6);
    }
  });

  it("lands at the expected visible-area NDC-x for a level camera", () => {
    const x = ndcXAtPitch(0);
    // frac = panel/canvasW = 250/1400
    expect(x).toBeCloseTo(250 / CANVAS_W, 6);
  });

  // Orthographic used to get no compensation at all, so its pivot sat at the
  // raw canvas centre -- half the panel's width left of where perspective
  // put it -- and the model jumped sideways on every projection switch.
  it("puts an orthographic camera's pivot at the same NDC-x, without turning it", () => {
    const camera = new THREE.OrthographicCamera(-15, 15, 9, -9, 0.1, 1000);
    camera.zoom = 2.5;
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3(3, 1, -2);
    camera.position.set(13, 9, 8);
    panelAwareLookAt(camera, target, CANVAS_W);
    camera.updateMatrixWorld(true);
    expect(target.clone().project(camera).x).toBeCloseTo(250 / CANVAS_W, 6);
    // A parallel view must look straight at the pivot: turning the camera
    // instead would tilt Front, Top and the rest off true.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const toTarget = target.clone().sub(camera.position).normalize();
    expect(forward.distanceTo(toTarget)).toBeLessThan(1e-9);
  });

  it("clears the orthographic shift from a camera used as perspective", () => {
    const camera = new THREE.PerspectiveCamera(35, CANVAS_W / 900, 0.1, 1000);
    camera.setViewOffset(CANVAS_W, 900, -100, 0, CANVAS_W, 900);
    camera.position.set(10, 5, 10);
    panelAwareLookAt(camera, new THREE.Vector3(), CANVAS_W);
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});
