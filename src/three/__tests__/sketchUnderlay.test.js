// The sketch reference underlay (a PNG/JPEG traced over) is sized by its REAL
// width in mm — the same convention the Texture tool uses for sizeMm — with the
// height following the source image's aspect ratio so the picture is never
// distorted.  A guide traced at the part's true width therefore produces sketch
// geometry at true scale.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  underlayPlaneSize,
  applyUnderlayTransform,
  DEFAULT_UNDERLAY,
} from "../sceneObjects/sketchUnderlay.js";
import { MM_PER_UNIT } from "../sceneObjects/dimensions.js";

describe("underlayPlaneSize", () => {
  it("converts the width from mm to scene units", () => {
    // 100 mm at 10 mm/unit = 10 scene units.
    expect(underlayPlaneSize(100, 1).width).toBeCloseTo(100 / MM_PER_UNIT, 9);
  });

  it("derives the height from the image aspect (never distorts)", () => {
    // A 800x400 image (aspect 0.5) shown 60 mm wide is 30 mm tall.
    const { width, height } = underlayPlaneSize(60, 0.5);
    expect(width).toBeCloseTo(6, 9);
    expect(height).toBeCloseTo(3, 9);
  });

  it("falls back to square for a missing / degenerate aspect", () => {
    for (const bad of [undefined, null, 0, -1, NaN]) {
      const { width, height } = underlayPlaneSize(50, bad);
      expect(height).toBeCloseTo(width, 9);
    }
  });

  it("never collapses to a zero-size plane", () => {
    expect(underlayPlaneSize(0, 1).width).toBeGreaterThan(0);
  });
});

describe("applyUnderlayTransform", () => {
  // A sketch on the default XZ plane: rotated -90° about X, offset in world.
  const sketchMesh = new THREE.Mesh();
  sketchMesh.position.set(2, 3, -4);
  sketchMesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  it("places an un-offset underlay on the sketch origin (just off the plane)", () => {
    const mesh = new THREE.Mesh();
    applyUnderlayTransform(mesh, { ...DEFAULT_UNDERLAY }, sketchMesh);
    // Within the tiny z lift that keeps it above the sketch plane mesh.
    expect(mesh.position.distanceTo(sketchMesh.position)).toBeLessThan(0.01);
  });

  it("applies the offset in the SKETCH's plane, not world axes", () => {
    const mesh = new THREE.Mesh();
    applyUnderlayTransform(
      mesh,
      { ...DEFAULT_UNDERLAY, offsetX: 1, offsetY: 2 },
      sketchMesh,
    );
    // Sketch-local +Y maps to world -Z under a -90° X rotation, so a local
    // (1,2) offset must NOT show up as a world y change.
    const d = mesh.position.clone().sub(sketchMesh.position);
    expect(d.x).toBeCloseTo(1, 6);
    expect(d.z).toBeCloseTo(-2, 6);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it("rotates about the sketch normal, keeping the plane's orientation", () => {
    const flat = new THREE.Mesh();
    const spun = new THREE.Mesh();
    applyUnderlayTransform(flat, { ...DEFAULT_UNDERLAY }, sketchMesh);
    applyUnderlayTransform(
      spun,
      { ...DEFAULT_UNDERLAY, rotationDeg: 90 },
      sketchMesh,
    );
    const nOf = (m) => new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
    // Same facing direction (still in the sketch plane), different roll.
    expect(nOf(flat).dot(nOf(spun))).toBeCloseTo(1, 6);
    expect(flat.quaternion.angleTo(spun.quaternion)).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });
});
