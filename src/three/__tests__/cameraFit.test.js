// Reset-view / thumbnail framing maths.  analyticLocalPoints must sample the
// TRUE round-primitive surface (not the shader's box hull), and the fit must
// place the camera so the sampled points land inside the requested NDC frame.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  analyticLocalPoints,
  boxCorners,
  fitPointsToView,
} from "../cameraFit.js";

describe("analyticLocalPoints", () => {
  it("samples the sphere surface at its radius, not the hull", () => {
    const pts = analyticLocalPoints({
      type: "sphere",
      dimensions: { radius: 1.5 },
    });
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) expect(p.length()).toBeCloseTo(1.5, 6);
  });

  it("cylinder samples stay on the wall/caps envelope", () => {
    const pts = analyticLocalPoints({
      type: "cylinder",
      dimensions: { radius: 2, height: 6 },
    });
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(3 + 1e-9);
    }
  });

  it("returns null for box-like items (use the real AABB)", () => {
    expect(analyticLocalPoints({ type: "cube" })).toBe(null);
    expect(analyticLocalPoints({ type: "csg" })).toBe(null);
  });
});

describe("boxCorners", () => {
  it("returns all 8 corners", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-1, -2, -3),
      new THREE.Vector3(1, 2, 3),
    );
    const corners = boxCorners(box);
    expect(corners.length).toBe(8);
    const xs = new Set(corners.map((c) => c.x));
    expect(xs).toEqual(new Set([-1, 1]));
  });
});

describe("fitPointsToView", () => {
  it("frames a cube's corners inside the fill window", () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1),
    );
    const pts = boxCorners(box);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    const fill = 0.8;
    const fit = fitPointsToView(pts, dir, camera, fill);
    expect(fit).toBeTruthy();
    expect(fit.distance).toBeGreaterThan(0);

    // Place the camera per the fit ({target, distance} back along `dir`) and
    // verify every point projects inside the requested NDC window.
    camera.position.copy(fit.target).addScaledVector(dir, fit.distance);
    camera.lookAt(fit.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    for (const p of pts) {
      const ndc = p.clone().project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(fill + 0.05);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(fill + 0.05);
    }
  });
});
