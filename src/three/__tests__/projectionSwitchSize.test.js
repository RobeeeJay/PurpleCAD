import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  orthoHeightMatching,
  perspectiveDistanceMatching,
} from "../sceneSetup.js";

// Switching projection must not change how big the model looks at the pivot.
// Measured through real cameras: the screen height (NDC) per world unit of a
// tiny segment at the pivot lying along the camera's own up -- in the image
// plane, so perspective foreshortening plays no part.
const FOV = 35;
const ASPECT = 1.6;
const pivot = new THREE.Vector3(2, 1, -3);
const dir = new THREE.Vector3(1, 0.8, 1.3).normalize();

function shownHeight(cam) {
  cam.lookAt(pivot);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const eps = 1e-4;
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const a = pivot.clone().project(cam);
  const b = pivot.clone().addScaledVector(up, eps).project(cam);
  return Math.hypot(b.x - a.x, b.y - a.y) / eps;
}

function perspectiveAt(distance) {
  const cam = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 1000);
  cam.position.copy(pivot).addScaledVector(dir, distance);
  return cam;
}

function orthoShowing(height, zoom = 1) {
  const h = height * zoom;
  const cam = new THREE.OrthographicCamera(
    (-h * ASPECT) / 2,
    (h * ASPECT) / 2,
    h / 2,
    -h / 2,
    0.1,
    1000,
  );
  cam.zoom = zoom;
  cam.position.copy(pivot).addScaledVector(dir, 50);
  return cam;
}

describe("switching projection keeps the size at the pivot", () => {
  for (const distance of [3, 17, 120]) {
    it(`perspective at ${distance} units to orthographic`, () => {
      const persp = shownHeight(perspectiveAt(distance));
      const ortho = shownHeight(
        orthoShowing(orthoHeightMatching(distance, FOV)),
      );
      expect(ortho / persp).toBeCloseTo(1, 6);
    });
  }

  // An orthographic view zoomed in or out (cam.zoom) must come back to a
  // perspective camera at the distance that shows the same.
  for (const zoom of [0.25, 1, 6]) {
    it(`orthographic at zoom ${zoom} to perspective`, () => {
      const ortho = orthoShowing(20, zoom);
      const visible = (ortho.top - ortho.bottom) / ortho.zoom;
      const persp = perspectiveAt(perspectiveDistanceMatching(visible, FOV));
      expect(shownHeight(persp) / shownHeight(ortho)).toBeCloseTo(1, 6);
    });
  }

  // The measure itself must tell a mismatch apart: the old switch always made
  // a 20-unit orthographic view, which only matched at one distance.
  it("tells the old fixed 20-unit view apart at other distances", () => {
    for (const distance of [3, 120]) {
      const persp = shownHeight(perspectiveAt(distance));
      const ortho = shownHeight(orthoShowing(20));
      expect(Math.abs(ortho / persp - 1)).toBeGreaterThan(0.5);
    }
  });
});
