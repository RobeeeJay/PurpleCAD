import { describe, it, expect } from "vitest";
import {
  splitGeometryComponents,
  countGeometryComponents,
} from "../geometryComponents.js";

// Two unit triangles far apart — two disconnected components.
const twoSeparateTris = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0],
  indices: [0, 1, 2, 3, 4, 5],
};

// Two triangles sharing an edge (a quad) — one component, even though the
// shared verts are duplicated in the buffer (boolean results do this).
const weldedQuad = {
  positions: [
    // tri A
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    // tri B reuses (1,0,0) and (1,1,0) as fresh buffer verts
    1, 0, 0, 1, 1, 0, 2, 1, 0,
  ],
  indices: [0, 1, 2, 3, 4, 5],
};

describe("geometry connected-components", () => {
  it("counts two disconnected triangles as two components", () => {
    expect(countGeometryComponents(twoSeparateTris)).toBe(2);
  });

  it("splits two disconnected triangles into two self-contained buffers", () => {
    const parts = splitGeometryComponents(twoSeparateTris);
    expect(parts).toHaveLength(2);
    parts.forEach((p) => {
      expect(p.positions).toHaveLength(9); // 3 verts each
      expect(p.indices).toEqual([0, 1, 2]);
    });
  });

  it("welds duplicated seam vertices: a shared-edge quad is one component", () => {
    expect(countGeometryComponents(weldedQuad)).toBe(1);
    expect(splitGeometryComponents(weldedQuad)).toHaveLength(1);
  });

  it("returns a single component unchanged", () => {
    const one = {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
    };
    expect(countGeometryComponents(one)).toBe(1);
    expect(splitGeometryComponents(one)).toEqual([one]);
  });

  it("handles empty geometry", () => {
    expect(countGeometryComponents({ positions: [] })).toBe(0);
    expect(countGeometryComponents(null)).toBe(0);
  });

  it("carries normals through the split", () => {
    const withNormals = {
      ...twoSeparateTris,
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    };
    const parts = splitGeometryComponents(withNormals);
    expect(parts).toHaveLength(2);
    parts.forEach((p) => expect(p.normals).toHaveLength(9));
  });
});
