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
});
