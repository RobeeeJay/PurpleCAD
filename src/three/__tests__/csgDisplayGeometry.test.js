// Normals for a baked mesh stored without them are computed for display.  Over
// an OCC tessellation (vertices shared only within a face) smooth normals are
// right; over a WELDED mesh -- vertices shared across sharp edges -- they smear
// every corner.  Welded meshes carry `flat` and are drawn per-triangle, the way
// they looked as triangle soups; everything else must render exactly as before.
import { describe, it, expect } from "vitest";
import { csgDisplayGeometry } from "../sceneObjects/sceneBuilder.js";

// A unit cube with its 8 corners shared by all 12 triangles.
const weldedCube = () => ({
  positions: [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ],
  indices: [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1,
    2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7,
  ],
  normals: null,
});

describe("csgDisplayGeometry", () => {
  it("draws a welded mesh with each triangle's own flat normal", () => {
    const g = csgDisplayGeometry({ ...weldedCube(), flat: true });
    expect(g.index).toBeNull();
    const n = g.getAttribute("normal");
    for (let t = 0; t < n.count; t += 3) {
      // All three corners of a triangle share one axis-aligned normal.
      const v = [n.getX(t), n.getY(t), n.getZ(t)];
      expect(Math.max(...v.map(Math.abs))).toBeCloseTo(1, 6);
      for (let k = 1; k < 3; k++) {
        expect(n.getX(t + k)).toBeCloseTo(v[0], 6);
        expect(n.getY(t + k)).toBeCloseTo(v[1], 6);
        expect(n.getZ(t + k)).toBeCloseTo(v[2], 6);
      }
    }
  });

  it("leaves an unmarked mesh indexed and smooth-shaded, as OCC results are", () => {
    const g = csgDisplayGeometry(weldedCube());
    expect(g.index).not.toBeNull();
    // A shared corner's normal is the average of three faces: no axis
    // component reaches 1.
    const n = g.getAttribute("normal");
    expect(Math.abs(n.getX(0))).toBeLessThan(0.99);
  });
});
