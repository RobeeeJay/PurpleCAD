// The plain scroll pan moves the view across the ground and never up or
// down.  From a level view (the view cube's Right or Front) it used to move
// the camera straight up instead: it found the pan by raycasting the screen
// onto the ground, which a level view never meets, and its fallback moved
// the camera vertically while sideways scroll did nothing.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { groundPanOffset } from "../cameraControls/navigation.js";

const H = 800;
const target = new THREE.Vector3(0, 0, 0);

const perspectiveAt = (x, y, z) => {
  const cam = new THREE.PerspectiveCamera(35, 1.6, 0.1, 1000);
  cam.position.set(x, y, z);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  return cam;
};

describe("scroll panning stays on the ground", () => {
  it("from the Right view, sideways scroll pans along the ground and nothing moves up", () => {
    // Looking level along -x, as the Right face of the view cube does.
    const cam = perspectiveAt(20, 0, 0);
    const side = groundPanOffset(cam, target, 50, 0, H);
    expect(side.y, `sideways pan ${side.toArray()}`).toBe(0);
    // The view's right is world -z from here.
    expect(side.z, `sideways pan ${side.toArray()}`).toBeLessThan(0);
    expect(Math.abs(side.x)).toBeLessThan(1e-9);
  });

  it("from the Right view, vertical scroll moves across the ground, not up", () => {
    const cam = perspectiveAt(20, 0, 0);
    const fwd = groundPanOffset(cam, target, 0, -50, H);
    expect(fwd.y, `vertical pan ${fwd.toArray()}`).toBe(0);
    // Scrolling up moves away from the camera, along -x.
    expect(fwd.x, `vertical pan ${fwd.toArray()}`).toBeLessThan(0);
  });

  it("from a tilted view, matches the ground point that moves under the screen", () => {
    // Orthographic, so a pixel is the same world size everywhere and a ray's
    // ground hit is exact: the old raycast pan, where it worked.
    const cam = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 1000);
    cam.position.set(10, 14, 10);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = (ndcX, ndcY) => {
      const r = new THREE.Raycaster();
      r.setFromCamera({ x: ndcX, y: ndcY }, cam);
      return r.ray.intersectPlane(ground, new THREE.Vector3());
    };
    // 40 px right and 30 px down from the centre, as NDC.
    const dx = 40;
    const dy = 30;
    const expected = hit((2 * dx) / (H * 1.6), (-2 * dy) / H).sub(hit(0, 0));
    const got = groundPanOffset(cam, target, dx, dy, H);
    expect(got.y).toBe(0);
    expect(
      got.distanceTo(expected),
      `pan ${got.toArray()} vs ${expected.toArray()}`,
    ).toBeLessThan(1e-6);
  });
});
