import { describe, it, expect } from "vitest";
import { lengthToScale, scaleToLength } from "../transformMath.js";

const S = (x, y, z) => ({ x, y, z });

describe("transformMath", () => {
  const local = S(20, 10, 5); // unscaled geometry size (mm) per axis

  it("reads the shown length as localSize * scale", () => {
    expect(scaleToLength(S(2, 1, 1), local, "x")).toBe(40);
    expect(scaleToLength(S(1, 3, 1), local, "y")).toBe(30);
    expect(scaleToLength(S(1, 1, 1), null, "x")).toBe(null);
  });

  it("unlocked: stretches only the edited axis", () => {
    // x is 20mm at scale 1; set to 60mm → scale.x = 3, y/z unchanged.
    const next = lengthToScale(S(1, 1, 1), local, "x", 60, false);
    expect(next).toEqual(S(3, 1, 1));
  });

  it("locked: scales all axes by the same factor", () => {
    // x is 40mm at scale 2; set to 60mm → factor 1.5 applied to every axis.
    const next = lengthToScale(S(2, 2, 2), local, "x", 60, true);
    expect(next).toEqual(S(3, 3, 3));
  });

  it("round-trips: editing to a length yields that length back", () => {
    const start = S(1.5, 0.5, 2);
    const next = lengthToScale(start, local, "y", 25, false);
    expect(scaleToLength(next, local, "y")).toBeCloseTo(25, 9);
    // other axes untouched
    expect(next.x).toBe(start.x);
    expect(next.z).toBe(start.z);
  });

  it("rejects non-positive length or missing local size", () => {
    expect(lengthToScale(S(1, 1, 1), local, "x", 0, false)).toBe(null);
    expect(lengthToScale(S(1, 1, 1), local, "x", -5, true)).toBe(null);
    expect(lengthToScale(S(1, 1, 1), null, "x", 10, false)).toBe(null);
  });
});
