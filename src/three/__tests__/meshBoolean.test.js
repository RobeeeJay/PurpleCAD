// Triangle-mesh boolean (three-bvh-csg) used for booleans involving an imported
// mesh, where OCC's solid boolean is infeasible.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { meshBoolean } from "../meshBoolean.js";

const extents = (positions) => {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], positions[i + k]);
      mx[k] = Math.max(mx[k], positions[i + k]);
    }
  }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
};

const box = (size, pos) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
  m.position.set(pos[0], pos[1], pos[2]);
  m.updateMatrixWorld(true);
  return m;
};

describe("meshBoolean", () => {
  // Two 2-unit cubes overlapping in one corner.
  const operands = () => [box(2, [0, 0, 0]), box(2, [1, 1, 1])];

  it("unions two meshes", () => {
    const r = meshBoolean(operands(), "union");
    expect(r).toBeTruthy();
    expect(extents(r.geometryData.positions).map((v) => +v.toFixed(1))).toEqual(
      [3, 3, 3],
    );
  });

  it("subtracts (difference) one mesh from another", () => {
    const r = meshBoolean(operands(), "difference");
    expect(extents(r.geometryData.positions).map((v) => +v.toFixed(1))).toEqual(
      [2, 2, 2],
    );
  });

  it("intersects two meshes", () => {
    const r = meshBoolean(operands(), "intersection");
    expect(extents(r.geometryData.positions).map((v) => +v.toFixed(1))).toEqual(
      [1, 1, 1],
    );
    // The overlap cube is centred at (0.5, 0.5, 0.5) in world.
    expect(r.position.x).toBeCloseTo(0.5, 5);
  });

  it("returns null for fewer than two meshes or an unknown op", () => {
    expect(meshBoolean([box(2, [0, 0, 0])], "union")).toBeNull();
    expect(meshBoolean(operands(), "nope")).toBeNull();
  });
});
