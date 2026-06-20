import { describe, it, expect } from "vitest";
import {
  bboxCenterOf,
  massCentroidOf,
  nearestVertexOf,
} from "../objectOrigin.js";

// 12-triangle axis-aligned cube of half-size `s` centred at (cx,cy,cz), as a
// flat non-indexed positions array (CCW winding for outward normals).
function cube(cx, cy, cz, s = 1) {
  const v = [
    [-s, -s, -s],
    [s, -s, -s],
    [s, s, -s],
    [-s, s, -s],
    [-s, -s, s],
    [s, -s, s],
    [s, s, s],
    [-s, s, s],
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz]);
  const faces = [
    [0, 3, 2, 1], // -z
    [4, 5, 6, 7], // +z
    [0, 1, 5, 4], // -y
    [2, 3, 7, 6], // +y
    [1, 2, 6, 5], // +x
    [0, 4, 7, 3], // -x
  ];
  const out = [];
  for (const [a, b, c, d] of faces) {
    for (const idx of [a, b, c, a, c, d]) out.push(...v[idx]);
  }
  return out;
}

describe("object origin math", () => {
  it("bbox centre is the midpoint of the extents", () => {
    expect(bboxCenterOf(cube(2, -1, 4, 3))).toMatchObject({
      x: 2,
      y: -1,
      z: 4,
    });
  });

  it("mass centroid of a uniform cube is its centre", () => {
    const c = massCentroidOf(cube(2, -1, 4, 1));
    expect(c.x).toBeCloseTo(2, 6);
    expect(c.y).toBeCloseTo(-1, 6);
    expect(c.z).toBeCloseTo(4, 6);
  });

  it("mass centroid falls back to bbox centre for an open/degenerate mesh", () => {
    // A single triangle has ~0 net volume → bbox-centre fallback.
    const tri = [0, 0, 0, 2, 0, 0, 0, 2, 0];
    expect(massCentroidOf(tri)).toMatchObject(bboxCenterOf(tri));
  });

  it("nearestVertexOf snaps to the closest corner", () => {
    const positions = cube(0, 0, 0, 1);
    expect(nearestVertexOf(positions, 0.9, 0.8, 0.7)).toMatchObject({
      x: 1,
      y: 1,
      z: 1,
    });
    expect(nearestVertexOf(positions, -0.9, -0.8, 0.9)).toMatchObject({
      x: -1,
      y: -1,
      z: 1,
    });
  });
});
