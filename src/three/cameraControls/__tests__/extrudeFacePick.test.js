// "To…" in the extrude dialog: the distance that ends the prism on a picked
// face.  It has to land ON a parallel face, not a float32 hair off it -- a
// later boolean against that face would graze it inside OCC's tolerances.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { distanceToFace } from "../extrudeFacePick.js";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const up = v(0, 1, 0);

describe("distanceToFace", () => {
  it("reaches a parallel face exactly, from its corner, not the hit point", () => {
    // The hit point is 1.3e-6 off the face at y = 2.5; its corner is on it.
    const d = distanceToFace({
      origin: v(0, 0, 0),
      normal: up,
      point: v(0.4, 2.5000013, 0.1),
      faceNormal: v(0, -1, 0),
      faceCorner: v(3, 2.5, -1),
    });
    expect(d).toBe(2.5);
  });

  it("measures from the start offset, not the sketch plane", () => {
    const d = distanceToFace({
      origin: v(0, 0, 0),
      normal: up,
      startOffset: 1,
      point: v(0, 4, 0),
      faceNormal: up,
      faceCorner: v(9, 4, 9),
    });
    expect(d).toBe(3);
  });

  it("is negative for a face behind the sketch plane", () => {
    const d = distanceToFace({
      origin: v(0, 0, 0),
      normal: up,
      point: v(0, -2, 0),
      faceNormal: up,
      faceCorner: v(5, -2, 5),
    });
    expect(d).toBe(-2);
  });

  it("uses the clicked point on a slanted face", () => {
    // A slope has no single distance; the click says where to reach.
    const d = distanceToFace({
      origin: v(0, 0, 0),
      normal: up,
      point: v(1, 3.25, 0),
      faceNormal: v(0.6, 0.8, 0),
      faceCorner: v(0, 9, 0),
    });
    expect(d).toBe(3.25);
  });

  it("uses the clicked point on a sketch plane (no face)", () => {
    expect(
      distanceToFace({ origin: v(0, 0, 0), normal: up, point: v(2, 1.5, 7) }),
    ).toBe(1.5);
  });
});
