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
  combineBevelSubGeoOnSource,
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

  it("shared-corner: top face is a 4-vertex quad (intersection vertex replaces shared-corner strips)", () => {
    // α (top-front) + β (top-left) share corner (-1, 1, 1).  Phase 1.5
    // computes an intersection vertex on TOP at (-0.9, 1, 0.9) where the
    // two strips' TOP edges cross; that intersection replaces BOTH strip
    // endpoints at the shared corner in the face perimeter.  The
    // 1-chamfer corners' strip endpoints (α's stripB[0]=(1, 1, 0.9) and
    // β's stripB[0]=(-0.9, 1, -1)) stay, and the unchamfered corner
    // (1, 1, -1) survives.  Result: 4 unique vertices = quad, 2 tris.
    const box = makeIndexedBox();
    const subGeo = {
      edges: [
        { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },   // top-front
        { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 }, // top-left
      ],
      faces: [],
    };
    const result = applyBevelToSubGeometry(box, subGeo, 0.1, 1);
    const top = inspectPlanarFace(result, "y", 1);
    expect(top.uniqueVerts).toBe(4);
    expect(top.triCount).toBe(2);
    const r = inspectPlanarFace(result, "y", 1, [-1, 1, 1]);
    expect(r.containsRemoved).toBe(0);
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

  it("two non-adjacent chamfered edges: NEITHER chamfer's corner survives on the shared perpendicular face (Phase 5)", () => {
    // The cube's LEFT face gets cut at BOTH top-front-left (-1,1,1) and
    // bottom-back-left (-1,-1,-1).  Before Phase 5, the merger triangle
    // emitted by top-front's retriangulate would retain (-1,-1,-1) — which
    // bottom-back later chamfers away — and the triangle would extend into
    // the chamfer notch, producing a visible "face beyond the bounds of the
    // chamfer".  Phase 5 splits that leftover triangle using bottom-back's
    // strip endpoints so the LEFT face becomes a proper hexagon with NO
    // chamfered corner anywhere in it.
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
    // The LEFT face (x=-1) should have no triangle touching either (-1,1,1)
    // OR (-1,-1,-1) — both of those corners were chamfered.
    const leftTopFront = inspectPlanarFace(result, "x", -1, [-1, 1, 1]);
    const leftBotBack = inspectPlanarFace(result, "x", -1, [-1, -1, -1]);
    expect(leftTopFront.containsRemoved).toBe(0);
    expect(leftBotBack.containsRemoved).toBe(0);
    // Same for RIGHT face (x=1).
    const rightTopFront = inspectPlanarFace(result, "x", 1, [1, 1, 1]);
    const rightBotBack = inspectPlanarFace(result, "x", 1, [1, -1, -1]);
    expect(rightTopFront.containsRemoved).toBe(0);
    expect(rightBotBack.containsRemoved).toBe(0);
  });

  // ─── Watertightness regression: chamfers on many / all cube edges ─────────
  // The user-visible bug: at corners where 3 chamfered edges meet, the
  // mesh should resolve to a "rounded cube" topology — each cube face
  // becomes an octagon (4 corners cut off), each cube edge gets a chamfer
  // strip, and each cube corner is closed by a single corner-fan triangle
  // connecting the 3 strip endpoints.  Anything else means a spurious
  // face extending into the chamfer notch (the "spike" the user sees).

  const CUBE_EDGES = [
    // 4 top edges
    { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },   // top-front
    { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 }, // top-back
    { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 }, // top-left
    { ax: 1, ay: 1, az: 1, bx: 1, by: 1, bz: -1 },   // top-right
    // 4 bottom edges
    { ax: -1, ay: -1, az: 1, bx: 1, by: -1, bz: 1 },
    { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 },
    { ax: -1, ay: -1, az: 1, bx: -1, by: -1, bz: -1 },
    { ax: 1, ay: -1, az: 1, bx: 1, by: -1, bz: -1 },
    // 4 vertical edges
    { ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 },   // front-left
    { ax: 1, ay: 1, az: 1, bx: 1, by: -1, bz: 1 },     // front-right
    { ax: -1, ay: 1, az: -1, bx: -1, by: -1, bz: -1 }, // back-left
    { ax: 1, ay: 1, az: -1, bx: 1, by: -1, bz: -1 },   // back-right
  ];

  // The 8 cube corners — at every one of these, 3 chamfered edges meet
  // when all 12 edges are chamfered.
  const CUBE_CORNERS = [
    [-1, 1, 1], [1, 1, 1], [-1, 1, -1], [1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [-1, -1, -1], [1, -1, -1],
  ];

  it("all 12 cube edges chamfered: no original cube corner survives in the mesh", () => {
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: CUBE_EDGES, faces: [] },
      0.1,
      1,
    );
    // None of the original 8 cube corner positions should be referenced
    // by any triangle — they've all been chamfered away.
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    for (const [cx, cy, cz] of CUBE_CORNERS) {
      let count = 0;
      for (let t = 0; t < idx.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          if (
            round(posAttr.getX(idx[t + k])) === cx &&
            round(posAttr.getY(idx[t + k])) === cy &&
            round(posAttr.getZ(idx[t + k])) === cz
          ) {
            count++;
          }
        }
      }
      expect(count, `corner (${cx},${cy},${cz}) referenced ${count} times`).toBe(0);
    }
  });

  it("all 12 cube edges chamfered: every chamfered cube corner is removed from the surface", () => {
    // Strong topology check: with all 12 edges chamfered every cube corner
    // (cornerHits >= 3) is fully cut off — no triangle in the result may
    // contain any of the 8 original cube corner positions.  This was the
    // primary user-facing bug ("faces extend beyond the chamfer") — the
    // leftover triangles at chamfered-away corners.  Already covered by
    // the "no original cube corner survives" test above; this one also
    // checks that no boundary edge attaches to a chamfered corner.
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: CUBE_EDGES, faces: [] },
      0.1,
      1,
    );
    const posAttr = result.getAttribute("position");
    const idx = result.index.array;
    const round = (v) => Math.round(v * 1e3) / 1e3;
    for (const [cx, cy, cz] of CUBE_CORNERS) {
      for (let t = 0; t < idx.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const x = round(posAttr.getX(idx[t + k]));
          const y = round(posAttr.getY(idx[t + k]));
          const z = round(posAttr.getZ(idx[t + k]));
          if (x === cx && y === cy && z === cz) {
            throw new Error(
              `triangle at idx ${t / 3} references chamfered corner (${cx},${cy},${cz})`,
            );
          }
        }
      }
    }
  });

  it("all 12 cube edges chamfered: mesh is watertight (zero boundary edges by position)", () => {
    // Phase 1.5 intersection vertices + Phase 6/7 using them close the
    // mesh.  Each cube face is a rectangle of 4 intersections; each
    // chamfer strip is a quad of 4 intersections; each cube corner has
    // a fan triangle of 3 intersections.  All edges shared by 2 tris.
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: CUBE_EDGES, faces: [] },
      0.1,
      1,
    );
    expect(countBoundaryEdgesByPosition(result)).toBe(0);
  });

  it("all 12 cube edges chamfered: each cube face is a rectangle (4 intersection vertices)", () => {
    // With intersection vertices, every face-corner with 2 chamfered face-
    // edges meeting is replaced by a single intersection vertex (inset
    // from the cube corner on the face plane).  All 4 face-corners on
    // each cube face have 2 chamfered face-edges → 4 intersection
    // vertices = rectangle.
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: CUBE_EDGES, faces: [] },
      0.1,
      1,
    );
    for (const axis of ["x", "y", "z"]) {
      for (const value of [-1, 1]) {
        const face = inspectPlanarFace(result, axis, value);
        expect(
          face.uniqueVerts,
          `face ${axis}=${value} has ${face.uniqueVerts} verts (expected 4)`,
        ).toBe(4);
      }
    }
  });

  it("4 top cube edges chamfered: top face is a rectangle (4 intersection vertices)", () => {
    // Each top face-corner has 2 chamfered face-edges meeting → Phase 1.5
    // computes 4 intersection vertices, one per corner.  Phase 6 uses
    // them as the TOP face's perimeter, replacing the 8 strip endpoints
    // (which now sit at the cube-edge ends of the chamfer strips, part
    // of the corner-extension regions rather than the face perimeter).
    const result = applyBevelToSubGeometry(
      makeIndexedBox(),
      { edges: CUBE_EDGES.slice(0, 4), faces: [] },
      0.1,
      1,
    );
    const top = inspectPlanarFace(result, "y", 1);
    expect(top.uniqueVerts).toBe(4);
  });

  it("two non-adjacent chamfered edges: LEFT face is a 6-vertex hexagon with 4 triangles", () => {
    // After the Phase 5 cleanup, the LEFT face's hexagonal shape (both
    // top-front-left and bottom-back-left corners removed) should be
    // covered by exactly 4 triangles spanning 6 unique vertices — no
    // leftover triangles extending into the chamfer notches.
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
    const left = inspectPlanarFace(result, "x", -1);
    expect(left.triCount).toBe(4);
    expect(left.uniqueVerts).toBe(6);
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

  // ─── Sequential chamfer combination ───────────────────────────────────────
  // BevelSection combines successive same-params chamfers on the original
  // source so Phase 3 can close shared corners.  These tests cover the
  // mapping helper directly and the end-to-end "combined call matches the
  // intended geometry" property.

  describe("combineBevelSubGeoOnSource", () => {
    it("passes through edges whose endpoints already lie on source vertices", () => {
      const box = mergeVertices(makeIndexedBox());
      const prior = { edges: [], faces: [] };
      const fresh = {
        edges: [{ ax: -1, ay: 1, az: -1, bx: -1, by: 1, bz: 1 }],
        faces: [],
      };
      const out = combineBevelSubGeoOnSource(prior, fresh, box, 0.1);
      expect(out.edges).toHaveLength(1);
      expect(out.edges[0]).toEqual(fresh.edges[0]);
    });

    it("snaps strip-vertex endpoints back to the original source corner", () => {
      // (-1, 1, 0.9) is a strip vertex 0.1 inside (-1, 1, 1).  After a prior
      // chamfer of the top-front edge, the user selecting the top-left edge
      // on the chamfered geometry would have one endpoint at that strip
      // vertex.  We must map it back to (-1, 1, 1) so the combined bevel
      // call re-runs both chamfers on the un-modified source.
      const box = mergeVertices(makeIndexedBox());
      const prior = {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      };
      const fresh = {
        edges: [{ ax: -1, ay: 1, az: -1, bx: -1, by: 1, bz: 0.9 }],
        faces: [],
      };
      const out = combineBevelSubGeoOnSource(prior, fresh, box, 0.1);
      expect(out.edges).toHaveLength(2); // prior + mapped fresh
      const mapped = out.edges[1];
      // The (-1, 1, 0.9) endpoint should now be (-1, 1, 1).
      expect(mapped.bx).toBeCloseTo(-1, 4);
      expect(mapped.by).toBeCloseTo(1, 4);
      expect(mapped.bz).toBeCloseTo(1, 4);
    });

    it("drops edges whose endpoints both snap to the same source vertex", () => {
      // Two strip vertices around the same corner snap to the same source
      // corner — a degenerate edge that we drop.
      const box = mergeVertices(makeIndexedBox());
      const prior = { edges: [], faces: [] };
      const fresh = {
        edges: [{ ax: -1, ay: 1, az: 0.9, bx: -0.9, by: 1, bz: 1 }],
        faces: [],
      };
      const out = combineBevelSubGeoOnSource(prior, fresh, box, 0.1);
      expect(out.edges).toHaveLength(0);
    });

    it("concatenates faces without mapping (normals are coord-free)", () => {
      const box = mergeVertices(makeIndexedBox());
      const prior = { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] };
      const fresh = { edges: [], faces: [{ nx: 1, ny: 0, nz: 0 }] };
      const out = combineBevelSubGeoOnSource(prior, fresh, box, 0.1);
      expect(out.faces).toHaveLength(2);
    });
  });

  describe("sequential chamfer combination produces single-call geometry", () => {
    // The user clicks chamfer, then chamfer again on an adjacent edge.
    // BevelSection should produce the SAME geometry as a single combined
    // call — including Phase 3's corner-fill triangle that closes the
    // shared-corner hole.
    it("cube: two adjacent-corner chamfers combined match a single shared-corner call", () => {
      const box = makeIndexedBox();
      // Combined (the target): user selects both edges and clicks once.
      const combined = applyBevelToSubGeometry(
        box,
        {
          edges: [
            { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },     // top-front
            { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },   // top-left
          ],
          faces: [],
        },
        0.1,
        1,
      );

      // What BevelSection now does: combine the prior subGeo with the
      // new subGeo (mapping strip-vertex endpoints back to the source)
      // and re-run on the source.
      const priorSubGeo = {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      };
      // Step 1 result (only for getting realistic post-step1 endpoints).
      const step1 = applyBevelToSubGeometry(box, priorSubGeo, 0.1, 1);
      void step1;
      // User selects on the chamfered geometry: the top-left edge is now
      // truncated to (-1,1,-1) → (-1,1,0.9).
      const newSubGeo = {
        edges: [{ ax: -1, ay: 1, az: -1, bx: -1, by: 1, bz: 0.9 }],
        faces: [],
      };
      const sourceGeo = mergeVertices(makeIndexedBox());
      const combinedSubGeo = combineBevelSubGeoOnSource(
        priorSubGeo,
        newSubGeo,
        sourceGeo,
        0.1,
      );
      const result = applyBevelToSubGeometry(sourceGeo, combinedSubGeo, 0.1, 1);

      // Same topology: same triangle and unique-vertex counts.
      const uniq = (geo) => {
        const pa = geo.getAttribute("position");
        const s = new Set();
        const r = (v) => Math.round(v * 1e3) / 1e3;
        for (let i = 0; i < pa.count; i++) {
          s.add(`${r(pa.getX(i))},${r(pa.getY(i))},${r(pa.getZ(i))}`);
        }
        return s.size;
      };
      expect(result.index.count).toBe(combined.index.count);
      expect(uniq(result)).toBe(uniq(combined));
    });

    it("cube shared-corner: combined call produces a 4-vertex quad top face", () => {
      // The shared corner is replaced by an intersection vertex (Phase
      // 1.5).  TOP has: 1 intersection + 2 strip endpoints (the
      // unshared-corner ends of α and β) + 1 untouched cube corner = 4.
      const box = makeIndexedBox();
      const combined = applyBevelToSubGeometry(
        box,
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
      const top = inspectPlanarFace(combined, "y", 1);
      expect(top.uniqueVerts).toBe(4);
      expect(top.triCount).toBe(2);
    });
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

// ─── Mesh quality: holes, manifold, intersection, duplicates, normals,
// degenerate faces, loose meshes ────────────────────────────────────────────

describe("chamfer mesh quality", () => {
  // Probe each mesh-quality property in one pass.  Edges are keyed by
  // VERTEX POSITION (not index) so per-face-duplicated vertices in
  // BoxGeometry-style meshes are reconciled the way the rendered surface
  // actually behaves.
  function probeMesh(geo) {
    const posAttr = geo.getAttribute("position");
    const idx = geo.index ? geo.index.array : null;
    const round = (v) => Math.round(v * 1e4) / 1e4;
    const posKey = (i) =>
      `${round(posAttr.getX(i))},${round(posAttr.getY(i))},${round(posAttr.getZ(i))}`;

    const edgeCount = new Map(); // posKey-pair → triangle count
    const edgeToTris = new Map(); // posKey-pair → list of triangle indices
    const triCentroids = []; // per-triangle centroid
    const triNormals = []; // per-triangle unit normal
    let degenerate = 0;
    let triplet0 = []; // first 3 vertices for one tri, useful for spot checks

    const triCount = idx ? idx.length / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const k0 = posKey(i0),
        k1 = posKey(i1),
        k2 = posKey(i2);
      // Repeated-position degenerate.
      if (k0 === k1 || k1 === k2 || k0 === k2) {
        degenerate++;
        continue;
      }
      // Area-based degenerate.
      const p0 = new THREE.Vector3(
        posAttr.getX(i0),
        posAttr.getY(i0),
        posAttr.getZ(i0),
      );
      const p1 = new THREE.Vector3(
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1),
      );
      const p2 = new THREE.Vector3(
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2),
      );
      const cross = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(p1, p0),
        new THREE.Vector3().subVectors(p2, p0),
      );
      const area2 = cross.length();
      if (area2 < 1e-10) {
        degenerate++;
        continue;
      }
      triCentroids.push(p0.clone().add(p1).add(p2).divideScalar(3));
      triNormals.push(cross.divideScalar(area2));
      if (triplet0.length === 0) triplet0 = [k0, k1, k2];

      for (const [a, b] of [
        [k0, k1],
        [k1, k2],
        [k2, k0],
      ]) {
        const ek = a < b ? a + "|" + b : b + "|" + a;
        edgeCount.set(ek, (edgeCount.get(ek) || 0) + 1);
        if (!edgeToTris.has(ek)) edgeToTris.set(ek, []);
        edgeToTris.get(ek).push(t);
      }
    }

    // Holes: edges in exactly 1 triangle.
    // Non-manifold: edges in 3+ triangles.
    let boundary = 0,
      nonManifold = 0;
    for (const c of edgeCount.values()) {
      if (c === 1) boundary++;
      else if (c >= 3) nonManifold++;
    }

    // Connected components by position (union-find over edges).
    const parent = new Map();
    const find = (k) => {
      if (parent.get(k) === k) return k;
      const r = find(parent.get(k));
      parent.set(k, r);
      return r;
    };
    const union = (a, b) => {
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const k0 = posKey(i0),
        k1 = posKey(i1),
        k2 = posKey(i2);
      for (const k of [k0, k1, k2]) if (!parent.has(k)) parent.set(k, k);
      union(k0, k1);
      union(k1, k2);
    }
    const roots = new Set();
    for (const k of parent.keys()) roots.add(find(k));
    const componentCount = roots.size;

    // Unique positions referenced by any triangle.
    const uniqueRefPositions = new Set();
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      uniqueRefPositions.add(posKey(i0));
      uniqueRefPositions.add(posKey(i1));
      uniqueRefPositions.add(posKey(i2));
    }

    return {
      boundary,
      nonManifold,
      degenerate,
      componentCount,
      triCentroids,
      triNormals,
      uniquePositionCount: uniqueRefPositions.size,
      triCount: triCount - degenerate,
    };
  }

  // Count triangles whose normal points TOWARD an interior reference point
  // — for a convex chamfered cube around the origin, every face normal
  // should point AWAY from (0,0,0).  An inverted normal is a winding bug.
  function countInverted(probe, center = new THREE.Vector3(0, 0, 0)) {
    let inv = 0;
    for (let i = 0; i < probe.triNormals.length; i++) {
      const outward = new THREE.Vector3().subVectors(
        probe.triCentroids[i],
        center,
      );
      if (outward.dot(probe.triNormals[i]) < 0) inv++;
    }
    return inv;
  }

  // Detect triangles that share 2 vertices by position AND have the same
  // third vertex — i.e. duplicate triangles emitted by two different
  // phases.  Distinct from "same edge in 2 tris" which is normal.
  function countDuplicateTriangles(geo) {
    const posAttr = geo.getAttribute("position");
    const idx = geo.index ? geo.index.array : null;
    const round = (v) => Math.round(v * 1e4) / 1e4;
    const triCount = idx ? idx.length / 3 : posAttr.count / 3;
    const seen = new Set();
    let dup = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const keys = [i0, i1, i2]
        .map(
          (i) =>
            `${round(posAttr.getX(i))},${round(posAttr.getY(i))},${round(posAttr.getZ(i))}`,
        )
        .sort();
      const k = keys.join("/");
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    return dup;
  }

  // Detect pairs of non-adjacent coplanar triangles that overlap in 2D —
  // this catches "intersecting faces" within the same face plane (e.g.
  // overlapping in-place modified tris from Phase 2).  Triangles that
  // share at least one vertex (by position) are skipped — they meet at
  // that vertex, not "intersect".
  function countOverlappingCoplanarPairs(geo) {
    const posAttr = geo.getAttribute("position");
    const idx = geo.index ? geo.index.array : null;
    const round = (v) => Math.round(v * 1e4) / 1e4;
    const triCount = idx ? idx.length / 3 : posAttr.count / 3;
    const tris = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const p0 = new THREE.Vector3(
        posAttr.getX(i0),
        posAttr.getY(i0),
        posAttr.getZ(i0),
      );
      const p1 = new THREE.Vector3(
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1),
      );
      const p2 = new THREE.Vector3(
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2),
      );
      const n = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(p1, p0),
        new THREE.Vector3().subVectors(p2, p0),
      );
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const keys = new Set(
        [i0, i1, i2].map(
          (i) =>
            `${round(posAttr.getX(i))},${round(posAttr.getY(i))},${round(posAttr.getZ(i))}`,
        ),
      );
      tris.push({ p0, p1, p2, n, keys, d: -n.dot(p0) });
    }
    let overlaps = 0;
    for (let i = 0; i < tris.length; i++) {
      for (let j = i + 1; j < tris.length; j++) {
        const A = tris[i],
          B = tris[j];
        // Same plane: parallel normals and same plane offset.
        if (Math.abs(A.n.dot(B.n)) < 0.999) continue;
        if (Math.abs(A.d - B.d * Math.sign(A.n.dot(B.n))) > 1e-3) continue;
        // Skip if they share any vertex position.
        let sharesVertex = false;
        for (const k of A.keys) if (B.keys.has(k)) sharesVertex = true;
        if (sharesVertex) continue;
        // Quick AABB rejection in 3D.
        const aMin = A.p0.clone().min(A.p1).min(A.p2);
        const aMax = A.p0.clone().max(A.p1).max(A.p2);
        const bMin = B.p0.clone().min(B.p1).min(B.p2);
        const bMax = B.p0.clone().max(B.p1).max(B.p2);
        if (
          aMax.x < bMin.x - 1e-4 ||
          aMin.x > bMax.x + 1e-4 ||
          aMax.y < bMin.y - 1e-4 ||
          aMin.y > bMax.y + 1e-4 ||
          aMax.z < bMin.z - 1e-4 ||
          aMin.z > bMax.z + 1e-4
        )
          continue;
        // Coplanar AABBs intersect and no shared vertex → likely overlap.
        overlaps++;
      }
    }
    return overlaps;
  }

  // ─── 1. No holes / gaps (manifold by position) ────────────────────────────

  it("single edge chamfer: no boundary edges (no holes)", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).boundary).toBe(0);
  });

  it("two non-adjacent chamfered edges: no holes after Phase 5 cleanup", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      {
        edges: [
          { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
          { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 },
        ],
        faces: [],
      },
      0.1,
      1,
    );
    expect(probeMesh(result).boundary).toBe(0);
  });

  it("cylinder cap chamfer: no holes (intersection vertices close the cap perimeter)", () => {
    // Phase 1.5 computes an intersection vertex at every cap perimeter
    // corner where two adjacent cap-edge chamfers meet.  Phase 6 fans
    // from these intersections + the cap interior, so the cap closes up
    // without leaving spoke boundary edges.
    const result = applyBevelToSubGeometry(
      new THREE.CylinderGeometry(1, 1, 2, 8),
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    expect(probeMesh(result).boundary).toBe(0);
  });

  // ─── 2. No non-manifold geometry ─────────────────────────────────────────

  it("single edge chamfer: no non-manifold edges", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).nonManifold).toBe(0);
  });

  it("multi-edge shared-corner chamfer: no non-manifold edges", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
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
    expect(probeMesh(result).nonManifold).toBe(0);
  });

  it("all-12 cube edges chamfered: no non-manifold edges", () => {
    const edges = [
      { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: -1, az: 1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: 1, az: -1, bx: 1, by: -1, bz: -1 },
    ];
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges, faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).nonManifold).toBe(0);
  });

  // ─── 3. No intersecting (overlapping) coplanar faces ────────────────────

  it("single edge chamfer: no overlapping coplanar triangles", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(countOverlappingCoplanarPairs(result)).toBe(0);
  });

  it("face boundary chamfer: no overlapping coplanar triangles", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    expect(countOverlappingCoplanarPairs(result)).toBe(0);
  });

  // ─── 4. No duplicate triangles ──────────────────────────────────────────

  it("single edge chamfer: no duplicate triangles", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(countDuplicateTriangles(result)).toBe(0);
  });

  it("multi-edge chamfer: no duplicate triangles", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
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
    expect(countDuplicateTriangles(result)).toBe(0);
  });

  // ─── 5. No inverted normals ─────────────────────────────────────────────

  it("single edge chamfer: all triangle normals point outward", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(countInverted(probeMesh(result))).toBe(0);
  });

  it("multi-edge shared-corner chamfer: all normals outward", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
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
    expect(countInverted(probeMesh(result))).toBe(0);
  });

  it("all-12 cube edges chamfered: all normals outward", () => {
    const edges = [
      { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: -1, az: 1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: 1, az: -1, bx: 1, by: -1, bz: -1 },
    ];
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges, faces: [] },
      0.1,
      1,
    );
    expect(countInverted(probeMesh(result))).toBe(0);
  });

  // ─── 6. No degenerate faces ─────────────────────────────────────────────

  it("single edge chamfer: no degenerate triangles (zero or near-zero area)", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).degenerate).toBe(0);
  });

  it("face boundary chamfer: no degenerate triangles", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    expect(probeMesh(result).degenerate).toBe(0);
  });

  it("all-12 cube edges chamfered: no degenerate triangles", () => {
    const edges = [
      { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: 1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: -1, az: -1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: -1, az: 1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: -1, az: 1, bx: 1, by: -1, bz: -1 },
      { ax: -1, ay: 1, az: 1, bx: -1, by: -1, bz: 1 },
      { ax: 1, ay: 1, az: 1, bx: 1, by: -1, bz: 1 },
      { ax: -1, ay: 1, az: -1, bx: -1, by: -1, bz: -1 },
      { ax: 1, ay: 1, az: -1, bx: 1, by: -1, bz: -1 },
    ];
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges, faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).degenerate).toBe(0);
  });

  // ─── 7. No loose meshes (single connected component) ───────────────────

  it("single edge chamfer: one connected component", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      1,
    );
    expect(probeMesh(result).componentCount).toBe(1);
  });

  it("multi-edge chamfer (4 top edges): one connected component", () => {
    const result = applyBevelToSubGeometry(
      new THREE.BoxGeometry(2, 2, 2),
      {
        edges: [
          { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
          { ax: -1, ay: 1, az: -1, bx: 1, by: 1, bz: -1 },
          { ax: -1, ay: 1, az: 1, bx: -1, by: 1, bz: -1 },
          { ax: 1, ay: 1, az: 1, bx: 1, by: 1, bz: -1 },
        ],
        faces: [],
      },
      0.1,
      1,
    );
    expect(probeMesh(result).componentCount).toBe(1);
  });

  it("cylinder cap chamfer: one connected component", () => {
    const result = applyBevelToSubGeometry(
      new THREE.CylinderGeometry(1, 1, 2, 8),
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.1,
      1,
    );
    expect(probeMesh(result).componentCount).toBe(1);
  });
});
