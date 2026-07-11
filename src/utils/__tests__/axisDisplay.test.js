// The display frame must be the SAME frame the STL/STEP exporters write:
// a +π/2 rotation about X (y→z, z→−y), i.e. user X,Y,Z = internal x,−z,y.
// A mismatch here means the numbers in the transform panel disagree with
// what a CAD reader shows for the exported part.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { DISPLAY_AXES, toDisplay, fromDisplay } from "../axisDisplay.js";

describe("DISPLAY_AXES", () => {
  it("matches the export rotation (+π/2 about X)", () => {
    const p = new THREE.Vector3(2, 3, 5);
    const exported = p.clone().applyEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const displayed = DISPLAY_AXES.map((a) => toDisplay(p, a));
    expect(displayed[0]).toBeCloseTo(exported.x, 12);
    expect(displayed[1]).toBeCloseTo(exported.y, 12);
    expect(displayed[2]).toBeCloseTo(exported.z, 12);
  });

  it("is a proper rotation (right-handed, det +1)", () => {
    const cols = ["x", "y", "z"].map((k) => {
      const unit = { x: 0, y: 0, z: 0, [k]: 1 };
      return DISPLAY_AXES.map((a) => toDisplay(unit, a));
    });
    const [a, b, c] = cols;
    const det =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(det).toBe(1);
  });

  it("round-trips values", () => {
    for (const axis of DISPLAY_AXES) {
      expect(fromDisplay(toDisplay({ x: -7, y: 4, z: 9 }, axis), axis)).toBe(
        { x: -7, y: 4, z: 9 }[axis.key],
      );
    }
  });

  it("labels X, Y, Z in order with vertical (internal y) shown as Z", () => {
    expect(DISPLAY_AXES.map((a) => a.label)).toEqual(["X", "Y", "Z"]);
    expect(DISPLAY_AXES[2].key).toBe("y");
    expect(DISPLAY_AXES[1]).toMatchObject({ key: "z", sign: -1 });
  });
});
