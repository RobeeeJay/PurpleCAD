// meshSplit: renderer-side fallback that cuts a baked mesh into two parts along
// a plane (three-bvh-csg).  A 2x2x2 cube split by the XY plane (z=0) yields a
// top half (z in [0,1]) and a bottom half (z in [-1,0]).

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { meshSplit } from "../meshBoolean.js";

const zRange = (positions) => {
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    mn = Math.min(mn, positions[i]);
    mx = Math.max(mx, positions[i]);
  }
  return [mn, mx];
};

describe("meshSplit", () => {
  it("cuts a cube into a +normal half and a -normal half", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.updateMatrixWorld(true);
    const res = meshSplit(mesh, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    expect(res).toBeTruthy();
    expect(res.partA).toBeTruthy();
    expect(res.partB).toBeTruthy();

    // Parts are bbox-centred; reconstruct world z via the part position.
    const worldZ = (part) => {
      const [mn, mx] = zRange(part.geometryData.positions);
      return [mn + part.position.z, mx + part.position.z];
    };
    const [aMin, aMax] = worldZ(res.partA); // +normal side → top half
    const [bMin, bMax] = worldZ(res.partB); // -normal side → bottom half
    expect(aMin).toBeCloseTo(0, 4);
    expect(aMax).toBeCloseTo(1, 4);
    expect(bMin).toBeCloseTo(-1, 4);
    expect(bMax).toBeCloseTo(0, 4);
  });
});
