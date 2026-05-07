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
vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class { computeLineDistances() {} } }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({ LineMaterial: class {} }));
vi.mock("three/addons/lines/LineGeometry.js", () => ({ LineGeometry: class { setPositions() {} } }));
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({ RoomEnvironment: class { dispose() {} } }));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({ EffectComposer: class { dispose() {} addPass() {} } }));
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: class {} }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({ UnrealBloomPass: class {} }));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: class {} }));
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({ dispose() {} }) }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIndexedBox() {
  return new THREE.BoxGeometry(2, 2, 2);
}

// Count unique vertex positions in a geometry (within eps).
function countUniqueVerts(geo, eps = 1e-4) {
  const posAttr = geo.getAttribute("position");
  const unique = [];
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const found = unique.some(
      (u) => Math.abs(u[0] - x) < eps && Math.abs(u[1] - y) < eps && Math.abs(u[2] - z) < eps,
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
  it("returns the same geometry unchanged when already indexed", () => {
    const box = makeIndexedBox();
    const result = mergeVertices(box);
    expect(result).toBe(box);
  });

  it("indexes a non-indexed geometry and deduplicates positions", () => {
    // Build a non-indexed geometry with duplicate vertices.
    const positions = new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,   // triangle 1
      0, 0, 0,  0, 1, 0,  0, 0, 1,   // triangle 2 (shares 2 verts with tri 1)
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
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const result = mergeVertices(geo);
    expect(result.getAttribute("position").count).toBe(3);
    expect(result.index.count).toBe(3);
  });

  it("merges vertices within eps tolerance", () => {
    // Two positions that differ by less than the default eps (1e-4).
    const positions = new Float32Array([0,0,0,  0,0,0.00005,  1,0,0]);
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
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
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
      (e) =>
        (e.a === 0 && e.b === 2) || (e.a === 2 && e.b === 0),
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
      { ax: -1, ay: 1, az: 1,  bx: 1, by: 1, bz: 1  }, // top-front
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
    const result = applyBevelToSubGeometry(box, { edges: [], faces: [] }, 0.1, 1);
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
    const chamferResult = applyBevelToSubGeometry(makeIndexedBox(), subGeo, 0.1, 1);
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
    const faceOnly = applyBevelToSubGeometry(makeIndexedBox(), { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] }, 0.05, 1);
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
