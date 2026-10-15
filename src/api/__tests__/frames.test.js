// The frame conversions are the one place the API can make a part ten times
// too big or lay it on its side without any error, so each is pinned against
// the geometry it claims to describe rather than against itself.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  internalToUser,
  meshStats,
  PLANES,
  planePlacement,
  sketchLocalToUserMm,
  toMm,
  toScene,
  userToInternal,
} from "../frames.js";

// Normalises -0 to 0: toEqual compares with Object.is, and a sign flip on a
// zero coordinate is not a difference worth failing on.
const n = (a) => a.map((v) => v + 0);

describe("units", () => {
  it("puts ten millimetres in a scene unit", () => {
    expect(toScene(10)).toBe(1);
    expect(toMm(toScene(37.5))).toBeCloseTo(37.5, 12);
  });
});

describe("axes", () => {
  it("round-trips between the user frame and the scene", () => {
    const p = [3, -4, 5];
    expect(n(internalToUser(userToInternal(p)))).toEqual(p);
    expect(n(userToInternal(internalToUser(p)))).toEqual(p);
  });

  it("puts the user's up, Z, on the scene's Y", () => {
    expect(n(userToInternal([0, 0, 1]))).toEqual([0, 1, 0]);
    // and the user's Y points AWAY from a front view, into internal -z
    expect(n(userToInternal([0, 1, 0]))).toEqual([0, 0, -1]);
  });
});

describe("sketch planes", () => {
  const axisIndex = { X: 0, Y: 1, Z: 2 };

  for (const [name, plane] of Object.entries(PLANES)) {
    it(`maps ${name}'s local x and y onto user ${plane.u} and ${plane.v}`, () => {
      const at = sketchLocalToUserMm(planePlacement(name), 1, 2);
      const expected = [0, 0, 0];
      expected[axisIndex[plane.u]] = 10;
      expected[axisIndex[plane.v]] = 20;
      expect(n(at.map((v) => Math.round(v * 1e9) / 1e9))).toEqual(expected);
    });

    it(`extrudes from ${name} along its stated normal`, () => {
      // An extrude grows along the sketch's local +z.
      const { rotation } = planePlacement(name);
      const z = new THREE.Vector3(0, 0, 1).applyEuler(
        new THREE.Euler(rotation.x, rotation.y, rotation.z),
      );
      const user = internalToUser([z.x, z.y, z.z]).map((v) => Math.round(v));
      expect(n(user)).toEqual(plane.normal);
    });
  }

  it("offsets a plane along its own normal, in mm", () => {
    const { position } = planePlacement("XY", 8);
    // 8mm up the user's Z is 0.8 scene units up the scene's Y.
    expect(position.y).toBeCloseTo(0.8, 12);
    expect(position.x + 0).toBe(0);
    expect(position.z + 0).toBe(0);
  });
});

describe("meshStats", () => {
  const box = (w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    return { positions: g.attributes.position.array, indices: g.index.array };
  };
  const identity = new THREE.Matrix4().toArray();

  it("measures a scene-unit cube as 10mm on a side and 1000mm3", () => {
    const s = meshStats({ ...box(1, 1, 1), matrix: identity });
    expect(s.size).toEqual([10, 10, 10]);
    expect(s.volumeMm3).toBeCloseTo(1000, 6);
    expect(s.triangles).toBe(12);
  });

  it("reports height in the scene's Y as the user's Z", () => {
    // Tall in internal y, lifted so it sits on the ground.
    const lifted = new THREE.Matrix4().makeTranslation(0, 1, 0).toArray();
    const s = meshStats({ ...box(1, 2, 1), matrix: lifted });
    expect(s.size).toEqual([10, 10, 20]);
    expect(n(s.min)[2]).toBe(0);
    expect(s.max[2]).toBe(20);
  });

  it("flips the Y range, since the user's Y is the scene's -z", () => {
    const pushed = new THREE.Matrix4().makeTranslation(0, 0, 3).toArray();
    const s = meshStats({ ...box(1, 1, 1), matrix: pushed });
    // Internal z from 2.5 to 3.5 is user Y from -35 to -25.
    expect(s.min[1]).toBe(-35);
    expect(s.max[1]).toBe(-25);
  });

  it("reads an inside-out surface as negative volume", () => {
    const { positions, indices } = box(1, 1, 1);
    const flipped = Uint32Array.from(indices);
    for (let t = 0; t < flipped.length; t += 3)
      [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    const s = meshStats({ positions, indices: flipped, matrix: identity });
    expect(s.volumeMm3).toBeCloseTo(-1000, 6);
  });
});
