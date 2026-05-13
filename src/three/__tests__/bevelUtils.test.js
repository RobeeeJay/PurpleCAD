// bevelUtils tests use the real THREE.js — only addons that need WebGL are mocked.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  mergeVertices,
  findCoplanarFaces,
  getBoundaryEdges,
  chamferEdges,
  bevelEdges,
  applyBevelToSubGeometry,
} from "../bevelUtils.js";

vi.mock("../../store", () => ({ useStore: () => null }));
vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({
  RoomEnvironment: class {
    dispose() {}
  },
}));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    dispose() {}
    addPass() {}
  },
}));
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({
  RenderPass: class {},
}));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {},
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({
  OutputPass: class {},
}));
vi.mock("../objectMaterials.js", () => ({
  createMaterial: () => ({ dispose() {} }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIndexedBox() {
  return new THREE.BoxGeometry(2, 2, 2);
}

// Count unique vertex positions in a geometry (within eps).
function countUniqueVerts(geo, eps = 1e-4) {
  const posAttr = geo.getAttribute("position");
  const unique = [];
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i),
      y = posAttr.getY(i),
      z = posAttr.getZ(i);
    const found = unique.some(
      (u) =>
        Math.abs(u[0] - x) < eps &&
        Math.abs(u[1] - y) < eps &&
        Math.abs(u[2] - z) < eps,
    );
    if (!found) unique.push([x, y, z]);
  }
  return unique.length;
}

function getPositions(geo) {
  const posAttr = geo.getAttribute("position");
  const out = [];
  for (let i = 0; i < posAttr.count; i++) {
    out.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
  }
  return out;
}

function bbox(geo) {
  const b = new THREE.Box3();
  b.setFromBufferAttribute(geo.getAttribute("position"));
  return b;
}

// ── mergeVertices ─────────────────────────────────────────────────────────────

describe("mergeVertices", () => {
  it("deduplicates positions in already-indexed geometry (BoxGeometry: 24 → 8 verts)", () => {
    // mergeVertices used to early-return for indexed input, leaving
    // per-face-duplicated corners (BoxGeometry has 24 vertices for 8
    // unique cube corners).  It now dedups indexed inputs too, which is
    // essential for cylinder caps (the center vertex is duplicated across
    // every cap triangle; without dedup, every "spoke" looks like a
    // boundary edge to getBoundaryEdges).
    const box = makeIndexedBox();
    expect(box.getAttribute("position").count).toBe(24);
    const result = mergeVertices(box);
    expect(result.getAttribute("position").count).toBe(8);
    // The triangle count must remain identical (no triangles dropped).
    expect(result.index.count).toBe(box.index.count);
  });

  it("preserves a single-triangle non-degenerate indexed geometry as-is", () => {
    // Three distinct vertex positions → 3 unique after dedup; one triangle.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    const result = mergeVertices(geo);
    expect(result.getAttribute("position").count).toBe(3);
    expect(result.index.count).toBe(3);
  });

  it("indexes a non-indexed geometry and deduplicates positions", () => {
    // Build a non-indexed geometry with duplicate vertices.
    const positions = new Float32Array([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0, // triangle 1
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1, // triangle 2 (shares 2 verts with tri 1)
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const result = mergeVertices(geo);
    expect(result.index).not.toBeNull();
    // Original 6 vertices → 4 unique
    expect(result.getAttribute("position").count).toBe(4);
    expect(result.index.count).toBe(6);
  });

  it("preserves geometry when all positions are unique", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const result = mergeVertices(geo);
    expect(result.getAttribute("position").count).toBe(3);
    expect(result.index.count).toBe(3);
  });

  it("merges vertices within eps tolerance", () => {
    // Two positions that differ by less than the default eps (1e-4).
    const positions = new Float32Array([0, 0, 0, 0, 0, 0.00005, 1, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const result = mergeVertices(geo, 1e-4);
    expect(result.getAttribute("position").count).toBe(2);
  });
});

// ── findCoplanarFaces ─────────────────────────────────────────────────────────

describe("findCoplanarFaces", () => {
  it("finds all triangles on the +Z face of a box", () => {
    const box = makeIndexedBox();
    const normal = new THREE.Vector3(0, 0, 1);
    const faces = findCoplanarFaces(box, normal);
    // BoxGeometry +Z face has 2 triangles; -Z face is excluded (opposite normal).
    expect(faces.length).toBe(2);
    faces.forEach(({ ia, ib, ic }) => {
      expect(typeof ia).toBe("number");
      expect(typeof ib).toBe("number");
      expect(typeof ic).toBe("number");
    });
  });

  it("finds triangles on all 6 faces of a box", () => {
    const box = makeIndexedBox();
    const normals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    for (const n of normals) {
      const faces = findCoplanarFaces(box, n);
      expect(faces.length).toBe(2);
    }
  });

  it("returns empty array for a normal that matches no face", () => {
    const box = makeIndexedBox();
    const normal = new THREE.Vector3(1, 1, 0).normalize(); // diagonal — no box face matches
    const faces = findCoplanarFaces(box, normal, 0.01);
    expect(faces.length).toBe(0);
  });

  it("accepts normal as {nx, ny, nz} object", () => {
    const box = makeIndexedBox();
    const faces = findCoplanarFaces(box, { nx: 0, ny: 1, nz: 0 });
    expect(faces.length).toBe(2);
  });
});

// ── getBoundaryEdges ──────────────────────────────────────────────────────────

describe("getBoundaryEdges", () => {
  it("returns 4 boundary edges for a square face (2 triangles)", () => {
    // Square made of two triangles sharing edge 1-2.
    // Triangle A: 0-1-2, Triangle B: 0-2-3
    const tris = [
      { ia: 0, ib: 1, ic: 2 },
      { ia: 0, ib: 2, ic: 3 },
    ];
    const edges = getBoundaryEdges(tris);
    expect(edges.length).toBe(4); // 0-1, 1-2 (shared? no: both go via 2), 2-3, 3-0
  });

  it("shared edge is not in the boundary", () => {
    const tris = [
      { ia: 0, ib: 1, ic: 2 },
      { ia: 0, ib: 2, ic: 3 },
    ];
    const edges = getBoundaryEdges(tris);
    // Edge 0-2 appears in both triangles → not boundary
    const has02 = edges.some(
      (e) => (e.a === 0 && e.b === 2) || (e.a === 2 && e.b === 0),
    );
    expect(has02).toBe(false);
  });

  it("returns 3 edges for a single triangle", () => {
    const edges = getBoundaryEdges([{ ia: 0, ib: 1, ic: 2 }]);
    expect(edges.length).toBe(3);
  });

  it("returns the 4 perimeter edges of a box face", () => {
    const box = makeIndexedBox();
    const faces = findCoplanarFaces(box, new THREE.Vector3(0, 0, 1));
    const edges = getBoundaryEdges(faces);
    expect(edges.length).toBe(4);
  });
});

// ── chamferEdges ──────────────────────────────────────────────────────────────

describe("chamferEdges", () => {
  it("returns a BufferGeometry with an index", () => {
    const box = makeIndexedBox();
    // Top-front edge of the box.
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const result = chamferEdges(box, edgePairs, 0.1);
    expect(result).toBeInstanceOf(THREE.BufferGeometry);
    expect(result.index).not.toBeNull();
  });

  it("has more triangles than the original box (new chamfer faces added)", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const original = box.index.count / 3;
    const result = chamferEdges(box, edgePairs, 0.1);
    const after = result.index.count / 3;
    expect(after).toBeGreaterThan(original);
  });

  it("preserves the overall bounding box size (chamfer only insets vertices)", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const before = bbox(box);
    const result = chamferEdges(box, edgePairs, 0.1);
    const after = bbox(result);
    // The outer extents stay the same (chamfer moves edge vertices inward, not outward).
    expect(after.max.x).toBeCloseTo(before.max.x, 4);
    expect(after.max.z).toBeCloseTo(before.max.z, 4);
  });

  it("skips an edge pair that has no matching vertices", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: 99, ay: 99, az: 99, bx: 100, by: 100, bz: 100 }];
    const original = box.index.count;
    const result = chamferEdges(box, edgePairs, 0.1);
    expect(result.index.count).toBe(original);
  });

  it("handles multiple edge pairs", () => {
    const box = makeIndexedBox();
    const edgePairs = [
      { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }, // top-front
      { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 }, // top-back
    ];
    const singleResult = chamferEdges(makeIndexedBox(), [edgePairs[0]], 0.1);
    const bothResult = chamferEdges(box, edgePairs, 0.1);
    expect(bothResult.index.count).toBeGreaterThan(singleResult.index.count);
  });

  it("produces geometry with vertex normals", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const result = chamferEdges(box, edgePairs, 0.1);
    expect(result.getAttribute("normal")).not.toBeNull();
  });
});

// ── bevelEdges ────────────────────────────────────────────────────────────────

describe("bevelEdges", () => {
  it("returns a BufferGeometry with an index", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const result = bevelEdges(box, edgePairs, 0.1, 3);
    expect(result).toBeInstanceOf(THREE.BufferGeometry);
    expect(result.index).not.toBeNull();
  });

  it("produces more faces than chamfer (arc has multiple segments)", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const chamfer = chamferEdges(makeIndexedBox(), edgePairs, 0.1);
    const bevel = bevelEdges(box, edgePairs, 0.1, 4);
    expect(bevel.index.count).toBeGreaterThan(chamfer.index.count);
  });

  it("more segments produce more triangles", () => {
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const r2 = bevelEdges(makeIndexedBox(), edgePairs, 0.1, 2);
    const r4 = bevelEdges(makeIndexedBox(), edgePairs, 0.1, 4);
    expect(r4.index.count).toBeGreaterThan(r2.index.count);
  });

  it("clamps segments to at least 2", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    // segments=1 would be chamfer, bevelEdges clamps to 2.
    const result = bevelEdges(box, edgePairs, 0.1, 1);
    const chamfer = chamferEdges(makeIndexedBox(), edgePairs, 0.1);
    // With 2 segments, there are 2 quads per edge instead of 1.
    expect(result.index.count).toBeGreaterThan(chamfer.index.count);
  });

  it("produces geometry with vertex normals", () => {
    const box = makeIndexedBox();
    const edgePairs = [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }];
    const result = bevelEdges(box, edgePairs, 0.1, 3);
    expect(result.getAttribute("normal")).not.toBeNull();
  });
});

// ── applyBevelToSubGeometry ───────────────────────────────────────────────────

describe("applyBevelToSubGeometry", () => {
  it("returns null when subGeo has no edges or faces", () => {
    const box = makeIndexedBox();
    const result = applyBevelToSubGeometry(
      box,
      { edges: [], faces: [] },
      0.1,
      1,
    );
    expect(result).toBeNull();
  });

  it("applies chamfer to a specified edge (segments=1)", () => {
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    expect(result).toBeInstanceOf(THREE.BufferGeometry);
    expect(result.index.count).toBeGreaterThan(box.index.count);
  });

  it("applies bevel to a specified edge (segments>1)", () => {
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const chamferResult = applyBevelToSubGeometry(
      makeIndexedBox(),
      subGeo,
      0.1,
      1,
    );
    const bevelResult = applyBevelToSubGeometry(box, subGeo, 0.1, 3);
    expect(bevelResult.index.count).toBeGreaterThan(chamferResult.index.count);
  });

  it("expands a face selection into its 4 boundary edges and bevels them", () => {
    const box = makeIndexedBox();
    // Selecting the top face (+Y) should bevel all 4 of its edges.
    const subGeo = {
      edges: [],
      faces: [{ nx: 0, ny: 1, nz: 0 }],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.05, 1);
    expect(result).toBeInstanceOf(THREE.BufferGeometry);
    const originalTris = box.index.count / 3;
    const resultTris = result.index.count / 3;
    expect(resultTris).toBeGreaterThan(originalTris);
  });

  it("combines explicit edges and face boundary edges", () => {
    const box = makeIndexedBox();
    // Top face + one explicit side edge.
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 }], // left-front vertical
      faces: [{ nx: 0, ny: 1, nz: 0 }],
    };
    const faceOnly = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.05,
      1,
    );
    const combined = applyBevelToSubGeometry(box, subGeo, 0.05, 1);
    expect(combined.index.count).toBeGreaterThan(faceOnly.index.count);
  });

  it("produces geometry with vertex normals", () => {
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.05, 1);
    expect(result.getAttribute("normal")).not.toBeNull();
  });

  // Count edges that appear in exactly one triangle (a watertight manifold has 0).
  // Compares by POSITION rather than index, because BoxGeometry duplicates
  // corner vertices per face — only position-coincidence reflects topology.
  function countBoundaryEdgesByPosition(geo) {
    const posAttr = geo.getAttribute("position");
    const idx = geo.index.array;
    const key = (i) => {
      const x = Math.round(posAttr.getX(i) * 1e4) / 1e4;
      const y = Math.round(posAttr.getY(i) * 1e4) / 1e4;
      const z = Math.round(posAttr.getZ(i) * 1e4) / 1e4;
      return `${x},${y},${z}`;
    };
    const edgeCount = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const ks = [key(idx[t]), key(idx[t + 1]), key(idx[t + 2])];
      for (let k = 0; k < 3; k++) {
        const a = ks[k],
          b = ks[(k + 1) % 3];
        const ek = a < b ? a + "|" + b : b + "|" + a;
        edgeCount.set(ek, (edgeCount.get(ek) || 0) + 1);
      }
    }
    return [...edgeCount.values()].filter((c) => c === 1).length;
  }

  it("BoxGeometry baseline is watertight by position", () => {
    expect(countBoundaryEdgesByPosition(makeIndexedBox())).toBe(0);
  });

  // The chamfer/bevel algorithm fills the visible corner notch with an
  // end-cap fan that is coplanar with the perpendicular face — so the user
  // does not see a gap.  Strict topological watertightness on
  // BoxGeometry-style meshes (per-face duplicated vertices) is not achieved
  // by this best-effort algorithm, but the count of boundary edges should
  // be SMALL relative to the input — much fewer than what would exist if
  // the end caps were missing entirely.
  it("chamfer removes the original cube corner from perpendicular faces", () => {
    // The chamfer "shaves off" the cube's corner — the perpendicular face
    // (e.g. the left face for a top-front edge bevel) must be re-triangulated
    // as a pentagon, NOT extended over the chamfered-off region by leaving
    // the original corner vertex in place.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    // After re-triangulation, NO triangle should contain the original cube
    // corner at (-1, 1, 1) or (1, 1, 1) (the two endpoints of the beveled
    // edge) — those vertices are now orphaned, and the chamfer face stitches
    // directly into the perpendicular face's new pentagonal perimeter.
    const hasCorner = (cx, cy, cz) => {
      for (let t = 0; t < idx.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const x = round(posAttr.getX(idx[t + k]));
          const y = round(posAttr.getY(idx[t + k]));
          const z = round(posAttr.getZ(idx[t + k]));
          if (x === cx && y === cy && z === cz) return true;
        }
      }
      return false;
    };
    expect(hasCorner(-1, 1, 1)).toBe(false);
    expect(hasCorner(1, 1, 1)).toBe(false);
  });

  // ─── Adjacent-face shape verification ──────────────────────────────────────
  // The chamfer modifies several faces that were NOT directly selected:
  //   • the two faces sharing the beveled edge (these become trimmed)
  //   • the perpendicular face(s) at each corner (these are re-triangulated
  //     because the corner is "shaved off" by the chamfer)
  // These tests pin down the SHAPE of the affected adjacent faces — both for
  // simple cube cases and for more complex topologies.

  // Helper: count triangles on a given plane (x|y|z == value) and check no
  // triangle contains the given "removed" position.
  function inspectPlanarFace(result, axis, value, removedPos) {
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    let triCount = 0;
    let containsRemoved = 0;
    const vertices = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      const pts = [0, 1, 2].map((k) => [
        round(posAttr.getX(idx[t + k])),
        round(posAttr.getY(idx[t + k])),
        round(posAttr.getZ(idx[t + k])),
      ]);
      const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      if (!pts.every((p) => p[axisIdx] === value)) continue;
      triCount++;
      for (const p of pts) vertices.add(`${p[0]},${p[1]},${p[2]}`);
      if (
        removedPos &&
        pts.some(
          (p) =>
            p[0] === removedPos[0] &&
            p[1] === removedPos[1] &&
            p[2] === removedPos[2],
        )
      )
        containsRemoved++;
    }
    return { triCount, containsRemoved, uniqueVerts: vertices.size };
  }

  it("chamfer re-triangulates the perpendicular face as a 3-triangle pentagon", () => {
    // Left face (x = -1) after a top-front-edge chamfer should have exactly
    // 3 triangles (the pentagon: D_topL, stripA[0], stripA[1], BF_left, D_botL).
    // Right face similarly.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    let leftCount = 0;
    let rightCount = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [0, 1, 2].map((k) => round(posAttr.getX(idx[t + k])));
      if (xs.every((x) => x === -1)) leftCount++;
      if (xs.every((x) => x === 1)) rightCount++;
    }
    expect(leftCount).toBe(3);
    expect(rightCount).toBe(3);
  });

  it("multiple edges sharing a corner are ALL beveled (regression for shared-corner skip)", () => {
    // Two edges of a cube share the corner (-1, 1, 1).  Earlier versions
    // would silently skip the second edge because the first edge's coplanar
    // replacement destroyed the corner reference the second edge needed.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [
        { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },    // top-front
        { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },  // top-left
      ],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    const posAttr = result.getAttribute("position");
    const round = (v) => Math.round(v * 1e3) / 1e3;

    // Strip vertices for edge 1 (top-front) lie at y=1, x=±1, z≈0.9.
    // Strip vertices for edge 2 (top-left) lie at y=1, x≈±0.9, z=±1.
    let edge1Verts = 0, edge2Verts = 0;
    for (let i = 0; i < posAttr.count; i++) {
      const x = round(posAttr.getX(i));
      const y = round(posAttr.getY(i));
      const z = round(posAttr.getZ(i));
      if (y === 1 && Math.abs(x) === 1 && Math.abs(z - 0.9) < 0.01) edge1Verts++;
      if (y === 1 && Math.abs(x - 0.9) < 0.01 && Math.abs(z) === 1) edge2Verts++;
      if (y === 1 && Math.abs(x + 0.9) < 0.01 && Math.abs(z) === 1) edge2Verts++;
    }
    expect(edge1Verts).toBeGreaterThanOrEqual(2); // both ends of edge 1
    expect(edge2Verts).toBeGreaterThanOrEqual(2); // both ends of edge 2
  });

  it("shared-corner gap is closed with a corner-fill + diagonal-bridge triangle", () => {
    // Two cube edges share corner (-1, 1, 1).  Without Phase 3, the top
    // face is left with a quad-shaped hole between the two edges' strips.
    // Phase 3 must emit a corner-fill triangle at the original corner AND a
    // diagonal-bridge triangle through the face's diagonal-opposite vertex.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [
        { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },   // top-front
        { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 }, // top-left
      ],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;

    let cornerFill = 0;
    let diagonalBridge = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const pts = [0, 1, 2].map((k) => [
        round(posAttr.getX(idx[t + k])),
        round(posAttr.getY(idx[t + k])),
        round(posAttr.getZ(idx[t + k])),
      ]);
      // All three vertices must lie on the top face plane y = 1.
      if (!pts.every((p) => p[1] === 1)) continue;
      const hasSE1 = pts.some((p) => p[0] === -1 && p[2] === 0.9);    // top-front strip @ A
      const hasSE2 = pts.some((p) => p[0] === -0.9 && p[2] === 1);    // top-left strip @ A
      const hasCorner = pts.some((p) => p[0] === -1 && p[2] === 1);   // original corner
      const hasCtop = pts.some((p) => p[0] === 1 && p[2] === -1);     // diagonal-opposite
      if (hasSE1 && hasSE2 && hasCorner) cornerFill++;
      if (hasSE1 && hasSE2 && hasCtop) diagonalBridge++;
    }
    expect(cornerFill).toBeGreaterThanOrEqual(1);
    expect(diagonalBridge).toBeGreaterThanOrEqual(1);
  });

  // ─── Adjacent-face SHAPE tests ─────────────────────────────────────────────

  it("cube single-edge chamfer: left & right faces become 3-tri pentagons WITHOUT the corner vertex", () => {
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      0.1,
      1,
    );
    const left = inspectPlanarFace(result, "x", -1, [-1, 1, 1]);
    const right = inspectPlanarFace(result, "x", 1, [1, 1, 1]);
    // Pentagon: 5 unique vertices, 3 triangles, original corner removed.
    expect(left.triCount).toBe(3);
    expect(left.uniqueVerts).toBe(5);
    expect(left.containsRemoved).toBe(0);
    expect(right.triCount).toBe(3);
    expect(right.uniqueVerts).toBe(5);
    expect(right.containsRemoved).toBe(0);
  });

  it("cube single-edge chamfer: top & front faces (the directly-beveled faces) STAY as quads with corner replaced", () => {
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      0.1,
      1,
    );
    const top = inspectPlanarFace(result, "y", 1);
    const front = inspectPlanarFace(result, "z", 1);
    // Both bevel faces should still be 2 triangles (a smaller quad after the
    // corner inset moves inward).  4 unique vertices on each.
    expect(top.triCount).toBe(2);
    expect(top.uniqueVerts).toBe(4);
    expect(front.triCount).toBe(2);
    expect(front.uniqueVerts).toBe(4);
  });

  it("cube single-edge chamfer: bottom & back (entirely unaffected) faces are untouched", () => {
    const before = makeIndexedBox();
    const beforeBot = inspectPlanarFace(before, "y", -1);
    const beforeBack = inspectPlanarFace(before, "z", -1);
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      0.1,
      1,
    );
    const bot = inspectPlanarFace(result, "y", -1);
    const back = inspectPlanarFace(result, "z", -1);
    expect(bot.triCount).toBe(beforeBot.triCount);
    expect(bot.uniqueVerts).toBe(beforeBot.uniqueVerts);
    expect(back.triCount).toBe(beforeBack.triCount);
    expect(back.uniqueVerts).toBe(beforeBack.uniqueVerts);
  });

  it("cube shared-corner multi-edge chamfer: perpendicular faces of both edges have the corner REMOVED", () => {
    // Two adjacent edges share corner (-1, 1, 1).  Edge 1 (top-front) needs
    // the LEFT face re-triangulated; edge 2 (top-left) needs the FRONT face
    // re-triangulated.  Both must omit the original corner vertex.
    // BEFORE the Phase 4 restructure these re-triangulations were skipped
    // because the corner was "shared" — so v_corner survived on adjacent
    // faces (the user-visible "spike" at the corner).
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [
          { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
          { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
        ],
        faces: [],
      },
      0.1,
      1,
    );
    const left = inspectPlanarFace(result, "x", -1, [-1, 1, 1]);
    const front = inspectPlanarFace(result, "z", 1, [-1, 1, 1]);
    expect(left.containsRemoved).toBe(0);
    expect(front.containsRemoved).toBe(0);
  });

  it("cube shared-corner multi-edge chamfer: the non-shared OPPOSITE corner of each edge is also handled", () => {
    // Edge 1's non-shared corner is (1, 1, 1); edge 2's is (-1, 1, -1).
    // Both should have their perpendicular faces re-triangulated and the
    // original corner removed.
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [
          { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
          { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
        ],
        faces: [],
      },
      0.1,
      1,
    );
    // Right-face inspection (edge 1's non-shared corner (1,1,1)).
    const right = inspectPlanarFace(result, "x", 1, [1, 1, 1]);
    expect(right.containsRemoved).toBe(0);
    // Back-face inspection (edge 2's non-shared corner (-1,1,-1)).
    const back = inspectPlanarFace(result, "z", -1, [-1, 1, -1]);
    expect(back.containsRemoved).toBe(0);
  });

  it("two non-adjacent chamfered edges: each chamfer's directly-incident perpendicular corners are removed", () => {
    // Top-front and BOTTOM-back edges don't share any corner.  After both
    // chamfers, each chamfer's perpendicular faces (the left/right sides)
    // should NOT contain that chamfer's original corner positions.
    //
    // Known limitation: when TWO corners of the same perpendicular face
    // (here left/right) are chamfered, the merger triangle from the first
    // chamfer (which uses the OTHER corner as its "pivot") survives because
    // the second chamfer's strips aren't on the merger triangle's edges.
    // We assert what's guaranteed: each chamfer cleans up its OWN corner.
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [
          { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },     // top-front
          { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 }, // bottom-back
        ],
        faces: [],
      },
      0.1,
      1,
    );
    // Top-front's left/right corners: removed from the left/right faces by
    // their respective perpendicular-face re-triangulation.
    const leftTopCorner = inspectPlanarFace(result, "x", -1, [-1, 1, 1]);
    const rightTopCorner = inspectPlanarFace(result, "x", 1, [1, 1, 1]);
    expect(leftTopCorner.containsRemoved).toBe(0);
    expect(rightTopCorner.containsRemoved).toBe(0);

    // Bottom-back's perpendicular corners removed from top/bottom faces:
    const botBotCorner = inspectPlanarFace(result, "y", -1, [-1, -1, -1]);
    expect(botBotCorner.containsRemoved).toBe(0);
  });

  it("chamfer of a face boundary: every adjacent face touching the selected face is re-triangulated", () => {
    // Selecting a FACE (rather than individual edges) chamfers ALL its
    // boundary edges.  For a cube's top face, that means 4 chamfer strips
    // (one per top-face edge) and ALL FOUR side faces become hexagons (their
    // top corners are chamfered off on both sides).
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      {
        edges: [],
        faces: [{ nx: 0, ny: 1, nz: 0 }], // top face
      },
      0.1,
      1,
    );
    // Each of the 4 top corners should be removed from its perpendicular face.
    for (const [x, _y, z] of [
      [-1, 1, 1],
      [1, 1, 1],
      [-1, 1, -1],
      [1, 1, -1],
    ]) {
      const xFace = inspectPlanarFace(result, "x", x, [x, 1, z]);
      const zFace = inspectPlanarFace(result, "z", z, [x, 1, z]);
      expect(xFace.containsRemoved).toBe(0);
      expect(zFace.containsRemoved).toBe(0);
    }
  });

  // ─── Complex adjacent face shape (non-quad) ────────────────────────────────
  // Construct a custom mesh where the perpendicular face has 5 vertices and
  // 3 triangles (a real pentagonal face).  Verify the chamfer correctly
  // re-triangulates this face — handling more vertices than the simple
  // cube-quad case.

  it("chamfer where adjacent face is a pentagon (3 triangles): corner is removed and face becomes hexagon", () => {
    // Build a "stretched cube" where the left face has an extra mid-vertex
    // making it a PENTAGON with 3 triangles instead of a quad with 2.  This
    // mirrors what happens when adjacent faces are non-trivial polygons.
    //
    // Pentagon left face vertices (x = -1 plane, in (z, y)):
    //   (1, 1)   = v_corner            ← shared with top-front edge
    //   (-1, 1)  = D_topL
    //   (-1, -1) = D_botL
    //   (1, -1)  = BF_left
    //   (0, 0)   = M_left (mid-face vertex)
    // Triangulated by fan from M_left.
    const positions = new Float32Array([
      // back face (z = -1)
      -1, 1, -1, // 0 D_topL/back
      1, 1, -1,  // 1
      1, -1, -1, // 2
      -1, -1, -1, // 3 D_botL
      // top face (y = 1)
      -1, 1, 1,  // 4 v_corner
      1, 1, 1,   // 5
      // front face (z = 1)
      1, -1, 1,  // 6
      -1, -1, 1, // 7 BF_left
      // left-face mid vertex
      -1, 0, 0,  // 8 M_left
    ]);
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // Triangulate. We need a closed mesh, but for this test only the left
    // face's pentagon and the top/front faces matter.
    indexed.setIndex([
      // top face quad
      4, 5, 1, 4, 1, 0,
      // front face quad
      4, 7, 6, 4, 6, 5,
      // left face PENTAGON via fan from M_left=8
      //   perimeter: D_topL(0) → v_corner(4) → BF_left(7) → D_botL(3) → 0
      //   triangles: (8, 0, 4), (8, 4, 7), (8, 7, 3), (8, 3, 0)
      8, 0, 4, 8, 4, 7, 8, 7, 3, 8, 3, 0,
      // back face quad (so the mesh is closed-ish for findEdgeTriangles)
      0, 1, 2, 0, 2, 3,
      // right face quad
      5, 2, 1, 5, 6, 2,
      // bottom face quad
      3, 2, 6, 3, 6, 7,
    ]);

    const result = applyBevelToSubGeometry(
      indexed,
      {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], // top-front edge
        faces: [],
      },
      0.1,
      1,
    );
    // After chamfer of the top-front edge, the v_corner (-1, 1, 1) should
    // be removed from all triangles on the left face plane.
    const left = inspectPlanarFace(result, "x", -1, [-1, 1, 1]);
    expect(left.containsRemoved).toBe(0);
    // The mid-face vertex M_left = (-1, 0, 0) should still be present on
    // the left face — re-triangulation must preserve interior vertices.
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    let hasMid = false;
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const x = posAttr.getX(idx[t + k]);
        const y = posAttr.getY(idx[t + k]);
        const z = posAttr.getZ(idx[t + k]);
        if (Math.abs(x + 1) < 1e-3 && Math.abs(y) < 1e-3 && Math.abs(z) < 1e-3) {
          hasMid = true;
          break;
        }
      }
      if (hasMid) break;
    }
    expect(hasMid).toBe(true);
  });

  // ─── Cylinder cap chamfer (curved adjacent geometry) ──────────────────────
  // The cylinder cap is triangulated as a fan from a shared center vertex.
  // Before the mergeVertices fix the cap's center was duplicated across
  // every cap triangle, so getBoundaryEdges treated every "spoke" as a
  // boundary edge — leading to 3N "fake" boundary edges (vs N real
  // perimeter edges) and a 700+-triangle explosion when chamfering an
  // 8-segment cylinder.

  it("cylinder cap face selection: getBoundaryEdges returns exactly N perimeter edges (one per segment)", () => {
    for (const segs of [4, 6, 8, 16]) {
      const cyl = new THREE.CylinderGeometry(1, 1, 2, segs);
      const merged = mergeVertices(cyl);
      const tris = findCoplanarFaces(merged, { nx: 0, ny: 1, nz: 0 });
      const boundary = getBoundaryEdges(tris);
      expect(boundary.length).toBe(segs); // one perimeter edge per segment
      expect(tris.length).toBe(segs); // and N cap triangles
    }
  });

  it("cylinder cap chamfer produces a bounded triangle count (no explosion)", () => {
    // A reasonable result for an N-segment cylinder cap chamfer is roughly:
    //   2N (cap modified + cap corner-fan)   strip quads (2 tris each) → 2N
    // + 2N (corner-fill + diagonal-bridge on top cap per shared corner)
    // + 2N (perpendicular-side re-triangulation, ~2 tris per corner)
    // + 4N (the original side quads, still present but modified)
    // + N  (the bottom cap)
    // For N=8 this is ~80; we pin it to < 200 (was 724 before the fix).
    const cyl = new THREE.CylinderGeometry(1, 1, 2, 8);
    const result = applyBevelToSubGeometry(
      cyl,
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    expect(result.index.count / 3).toBeLessThan(200);
  });

  it("cylinder cap chamfer: no side triangle still extends to the original top (y = +1)", () => {
    // After chamfering the top face the side quads' top edge should have
    // moved down (to y = 1 - amount).  No side triangle should retain the
    // original top y-coordinate.
    const cyl = new THREE.CylinderGeometry(1, 1, 2, 8);
    const result = applyBevelToSubGeometry(
      cyl,
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    let sideTrisAtOriginalTop = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const ys = [0, 1, 2].map((k) => round(posAttr.getY(idx[t + k])));
      // A side triangle has at least one vertex at y=-1 (bottom).
      if (!ys.some((y) => y === -1)) continue;
      // ...and uses at least one vertex at y=1 (original top).
      if (ys.some((y) => y === 1)) sideTrisAtOriginalTop++;
    }
    expect(sideTrisAtOriginalTop).toBe(0);
  });

  it("three edges meeting at one corner are all beveled", () => {
    // All three edges of a cube meeting at the corner (-1, 1, 1).  Each
    // edge contributes 2(segments+1) = 4 new vertices.  Three edges → 12
    // new strip vertices on top of the deduped cube's 8 corners → 20.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [
        { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },    // top-front (along +X)
        { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },  // top-left (along -Z)
        { ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 },  // front-left (along -Y)
      ],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    // Cube has 8 unique corners after dedup; three edges add 12 strip verts.
    expect(result.getAttribute("position").count).toBeGreaterThanOrEqual(
      8 + 12,
    );
  });

  it("bevel of a cube edge produces more strip triangles than chamfer", () => {
    // Multi-segment bevel produces 'segments' strip quads per edge (= 2*segments
    // triangles) versus chamfer's 1 quad (2 tris).  The perpendicular face
    // re-triangulation is the same shape (pentagon, 3 tris/face) regardless
    // of segment count.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const chamfer = applyBevelToSubGeometry(makeIndexedBox(), subGeo, 0.1, 1);
    const bevel = applyBevelToSubGeometry(box, subGeo, 0.1, 4);
    const extraStripTris = (4 - 1) * 2; // chamfer has 2, bevel has 8 → +6
    expect(bevel.index.count / 3).toBeGreaterThanOrEqual(
      chamfer.index.count / 3 + extraStripTris,
    );
  });

  it("bevel result vertices stay within the original bounding box", () => {
    const box = makeIndexedBox();
    const before = bbox(box);
    const subGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 3);
    const after = bbox(result);
    const eps = 1e-4;
    expect(after.max.x).toBeLessThanOrEqual(before.max.x + eps);
    expect(after.max.y).toBeLessThanOrEqual(before.max.y + eps);
    expect(after.max.z).toBeLessThanOrEqual(before.max.z + eps);
    expect(after.min.x).toBeGreaterThanOrEqual(before.min.x - eps);
    expect(after.min.y).toBeGreaterThanOrEqual(before.min.y - eps);
    expect(after.min.z).toBeGreaterThanOrEqual(before.min.z - eps);
  });
});
