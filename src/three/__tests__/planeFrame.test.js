import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  frameFromPoints,
  frameFromPointNormal,
  applyPlaneAdjust,
  normalOf,
  planeCrossesPoints,
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

// The split tool's cut must pass THROUGH the body.  A face of the body itself --
// the natural first thing to click -- leaves every vertex on one side, cuts
// nothing, and used to come back as a renamed copy of the whole body.
describe("planeCrossesPoints", () => {
  // The 8 corners of a 2-unit cube centred on (0, 1, 0).
  const cube = [];
  for (const x of [-1, 1])
    for (const y of [0, 2]) for (const z of [-1, 1]) cube.push(x, y, z);
  const at = (point, normal) => frameFromPointNormal(point, normal);

  it("is true for a plane through the middle of the body", () => {
    expect(
      planeCrossesPoints(at({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }), cube),
    ).toBe(true);
  });

  it("is false for a plane lying on one of the body's own faces", () => {
    // The top face (y = 2): the corners are on the plane or below it.
    expect(
      planeCrossesPoints(
        at({ x: 0.3, y: 2, z: 0.3 }, { x: 0, y: 1, z: 0 }),
        cube,
      ),
    ).toBe(false);
    // The front face, clicked off-centre -- the point on the face doesn't matter.
    expect(
      planeCrossesPoints(
        at({ x: 0.5, y: 1.2, z: 1 }, { x: 0, y: 0, z: 1 }),
        cube,
      ),
    ).toBe(false);
  });

  it("is false for a plane that misses the body entirely", () => {
    expect(
      planeCrossesPoints(at({ x: 5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }), cube),
    ).toBe(false);
  });

  it("is true for a tilted plane through a corner region", () => {
    const n = { x: 1, y: 1, z: 0 };
    expect(planeCrossesPoints(at({ x: 0.5, y: 1.5, z: 0 }, n), cube)).toBe(
      true,
    );
  });
});
