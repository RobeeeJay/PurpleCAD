import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  frameFromPoints,
  frameFromPointNormal,
  applyPlaneAdjust,
  normalOf,
} from "../planeFrame.js";

describe("frameFromPoints", () => {
  it("derives an XY-plane frame (normal +Z) from three points", () => {
    const f = frameFromPoints(
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
    );
    expect(f).toBeTruthy();
    const n = normalOf(f.rotation);
    expect(Math.abs(n.z)).toBeCloseTo(1, 5);
    expect(n.x).toBeCloseTo(0, 5);
    expect(n.y).toBeCloseTo(0, 5);
    // Origin at the centroid.
    expect(f.position.x).toBeCloseTo(2 / 3, 5);
    expect(f.position.y).toBeCloseTo(2 / 3, 5);
  });

  it("returns null for collinear points", () => {
    expect(
      frameFromPoints(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ),
    ).toBeNull();
  });
});

describe("frameFromPointNormal", () => {
  it("aligns +Z to the given normal and keeps the point as origin", () => {
    const f = frameFromPointNormal({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 });
    expect(f).toBeTruthy();
    const n = normalOf(f.rotation);
    expect(n.x).toBeCloseTo(0, 5);
    expect(n.y).toBeCloseTo(1, 5);
    expect(n.z).toBeCloseTo(0, 5);
    expect(f.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("normalises a non-unit normal", () => {
    const f = frameFromPointNormal({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 });
    const n = normalOf(f.rotation);
    expect(n.z).toBeCloseTo(1, 5);
  });

  it("returns null for a zero normal", () => {
    expect(
      frameFromPointNormal({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
    ).toBeNull();
  });
});

describe("applyPlaneAdjust", () => {
  const base = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };

  it("offsets along the (rotated) plane normal", () => {
    // No rotation: normal is +Z, offset 5 → position z = 5.
    const r = applyPlaneAdjust(base, { x: 0, y: 0, z: 0 }, 5);
    expect(r.position.z).toBeCloseTo(5, 5);
  });

  it("rotates the plane so a 90° X rotation tips the normal to -Y", () => {
    const r = applyPlaneAdjust(base, { x: 90, y: 0, z: 0 }, 0);
    const n = new THREE.Vector3(0, 0, 1).applyEuler(
      new THREE.Euler(r.rotation.x, r.rotation.y, r.rotation.z),
    );
    expect(n.y).toBeCloseTo(-1, 4);
    // Offset now runs along the new normal (-Y).
    const r2 = applyPlaneAdjust(base, { x: 90, y: 0, z: 0 }, 3);
    expect(r2.position.y).toBeCloseTo(-3, 4);
  });
});
