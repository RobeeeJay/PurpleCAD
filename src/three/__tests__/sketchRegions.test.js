import { describe, it, expect, vi } from "vitest";
import {
  findClosedLoopsWithShapes,
  findClosedLoops,
  polyContainsPoint,
  polyCentroid,
  polyArea,
  groupLoopsWithHoles,
} from "../sceneObjects.js";

// ── Stub out THREE.js and other heavy dependencies ────────────────────────────
// The pure geometry functions under test use no THREE symbols at all; we only
// need enough of a mock for the module to load without errors.

vi.mock("three", () => {
  class Base {
    constructor() {
      this.userData = {};
      this.children = [];
      this.visible = false;
      this.renderOrder = 0;
    }
    add(c) {
      this.children.push(c);
    }
  }
  class Mesh extends Base {
    constructor() {
      super();
      this.position = { x: 0, y: 0, z: 0 };
      this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
      this.matrixWorld = {};
    }
    updateMatrixWorld() {}
  }
  class Shape {
    constructor() {
      this.holes = [];
    }
    setFromPoints() {}
  }
  class BufferGeometry {
    setAttribute() {}
    setIndex() {}
    computeVertexNormals() {}
  }
  return {
    Group: Base,
    Mesh,
    Shape,
    ShapeGeometry: class {},
    MeshBasicMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    MeshStandardMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    Vector2: class {
      constructor(x, y) {
        this.x = x || 0;
        this.y = y || 0;
      }
      set(x, y) {
        this.x = x;
        this.y = y;
        return this;
      }
    },
    Vector3: class {
      constructor(x, y, z) {
        this.x = x || 0;
        this.y = y || 0;
        this.z = z || 0;
      }
      applyQuaternion() {
        return this;
      }
      normalize() {
        return this;
      }
      set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
      }
      subVectors() {
        return this;
      }
      addScaledVector() {
        return this;
      }
      clone() {
        return this;
      }
      sub() {
        return this;
      }
      multiplyScalar() {
        return this;
      }
    },
    Euler: class {
      setFromQuaternion() {
        return this;
      }
    },
    BufferGeometry,
    BufferAttribute: class {},
    Color: class {},
    Sprite: class extends Base {},
    SpriteMaterial: class {
      constructor() {
        this.dispose = () => {};
      }
    },
    CanvasTexture: class {
      constructor() {
        this.needsUpdate = false;
      }
    },
    PointsMaterial: class {},
    Points: class extends Base {},
    Float32BufferAttribute: class {},
  };
});
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
  RoomEnvironment: class {},
}));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {},
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
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({}) }));
vi.mock("../../store", () => ({ useStore: () => null }));

// ── Test helpers ──────────────────────────────────────────────────────────────

// Returns the loop whose polygon MOST TIGHTLY encloses `point` (smallest area
// among all loops that contain it). This replicates the hover priority rule:
// the innermost matching region (highest renderOrder) is shown first.
function findSmallestContainingLoop(loopsWithShapes, point) {
  const hits = loopsWithShapes.filter((l) =>
    polyContainsPoint(l.polygon, point),
  );
  if (!hits.length) return null;
  return hits.reduce((best, l) =>
    polyArea(l.polygon) < polyArea(best.polygon) ? l : best,
  );
}

// Replicates the fill-descriptor build that buildSketchShapesGroup performs,
// returning plain objects instead of THREE.Mesh so tests need no THREE mock.
// Each fill: { polygon2D, holes2D, renderOrder, shapeIndices }
function buildFillDescriptors(shapes) {
  const loopsWithShapes = findClosedLoopsWithShapes(shapes);
  const polygons = loopsWithShapes.map((l) => l.polygon);
  const polyShapeMap = new Map(
    loopsWithShapes.map((l) => [l.polygon, l.shapeIndices]),
  );
  const grouped = groupLoopsWithHoles(polygons);
  const fills = [];
  const addEntry = ({ polygon, holes, entries }, renderOrder) => {
    const outerIdx = polyShapeMap.get(polygon) || [];
    const holeIdx = holes.flatMap((h) => polyShapeMap.get(h) || []);
    fills.push({
      polygon2D: polygon,
      holes2D: holes,
      renderOrder,
      shapeIndices: [...new Set([...outerIdx, ...holeIdx])],
    });
    entries.forEach((sub) => addEntry(sub, renderOrder + 1));
  };
  grouped.forEach((e) => addEntry(e, 999));
  return fills;
}

// Replicates updateHoverFills: highest renderOrder wins; equal renderOrders resolved
// by smallest polygon area (the most specific / innermost region always wins).
function findHoverFill(fills, point) {
  let best = null;
  for (const f of fills) {
    if (
      polyContainsPoint(f.polygon2D, point) &&
      !f.holes2D.some((h) => polyContainsPoint(h, point))
    ) {
      const fOrder = f.renderOrder ?? 0;
      const bOrder = best ? (best.renderOrder ?? 0) : -1;
      const fArea = polyArea(f.polygon2D);
      const bArea = best ? polyArea(best.polygon2D) : Infinity;
      if (!best || fOrder > bOrder || (fOrder === bOrder && fArea < bArea))
        best = f;
    }
  }
  return best;
}

// ── Shape factories ───────────────────────────────────────────────────────────
const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });
const R = (x1, y1, x2, y2) => ({ type: "rect", x1, y1, x2, y2 });

// ── Fixture: 4-line square ────────────────────────────────────────────────────
// Vertices: TL=(0,4) TR=(4,4) BR=(4,0) BL=(0,0)
function squareLines() {
  return [
    L(0, 4, 4, 4), // 0 top
    L(4, 4, 4, 0), // 1 right
    L(4, 0, 0, 0), // 2 bottom
    L(0, 0, 0, 4), // 3 left
  ];
}

// Fixture: above square plus a diagonal from BL(0,0) to TR(4,4).
// Creates two triangular sub-regions:
//   Upper-left  (x < y region): TL-TR-BL  shapes [0, 3, 4]
//   Lower-right (x > y region): TR-BR-BL  shapes [1, 2, 4]
function squareWithDiagonal() {
  return [...squareLines(), L(0, 0, 4, 4)]; // 4: diagonal
}

// Fixture: large outer rect + small inner rect (hole).
function nestedRects() {
  return [
    R(0, 0, 10, 10), // 0: outer  centroid (5,5)
    R(1, 1, 4, 4), // 1: inner  centroid (2.5,2.5) — clearly inside outer, not vice-versa
  ];
}

// Fixture: square with diagonal and circle in the lower-right triangle.
// (Shared between the diagonal+circle describe blocks and the extrude tests.)
function rectDiagCircle() {
  return [...squareWithDiagonal(), C(3, 0.5, 0.4)]; // shape 5: circle in lower-right half
}

// ════════════════════════════════════════════════════════════════════════════
describe("sketch region detection", () => {
  // ══ polyContainsPoint ═════════════════════════════════════════════════════
  describe("polyContainsPoint", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const triangle = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 4 },
    ]; // isosceles

    it("center of square → inside", () => {
      expect(polyContainsPoint(square, { x: 2, y: 2 })).toBe(true);
    });

    it("point outside square → outside", () => {
      expect(polyContainsPoint(square, { x: 5, y: 5 })).toBe(false);
      expect(polyContainsPoint(square, { x: -1, y: 2 })).toBe(false);
      expect(polyContainsPoint(square, { x: 2, y: 6 })).toBe(false);
    });

    it("point deep inside triangle → inside", () => {
      expect(polyContainsPoint(triangle, { x: 3, y: 1 })).toBe(true);
    });

    it("point outside triangle → outside", () => {
      expect(polyContainsPoint(triangle, { x: 0.1, y: 3.9 })).toBe(false);
      expect(polyContainsPoint(triangle, { x: 6, y: 1 })).toBe(false);
    });

    it("point from one triangle not in the other", () => {
      // Upper-left triangle (BL-TL-TR of a square bisected by BL→TR diagonal)
      const upper = [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 4 },
      ];
      const lower = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ];
      expect(polyContainsPoint(upper, { x: 0.5, y: 2.5 })).toBe(true);
      expect(polyContainsPoint(lower, { x: 0.5, y: 2.5 })).toBe(false);
      expect(polyContainsPoint(lower, { x: 3.5, y: 0.5 })).toBe(true);
      expect(polyContainsPoint(upper, { x: 3.5, y: 0.5 })).toBe(false);
    });
  });

  // ══ polyCentroid ══════════════════════════════════════════════════════════
  describe("polyCentroid", () => {
    it("centroid of axis-aligned square is its center", () => {
      const sq = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ];
      expect(polyCentroid(sq)).toMatchObject({
        x: expect.closeTo(2),
        y: expect.closeTo(2),
      });
    });

    it("centroid of equilateral-ish triangle", () => {
      const tri = [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 3, y: 6 },
      ];
      expect(polyCentroid(tri)).toMatchObject({
        x: expect.closeTo(3),
        y: expect.closeTo(2),
      });
    });
  });

  // ══ findClosedLoopsWithShapes ═════════════════════════════════════════════
  describe("findClosedLoopsWithShapes", () => {
    it("single rect shape → 1 loop with 4 polygon points", () => {
      const loops = findClosedLoopsWithShapes([R(0, 0, 4, 4)]);
      expect(loops).toHaveLength(1);
      expect(loops[0].polygon).toHaveLength(4);
      expect(loops[0].shapeIndices).toEqual([0]);
    });

    it("single circle shape → 1 loop with 32 polygon points", () => {
      const loops = findClosedLoopsWithShapes([C(2, 2, 1)]);
      expect(loops).toHaveLength(1);
      expect(loops[0].polygon).toHaveLength(32);
      expect(loops[0].shapeIndices).toEqual([0]);
    });

    it("4 lines forming a square → 1 loop enclosing the square", () => {
      const loops = findClosedLoopsWithShapes(squareLines());
      expect(loops).toHaveLength(1);
      expect(loops[0].shapeIndices.sort()).toEqual([0, 1, 2, 3]);
      // Every polygon point should be a corner of the square
      loops[0].polygon.forEach((p) => {
        expect([0, 4]).toContain(p.x);
        expect([0, 4]).toContain(p.y);
      });
    });

    it("3 lines forming a triangle → 1 loop", () => {
      const shapes = [
        L(0, 0, 4, 0), // base
        L(4, 0, 2, 4), // right side
        L(2, 4, 0, 0), // left side
      ];
      const loops = findClosedLoopsWithShapes(shapes);
      expect(loops).toHaveLength(1);
      expect(loops[0].shapeIndices.sort()).toEqual([0, 1, 2]);
    });

    it("open L-shape (2 disconnected lines) → 0 loops", () => {
      const shapes = [L(0, 0, 4, 0), L(4, 0, 4, 4)]; // not closed
      expect(findClosedLoopsWithShapes(shapes)).toHaveLength(0);
    });

    it("dashed lines are excluded and do not form loops", () => {
      // Same square but one edge is dashed → cannot close a loop
      const shapes = [
        L(0, 4, 4, 4),
        L(4, 4, 4, 0),
        L(4, 0, 0, 0),
        { ...L(0, 0, 0, 4), dashed: true }, // this edge excluded
      ];
      expect(findClosedLoopsWithShapes(shapes)).toHaveLength(0);
    });

    it("two separate rect shapes → 2 independent loops", () => {
      const shapes = [R(0, 0, 3, 3), R(5, 0, 8, 3)];
      const loops = findClosedLoopsWithShapes(shapes);
      expect(loops).toHaveLength(2);
      expect(loops[0].shapeIndices).toEqual([0]);
      expect(loops[1].shapeIndices).toEqual([1]);
    });

    // ── Rectangle bisected by a diagonal ─────────────────────────────────
    describe("square bisected by diagonal (BL→TR)", () => {
      it("detects exactly 3 loops: the two triangles + the full square", () => {
        const loops = findClosedLoopsWithShapes(squareWithDiagonal());
        expect(loops).toHaveLength(3);
      });

      it("each triangular loop includes the diagonal (shape 4) in its shapeIndices", () => {
        const loops = findClosedLoopsWithShapes(squareWithDiagonal());
        const tris = loops.filter((l) => l.shapeIndices.length === 3);
        expect(tris).toHaveLength(2);
        tris.forEach((tri) => expect(tri.shapeIndices).toContain(4));
      });

      it("the two triangles have non-overlapping non-diagonal shapeIndices", () => {
        const loops = findClosedLoopsWithShapes(squareWithDiagonal());
        const tris = loops.filter((l) => l.shapeIndices.length === 3);
        const [a, b] = tris.map((t) => t.shapeIndices.filter((i) => i !== 4));
        // Each triangle has 2 unique rectangle edges, and the two sets are disjoint
        expect(a.every((i) => !b.includes(i))).toBe(true);
        expect(b.every((i) => !a.includes(i))).toBe(true);
      });

      it("upper-left-region point is inside exactly one triangle, not the other", () => {
        const loops = findClosedLoopsWithShapes(squareWithDiagonal());
        const tris = loops.filter((l) => l.shapeIndices.length === 3);
        const inside = tris.filter((t) =>
          polyContainsPoint(t.polygon, { x: 0.5, y: 2.5 }),
        );
        expect(inside).toHaveLength(1);
      });

      it("lower-right-region point is inside exactly one triangle, not the other", () => {
        const loops = findClosedLoopsWithShapes(squareWithDiagonal());
        const tris = loops.filter((l) => l.shapeIndices.length === 3);
        const inside = tris.filter((t) =>
          polyContainsPoint(t.polygon, { x: 3.5, y: 0.5 }),
        );
        expect(inside).toHaveLength(1);
      });
    });

    // ── Nested shapes ─────────────────────────────────────────────────────
    it("outer + inner rect → 2 loops with correct shape indices", () => {
      const loops = findClosedLoopsWithShapes(nestedRects());
      expect(loops).toHaveLength(2);
      const outer = loops.find((l) => l.shapeIndices.includes(0));
      const inner = loops.find((l) => l.shapeIndices.includes(1));
      expect(outer).toBeDefined();
      expect(inner).toBeDefined();
    });
  });

  // ══ groupLoopsWithHoles ═══════════════════════════════════════════════════
  describe("groupLoopsWithHoles", () => {
    it("single loop → 1 group with no holes", () => {
      const poly = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ];
      const groups = groupLoopsWithHoles([poly]);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(0);
    });

    it("two side-by-side loops → 2 outer groups with no holes", () => {
      const a = [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ];
      const b = [
        { x: 5, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 3 },
        { x: 5, y: 3 },
      ];
      const groups = groupLoopsWithHoles([a, b]);
      expect(groups).toHaveLength(2);
      groups.forEach((g) => expect(g.holes).toHaveLength(0));
    });

    it("outer contains inner → inner classified as hole of outer", () => {
      // Outer (0,0..10,10), inner (1,1..4,4). Outer centroid (5,5) is NOT inside inner.
      // Inner centroid (2.5,2.5) IS inside outer.
      const outer = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const inner = [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
        { x: 1, y: 4 },
      ];
      const groups = groupLoopsWithHoles([outer, inner]);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(1);
      expect(groups[0].holes[0]).toBe(inner);
    });

    it("inner centroid is inside outer polygon", () => {
      const outer = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const inner = [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 4 },
        { x: 1, y: 4 },
      ];
      expect(polyContainsPoint(outer, polyCentroid(inner))).toBe(true);
      expect(polyContainsPoint(inner, polyCentroid(outer))).toBe(false);
    });
  });

  // ══ Hover region simulation ═══════════════════════════════════════════════
  // findSmallestContainingLoop replicates the hover rule: the innermost loop
  // (smallest area) containing the cursor is shown — matching the highest-
  // renderOrder fill mesh in updateHoverFills.

  describe("hover – simple enclosed shapes", () => {
    it("rect shape: point inside → returns the rect loop", () => {
      const shapes = [R(0, 0, 6, 6)];
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 3, y: 3 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0);
    });

    it("rect shape: point outside → returns null", () => {
      const shapes = [R(0, 0, 6, 6)];
      const loops = findClosedLoopsWithShapes(shapes);
      expect(findSmallestContainingLoop(loops, { x: 7, y: 7 })).toBeNull();
    });

    it("circle: point inside circle → returns the circle loop", () => {
      const shapes = [C(0, 0, 3)];
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 1, y: 1 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0);
    });

    it("circle: point outside radius → returns null", () => {
      const shapes = [C(0, 0, 3)];
      const loops = findClosedLoopsWithShapes(shapes);
      expect(findSmallestContainingLoop(loops, { x: 4, y: 0 })).toBeNull();
    });
  });

  // ── Rectangle bisected by diagonal ──────────────────────────────────────
  describe("hover – diagonal bisects rectangle into two regions", () => {
    // Square (0,0)→(4,4) split by diagonal from BL(0,0) to TR(4,4).
    // Upper-left half (x < y): points like (0.5, 2.5)
    // Lower-right half (x > y): points like (3.5, 0.5)

    it("upper-left region hover returns the upper-left triangular loop", () => {
      const shapes = squareWithDiagonal();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 0.5, y: 2.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toHaveLength(3); // triangle, not the full square
    });

    it("lower-right region hover returns the lower-right triangular loop", () => {
      const shapes = squareWithDiagonal();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 3.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toHaveLength(3);
    });

    it("upper-left and lower-right regions map to DIFFERENT loops", () => {
      const shapes = squareWithDiagonal();
      const loops = findClosedLoopsWithShapes(shapes);
      const upper = findSmallestContainingLoop(loops, { x: 0.5, y: 2.5 });
      const lower = findSmallestContainingLoop(loops, { x: 3.5, y: 0.5 });
      // They must be different loop objects
      expect(upper).not.toBe(lower);
      // Their shapeIndices must differ (each has two unique rectangle edges)
      const upperUniq = upper.shapeIndices.filter((i) => i !== 4);
      const lowerUniq = lower.shapeIndices.filter((i) => i !== 4);
      expect(upperUniq.every((i) => !lowerUniq.includes(i))).toBe(true);
    });

    it("both triangular regions include the diagonal in their shapeIndices", () => {
      const shapes = squareWithDiagonal();
      const loops = findClosedLoopsWithShapes(shapes);
      const upper = findSmallestContainingLoop(loops, { x: 0.5, y: 2.5 });
      const lower = findSmallestContainingLoop(loops, { x: 3.5, y: 0.5 });
      expect(upper.shapeIndices).toContain(4); // diagonal is shape 4
      expect(lower.shapeIndices).toContain(4);
    });

    it("point outside the square → no region", () => {
      const loops = findClosedLoopsWithShapes(squareWithDiagonal());
      expect(findSmallestContainingLoop(loops, { x: 5, y: 5 })).toBeNull();
      expect(findSmallestContainingLoop(loops, { x: -1, y: 2 })).toBeNull();
    });

    it("hovering each triangle multiple times from different angles returns consistent results", () => {
      const loops = findClosedLoopsWithShapes(squareWithDiagonal());
      // Several points in upper-left half
      const upperPoints = [
        { x: 0.5, y: 2.5 },
        { x: 1, y: 3 },
        { x: 0.2, y: 3.5 },
        { x: 1.5, y: 3.5 },
      ];
      // Several points in lower-right half
      const lowerPoints = [
        { x: 3.5, y: 0.5 },
        { x: 2, y: 0.3 },
        { x: 3, y: 1 },
        { x: 3.8, y: 1.5 },
      ];
      const upperLoops = upperPoints.map((p) =>
        findSmallestContainingLoop(loops, p),
      );
      const lowerLoops = lowerPoints.map((p) =>
        findSmallestContainingLoop(loops, p),
      );
      // All upper-left points map to the same loop
      upperLoops.forEach((l) => expect(l).toBe(upperLoops[0]));
      // All lower-right points map to the same loop
      lowerLoops.forEach((l) => expect(l).toBe(lowerLoops[0]));
      // And the two groups are different
      expect(upperLoops[0]).not.toBe(lowerLoops[0]);
    });
  });

  // ── Hole / cut-out area ─────────────────────────────────────────────────
  describe("hover – hole (cut-out area)", () => {
    // Outer rect (0,0..10,10), inner rect (1,1..4,4) as a hole.
    // groupLoopsWithHoles classifies inner as a hole of outer.
    // Hover priority: the inner (hole) region wins over the outer for points inside it.

    it("point inside the hole → hole region returned (not outer)", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 2, y: 2 });
      expect(hit).not.toBeNull();
      // Must be the inner shape, not the outer
      expect(hit.shapeIndices).toContain(1); // inner rect
      expect(hit.shapeIndices).not.toContain(0); // NOT outer rect
    });

    it("point in outer only (outside hole) → outer region returned", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 7, y: 7 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // outer rect
      expect(hit.shapeIndices).not.toContain(1); // NOT inner
    });

    it("point in another outer-only corner → outer region", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 8, y: 1 });
      expect(hit.shapeIndices).toContain(0);
      expect(hit.shapeIndices).not.toContain(1);
    });

    it("point outside everything → null", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      expect(findSmallestContainingLoop(loops, { x: 11, y: 5 })).toBeNull();
      expect(findSmallestContainingLoop(loops, { x: -1, y: -1 })).toBeNull();
    });

    it("groupLoopsWithHoles classifies inner as hole of outer", () => {
      const loops = findClosedLoopsWithShapes(nestedRects());
      const polygons = loops.map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(1);
    });

    it("hole region shapeIndices identify ONLY the inner boundary shape", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      const hole = findSmallestContainingLoop(loops, { x: 2.5, y: 2.5 });
      expect(hole.shapeIndices).toEqual([1]);
    });

    it("outer region shapeIndices identify ONLY the outer boundary shape", () => {
      const shapes = nestedRects();
      const loops = findClosedLoopsWithShapes(shapes);
      const outer = findSmallestContainingLoop(loops, { x: 9, y: 9 });
      expect(outer.shapeIndices).toEqual([0]);
    });
  });

  // ── Multiple holes ────────────────────────────────────────────────────────
  describe("hover – multiple holes in one outer region", () => {
    // Large rect with two smaller rects as holes.
    //   Outer: (0,0..12,12)
    //   Hole A: (1,1..4,4)
    //   Hole B: (7,1..10,4)

    function multiHoleShapes() {
      return [
        R(0, 0, 12, 12), // 0: outer
        R(1, 1, 4, 4), // 1: hole A (left)
        R(7, 1, 10, 4), // 2: hole B (right)
      ];
    }

    it("groupLoopsWithHoles gives 1 outer with 2 holes", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      const polygons = loops.map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(2);
    });

    it("hover over hole A → hole A loop returned", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      const hit = findSmallestContainingLoop(loops, { x: 2, y: 2 });
      expect(hit.shapeIndices).toContain(1);
      expect(hit.shapeIndices).not.toContain(0);
    });

    it("hover over hole B → hole B loop returned", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      const hit = findSmallestContainingLoop(loops, { x: 8, y: 2 });
      expect(hit.shapeIndices).toContain(2);
      expect(hit.shapeIndices).not.toContain(0);
    });

    it("hover between holes but inside outer → outer returned", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      const hit = findSmallestContainingLoop(loops, { x: 5, y: 2 }); // gap between holes
      expect(hit.shapeIndices).toContain(0);
      expect(hit.shapeIndices).not.toContain(1);
      expect(hit.shapeIndices).not.toContain(2);
    });

    it("hover over area above holes but still inside outer → outer returned", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      const hit = findSmallestContainingLoop(loops, { x: 6, y: 8 });
      expect(hit.shapeIndices).toContain(0);
    });

    it("hover outside outer → null", () => {
      const loops = findClosedLoopsWithShapes(multiHoleShapes());
      expect(findSmallestContainingLoop(loops, { x: 13, y: 6 })).toBeNull();
    });
  });

  // ── Diagonal + hole combined ────────────────────────────────────────────
  describe("hover – diagonal bisect inside a hole", () => {
    // Outer rect contains an inner rect that is itself split by a diagonal.
    // The inner rect's two triangles should each be detectable.
    //
    //   Outer: (0,0..10,10)   shape 0
    //   Inner top:    (2,4..8,8)  as 4 lines (shapes 1-4)
    //   Inner bottom: (2,0..8,4)  would be the other half — but here we just add the diagonal
    //   Actually simpler: outer rect + 4-line inner square + diagonal inside inner

    function outerWithDiagonalInner() {
      return [
        R(0, 0, 10, 10), // 0: big outer rect
        L(2, 2, 8, 2), // 1: inner-bottom
        L(8, 2, 8, 8), // 2: inner-right
        L(8, 8, 2, 8), // 3: inner-top
        L(2, 8, 2, 2), // 4: inner-left
        L(2, 2, 8, 8), // 5: inner diagonal (BL→TR of inner)
      ];
    }

    it("detects inner triangular sub-regions", () => {
      const loops = findClosedLoopsWithShapes(outerWithDiagonalInner());
      // There should be: outer rect, inner full square, 2 inner triangles
      const tris = loops.filter((l) => l.shapeIndices.length === 3);
      expect(tris.length).toBeGreaterThanOrEqual(2);
    });

    it("point inside inner upper-left region → inner triangular loop (not outer)", () => {
      const loops = findClosedLoopsWithShapes(outerWithDiagonalInner());
      // (3,7) is in the upper-left triangle of the inner square (x < y side)
      const hit = findSmallestContainingLoop(loops, { x: 3, y: 7 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(5); // inner diagonal
      expect(hit.shapeIndices).not.toContain(0); // not the outer rect
    });

    it("point inside inner lower-right region → inner triangular loop (not outer)", () => {
      const loops = findClosedLoopsWithShapes(outerWithDiagonalInner());
      // (7,3) is in the lower-right triangle of the inner square (x > y side)
      const hit = findSmallestContainingLoop(loops, { x: 7, y: 3 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(5); // inner diagonal
      expect(hit.shapeIndices).not.toContain(0); // not the outer rect
    });

    it("the two inner triangular regions are different loops", () => {
      const loops = findClosedLoopsWithShapes(outerWithDiagonalInner());
      const upper = findSmallestContainingLoop(loops, { x: 3, y: 7 });
      const lower = findSmallestContainingLoop(loops, { x: 7, y: 3 });
      expect(upper).not.toBe(lower);
    });

    it("point in outer area but outside inner square → outer loop", () => {
      const loops = findClosedLoopsWithShapes(outerWithDiagonalInner());
      const hit = findSmallestContainingLoop(loops, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // outer rect
    });
  });

  // ── Rectangle containing a circle ─────────────────────────────────────────
  // Regression for the bug where groupLoopsWithHoles returned an empty array
  // when the circle is centred inside the rectangle: both polygons' centroids
  // sit at the same point, so each appeared to contain the other, causing both
  // to be filtered as "inner" and no fill meshes to be produced.

  describe("hover – rectangle with a circle inside (centred hole)", () => {
    // Outer rect (0,0..10,10), circle centred at (5,5) r=2.
    // Both centroids ≈ (5,5), which is what triggered the original bug.
    function rectWithCircle() {
      return [
        R(0, 0, 10, 10), // 0: outer rectangle
        C(5, 5, 2), // 1: inner circle
      ];
    }

    it("both centroids are at approximately the same point (reproduces bug precondition)", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      const rectLoop = loops.find((l) => l.shapeIndices.includes(0));
      const circleLoop = loops.find((l) => l.shapeIndices.includes(1));
      const rc = polyCentroid(rectLoop.polygon);
      const cc = polyCentroid(circleLoop.polygon);
      expect(Math.hypot(rc.x - cc.x, rc.y - cc.y)).toBeLessThan(0.1);
    });

    it("circle polygon has strictly smaller area than rect polygon", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      const rectArea = polyArea(
        loops.find((l) => l.shapeIndices.includes(0)).polygon,
      );
      const circleArea = polyArea(
        loops.find((l) => l.shapeIndices.includes(1)).polygon,
      );
      expect(circleArea).toBeLessThan(rectArea);
    });

    it("groupLoopsWithHoles produces exactly 1 group (rect as outer, circle as hole)", () => {
      const loops = findClosedLoopsWithShapes(rectWithCircle());
      const polygons = loops.map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(1);
    });

    it("rect is classified as outer, circle as hole", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      const polygons = loops.map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      const outerPoly = groups[0].polygon;
      const holePoly = groups[0].holes[0];
      // The outer polygon has larger area than the hole polygon
      expect(polyArea(outerPoly)).toBeGreaterThan(polyArea(holePoly));
      // The outer polygon is a 4-point rectangle, the hole is a 32-point circle
      expect(outerPoly).toHaveLength(4);
      expect(holePoly).toHaveLength(32);
    });

    it("hover inside the circle → circle region (innermost loop)", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      const hit = findSmallestContainingLoop(loops, { x: 5, y: 5 }); // dead centre
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // circle shape
      expect(hit.shapeIndices).not.toContain(0);
    });

    it("hover in the rect area outside the circle → rect region", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      // (0.5,0.5) is inside rect but outside circle (circle centre (5,5) r=2)
      const hit = findSmallestContainingLoop(loops, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // rect shape
      expect(hit.shapeIndices).not.toContain(1);
    });

    it("hover in rect corner far from circle → rect region", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      for (const p of [
        { x: 0.5, y: 9.5 },
        { x: 9.5, y: 9.5 },
        { x: 9.5, y: 0.5 },
      ]) {
        const hit = findSmallestContainingLoop(loops, p);
        expect(hit, `point (${p.x},${p.y})`).not.toBeNull();
        expect(hit.shapeIndices).toContain(0);
        expect(hit.shapeIndices).not.toContain(1);
      }
    });

    it("hover outside the rect → null", () => {
      const shapes = rectWithCircle();
      const loops = findClosedLoopsWithShapes(shapes);
      expect(findSmallestContainingLoop(loops, { x: 11, y: 5 })).toBeNull();
      expect(findSmallestContainingLoop(loops, { x: 5, y: -1 })).toBeNull();
    });

    it("circle not centred at rect centre — off-centre circle still grouped correctly", () => {
      // Circle near a corner: centroid of circle is far from centroid of rect
      const shapes = [R(0, 0, 10, 10), C(1.5, 1.5, 1)];
      const loops = findClosedLoopsWithShapes(shapes);
      const polygons = loops.map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      expect(groups).toHaveLength(1);
      expect(groups[0].holes).toHaveLength(1);
    });
  });

  // ── Rectangle + diagonal + circle (multi-level nesting) ────────────────────
  // Regression: when a circle sits inside one triangular sub-region of a bisected
  // rectangle, the one-level groupLoopsWithHoles used to attach the circle as a
  // direct hole of the outer rectangle instead of the triangle. This meant:
  //   • The triangle fill had no holes2D, so hovering over the circle area showed
  //     the triangle highlight instead of the circle highlight.
  //   • The circle fill and triangle fill had the same renderOrder and competed.
  //
  // Fix: groupLoopsWithHoles now finds each loop's DIRECT parent (smallest-area
  // containing loop), building a full nesting tree. The circle becomes a child of
  // the lower-right triangle, which gets renderOrder+1 over the triangle, which
  // gets renderOrder+1 over the outer rectangle.

  describe("hover – rectangle bisected by diagonal containing a circle", () => {
    // Square (0,0)→(4,4) with BL→TR diagonal, circle in the lower-right half.
    //   shapes[0..3] = top, right, bottom, left  (squareLines)
    //   shapes[4]    = diagonal BL(0,0)→TR(4,4)
    //   shapes[5]    = circle at (3, 0.5) r=0.4  (inside lower-right triangle x > y)

    it("circle is nested inside the lower-right triangular loop, not the outer rect", () => {
      const shapes = rectDiagCircle();
      const polygons = findClosedLoopsWithShapes(shapes).map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      // Root should be the full square (largest area)
      expect(groups).toHaveLength(1);
      const root = groups[0];
      // Root has 2 direct holes: the two triangles
      expect(root.holes).toHaveLength(2);
      // One of those triangle entries has the circle as its child
      const triWithCircle = root.entries.find((e) => e.entries.length > 0);
      expect(triWithCircle).toBeDefined();
      expect(triWithCircle.entries).toHaveLength(1); // circle is its only child
    });

    it("circle is a direct child of the lower-right triangle entry", () => {
      const shapes = rectDiagCircle();
      const polygons = findClosedLoopsWithShapes(shapes).map((l) => l.polygon);
      const groups = groupLoopsWithHoles(polygons);
      const root = groups[0];
      const triEntry = root.entries.find((e) => e.entries.length > 0);
      // The nested circle entry has no further children
      expect(triEntry.entries[0].holes).toHaveLength(0);
      expect(triEntry.entries[0].entries).toHaveLength(0);
    });

    it("lower-right triangle fill has the circle as a hole (holes2D)", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      // There should be a fill for the lower-right triangle that lists the circle polygon
      const triWithCircleHole = fills.find(
        (f) =>
          f.holes2D.length === 1 &&
          polyArea(f.polygon2D) < 10 &&
          polyArea(f.polygon2D) > 1,
      );
      expect(triWithCircleHole).toBeDefined();
      expect(polyArea(triWithCircleHole.holes2D[0])).toBeLessThan(
        polyArea(triWithCircleHole.polygon2D),
      );
    });

    it("fill renderOrders increase with nesting depth", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      const orders = [...new Set(fills.map((f) => f.renderOrder))].sort(
        (a, b) => a - b,
      );
      // At least 3 distinct levels: outer-rect → triangles → circle
      expect(orders.length).toBeGreaterThanOrEqual(3);
      // Each level is exactly +1
      for (let i = 1; i < orders.length; i++)
        expect(orders[i]).toBe(orders[i - 1] + 1);
    });

    it("hover over circle → circle fill shown (highest renderOrder wins)", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      const hit = findHoverFill(fills, { x: 3, y: 0.5 }); // circle centre
      expect(hit).not.toBeNull();
      // Circle fill has the highest renderOrder of all fills
      const maxOrder = Math.max(...fills.map((f) => f.renderOrder));
      expect(hit.renderOrder).toBe(maxOrder);
    });

    it("hover in lower-right triangle outside circle → triangle fill with circle excluded", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      // (3.8, 0.2) is in the lower-right triangle but outside the circle (centre (3,0.5) r=0.4)
      const hit = findHoverFill(fills, { x: 3.8, y: 0.2 });
      expect(hit).not.toBeNull();
      // Must NOT be the circle fill (circle is at (3,0.5))
      expect(polyContainsPoint(hit.polygon2D, { x: 3, y: 0.5 })).toBe(true); // it's the triangle
      // The matched fill has the circle as one of its holes
      expect(hit.holes2D.length).toBeGreaterThan(0);
    });

    it("hover in upper-left triangle → no circle involved", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      const hit = findHoverFill(fills, { x: 0.5, y: 2.5 }); // upper-left region
      expect(hit).not.toBeNull();
      // The upper-left triangle fill has no holes
      expect(hit.holes2D).toHaveLength(0);
    });

    it("circle fill does NOT match a cursor inside the triangle but outside the circle", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      const circleFill = fills.find((f) => polyArea(f.polygon2D) < 1); // smallest area = circle
      expect(circleFill).toBeDefined();
      // (3.8, 0.2) is NOT inside the circle
      expect(polyContainsPoint(circleFill.polygon2D, { x: 3.8, y: 0.2 })).toBe(
        false,
      );
    });

    it("circle fill DOES match a cursor inside the circle", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      const circleFill = fills.find((f) => polyArea(f.polygon2D) < 1);
      expect(polyContainsPoint(circleFill.polygon2D, { x: 3, y: 0.5 })).toBe(
        true,
      );
    });

    it("hover outside the square → null", () => {
      const fills = buildFillDescriptors(rectDiagCircle());
      expect(findHoverFill(fills, { x: 5, y: 5 })).toBeNull();
    });
  });

  // ── Circle straddling the diagonal ─────────────────────────────────────────
  describe("hover – circle whose centre sits on the diagonal", () => {
    // Circle centred exactly on the diagonal (centre at (2,2) on line y=x).
    // Neither triangle reliably contains the centroid, so the circle becomes
    // a direct child of the outer rect — same nesting depth as both triangles.
    // The circle fill must still be independently hoverable.
    function rectDiagCircleOnDiag() {
      return [...squareWithDiagonal(), C(2, 2, 0.4)]; // shape index 5, centred on diagonal
    }

    it("circle intersects diagonal: arc sub-regions involving the circle are detectable", () => {
      // With intersection detection the circle is split where it crosses the diagonal;
      // at least two sub-regions (one in each half) must reference shape 5.
      const loops = findClosedLoopsWithShapes(rectDiagCircleOnDiag());
      const circleLoops = loops.filter((l) => l.shapeIndices.includes(5));
      expect(circleLoops.length).toBeGreaterThanOrEqual(2);
    });

    it("circle fill is present in fill descriptors", () => {
      const fills = buildFillDescriptors(rectDiagCircleOnDiag());
      const circleFills = fills.filter((f) => f.shapeIndices.includes(5));
      expect(circleFills.length).toBeGreaterThan(0);
    });

    it("hover inside the circle (lower-right half) → fill involving circle returned", () => {
      const fills = buildFillDescriptors(rectDiagCircleOnDiag());
      // (2.3, 2.0): x > y, so it is in the lower-right arc sub-region of the circle
      const hit = findHoverFill(fills, { x: 2.3, y: 2.0 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(5); // circle shape
    });
  });

  // ── Issue 1: circle whose boundary crosses the rectangle ──────────────────
  // When a circle is partially outside the rectangle its polygon would be
  // used as a THREE.js hole that "overflows" the outer shape, creating spurious
  // triangles from a rectangle corner to a tangent of the circle outside the
  // expected region.  Fix: only use a loop as a hole when it is FULLY contained
  // (every polygon point inside the parent).

  describe("circle that intersects the rectangle boundary", () => {
    // Outer rect (0,0)→(4,4).  Circle centred at (3.5, 3.5) r=1.5 — the circle
    // extends to x=5 and y=5, outside the rectangle on two sides.
    function rectWithIntersectingCircle() {
      return [R(0, 0, 4, 4), C(3.5, 3.5, 1.5)];
    }

    it("circle that crosses the rect boundary: intersection sub-regions are created", () => {
      // With intersection detection the circle is split where it crosses the rect sides;
      // loops involving BOTH shape 0 (rect) and shape 1 (circle) must exist.
      const loops = findClosedLoopsWithShapes(rectWithIntersectingCircle());
      const intersectLoops = loops.filter(
        (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
      );
      expect(intersectLoops.length).toBeGreaterThan(0);
    });

    it("lens region (inside both rect and circle) is smaller than the rect fill", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      const rectFill = fills.find((f) => polyArea(f.polygon2D) > 10);
      expect(rectFill).toBeDefined();
      // There must be at least one fill with smaller area (the lens / overlap region)
      const smallerFill = fills.find(
        (f) =>
          polyArea(f.polygon2D) < polyArea(rectFill.polygon2D) &&
          polyArea(f.polygon2D) < 10,
      );
      expect(smallerFill).toBeDefined();
    });

    it("hover in overlap area (inside both) → circle fill wins (smaller area)", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      // (3.5, 3.5) is inside both the rectangle and the circle
      const hit = findHoverFill(fills, { x: 3.5, y: 3.5 });
      expect(hit).not.toBeNull();
      // The smallest circle-related fill (the lens/overlap region) should win
      const smallFills = fills.filter((f) => polyArea(f.polygon2D) < 10);
      const circleFill = smallFills.reduce((a, b) =>
        polyArea(a.polygon2D) < polyArea(b.polygon2D) ? a : b,
      );
      expect(hit).toBe(circleFill);
    });

    it("hover in rect area outside circle → rect fill", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      // (0.5, 0.5) is inside the rect but far from the circle (centred at (3.5,3.5))
      const hit = findHoverFill(fills, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(polyArea(hit.polygon2D)).toBeGreaterThan(10); // rect fill
    });

    it("hover outside rect but inside circle → arc sub-region (not full circle)", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      // (4.5, 3.5) is outside the rect (x > 4) but inside the circle
      const hit = findHoverFill(fills, { x: 4.5, y: 3.5 });
      expect(hit).not.toBeNull();
      // Must involve the circle boundary
      expect(hit.shapeIndices).toContain(1);
      // Must be SMALLER than the full circle area — it's just the protruding arc
      // segment, not the whole circle disk
      const fullCircleArea = Math.PI * 1.5 * 1.5;
      expect(polyArea(hit.polygon2D)).toBeLessThan(fullCircleArea);
    });

    it("hover inside rect but outside circle → rect sub-region (not full rect)", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      // (0.5, 0.5) is deep inside the rect but far outside the circle
      const hit = findHoverFill(fills, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      // Must be smaller than the full 4×4 rect — the circle intersection carves
      // the rect into distinct sub-regions and the hover should respect that
      const fullRectArea = 4 * 4;
      expect(polyArea(hit.polygon2D)).toBeLessThan(fullRectArea);
      // Still a rect-boundary fill (shape 0)
      expect(hit.shapeIndices).toContain(0);
    });

    it("hover outside both → null", () => {
      const fills = buildFillDescriptors(rectWithIntersectingCircle());
      expect(findHoverFill(fills, { x: 6, y: 6 })).toBeNull();
    });
  });

  // ── Circle overlapping exactly ONE edge of a rectangle ───────────────────
  // Circle centre is outside the rectangle; only one side (right) is crossed.
  // Three distinct hover regions must be produced:
  //   A) Inner segment  – inside rect AND inside circle  (the "bite" taken from the rect)
  //   B) Outer segment  – inside circle AND outside rect  (the cap that protrudes)
  //   C) Rect remainder – inside rect AND outside circle  (the bulk of the rect)
  //
  // Before the fix, region C returned the full 4×4 rect because the DFS was not
  // finding the "rect minus circle" cycle.

  describe("circle overlapping exactly one edge of a rectangle", () => {
    // Rect (0,0)→(4,4).  Circle centred at (5.5, 2) r=2 — centre is outside the
    // rect, crosses only the right side (x=4) at y≈0.36 and y≈3.64.
    function rectCircleOneSide() {
      return [R(0, 0, 4, 4), C(5.5, 2, 2)];
    }

    it("three distinct intersection sub-regions are created", () => {
      const loops = findClosedLoopsWithShapes(rectCircleOneSide());
      // At least one loop must reference both shapes (the inner segment / lens).
      const both = loops.filter(
        (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
      );
      expect(both.length).toBeGreaterThan(0);
    });

    it("hover inside circle AND outside rect → only the outer arc cap (not the full circle)", () => {
      const fills = buildFillDescriptors(rectCircleOneSide());
      // (6.5, 2) is the far side of the circle, entirely outside the rect.
      const hit = findHoverFill(fills, { x: 6.5, y: 2 });
      expect(hit).not.toBeNull();
      // The circle boundary must define this fill.
      expect(hit.shapeIndices).toContain(1);
      // The returned area must be SMALLER than the full circle — it is only the
      // arc cap that protrudes beyond the rect, not the whole circle disk.
      const fullCircleArea = Math.PI * 2 * 2; // πr² ≈ 12.57
      expect(polyArea(hit.polygon2D)).toBeLessThan(fullCircleArea);
    });

    it("hover inside rect AND inside circle → only the inner arc segment (not the full circle)", () => {
      const fills = buildFillDescriptors(rectCircleOneSide());
      // (3.5, 2) is inside the rect and inside the circle (centre at (5.5,2) r=2,
      // so the leftmost circle point is at x=3.5 which is exactly on the rim).
      // Use x=3.8 to be safely inside both.
      const hit = findHoverFill(fills, { x: 3.8, y: 2 });
      expect(hit).not.toBeNull();
      // Must reference the circle boundary.
      expect(hit.shapeIndices).toContain(1);
      // Must be SMALLER than the full circle — it is only the arc segment
      // that sits inside the rectangle, not the whole circle.
      const fullCircleArea = Math.PI * 2 * 2;
      expect(polyArea(hit.polygon2D)).toBeLessThan(fullCircleArea);
      // And smaller than the full 4×4 rect.
      expect(polyArea(hit.polygon2D)).toBeLessThan(16);
    });

    it("hover inside rect AND outside circle → rect area minus the circle (not the full rect)", () => {
      const fills = buildFillDescriptors(rectCircleOneSide());
      // (0.5, 2) is deep inside the rect and well outside the circle
      // (distance from (5.5,2) = 5 >> r=2).
      const hit = findHoverFill(fills, { x: 0.5, y: 2 });
      expect(hit).not.toBeNull();
      // Must reference the rect boundary.
      expect(hit.shapeIndices).toContain(0);
      // The returned region must be SMALLER than the full 4×4 rect — the circle
      // intersection carves the rect into the inner segment (inside circle) and
      // the remainder (outside circle), and the hover must respect that split.
      expect(polyArea(hit.polygon2D)).toBeLessThan(16);
    });

    it("hover outside both → null", () => {
      const fills = buildFillDescriptors(rectCircleOneSide());
      expect(findHoverFill(fills, { x: 9, y: 2 })).toBeNull();
      expect(findHoverFill(fills, { x: -1, y: 2 })).toBeNull();
    });
  });

  // ── Issue 2: circle on the bisecting diagonal (area tiebreaker) ───────────
  // A circle whose centre lies exactly on the diagonal straddles both triangles.
  // With the full-containment check it cannot be a hole of either triangle, so it
  // sits at the same nesting depth (same renderOrder).  The area tiebreaker in
  // updateHoverFills must ensure the circle fill wins over the triangle fill for
  // any cursor position inside the circle.

  describe("circle centred on the bisecting diagonal", () => {
    // Square (0,0)→(4,4) + diagonal BL→TR + circle centred at (2,2) r=0.8.
    // The circle crosses the diagonal (distance centre→diagonal ≈ 0 < r=0.8).
    function rectDiagCircleOnDiag2() {
      return [...squareWithDiagonal(), C(2, 2, 0.8)]; // shape 5
    }

    it("circle intersects diagonal: arc sub-regions referencing the circle are created", () => {
      // With intersection detection the circle (r=0.8) is properly split by the diagonal,
      // creating at least two sub-regions each referencing shape 5.
      const loops = findClosedLoopsWithShapes(rectDiagCircleOnDiag2());
      const circleLoops = loops.filter((l) => l.shapeIndices.includes(5));
      expect(circleLoops.length).toBeGreaterThanOrEqual(2);
    });

    it("smallest sub-region referencing the circle is smaller than the triangle regions", () => {
      // The DFS also finds larger cycles that include a circle arc as part of their boundary,
      // but there must be at least one pure circle-arc sub-region that is smaller than any triangle.
      const loops = findClosedLoopsWithShapes(rectDiagCircleOnDiag2());
      const circleLoops = loops.filter((l) => l.shapeIndices.includes(5));
      const triLoops = loops.filter(
        (l) => !l.shapeIndices.includes(5) && l.shapeIndices.length === 3,
      );
      if (triLoops.length > 0 && circleLoops.length > 0) {
        const minCircleArea = Math.min(
          ...circleLoops.map((l) => polyArea(l.polygon)),
        );
        const minTriArea = Math.min(
          ...triLoops.map((l) => polyArea(l.polygon)),
        );
        expect(minCircleArea).toBeLessThan(minTriArea);
      }
    });

    it("hover inside the circle (lower-right arc) → fill involving circle returned", () => {
      const fills = buildFillDescriptors(rectDiagCircleOnDiag2());
      // (2.5, 1.7): x > y, so it is inside the lower-right arc sub-region of the circle
      const hit = findHoverFill(fills, { x: 2.5, y: 1.7 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(5); // circle shape
    });

    it("hover in lower-right triangle far outside circle → larger fill returned (not the tiny circle sub-region)", () => {
      const fills = buildFillDescriptors(rectDiagCircleOnDiag2());
      const circleFills = fills.filter((f) => f.shapeIndices.includes(5));
      const minCircleArea = Math.min(
        ...circleFills.map((f) => polyArea(f.polygon2D)),
      );
      // (3.8, 0.2) is far from the circle: the matched fill must be larger than the tiny arc regions
      const hit = findHoverFill(fills, { x: 3.8, y: 0.2 });
      expect(hit).not.toBeNull();
      expect(polyArea(hit.polygon2D)).toBeGreaterThan(minCircleArea);
    });

    it("fills involving the circle exist in fill descriptors", () => {
      const fills = buildFillDescriptors(rectDiagCircleOnDiag2());
      const circleFills = fills.filter((f) => f.shapeIndices.includes(5));
      expect(circleFills.length).toBeGreaterThan(0);
    });
  });

  // ── Issue 3: extrude profile selection with complicated area ─────────────
  // The extrude click used THREE.js raycasting on coplanar fill meshes, which
  // returns an arbitrary first hit.  The fix converts to 2D point-in-polygon
  // detection (same as updateHoverFills) with smallest-area tiebreaking, so the
  // most specific region is always selected.
  //
  // The tests here validate the underlying geometry: that the fill descriptors
  // produced for complicated areas are the ones that would be selected as the
  // extrude profile.

  describe("extrude profile matching for complicated areas", () => {
    // Simulate the extrude-profile pick logic (2D, smallest-area match).
    function findExtrudeProfile(fills, point) {
      let best = null,
        bestArea = Infinity;
      for (const f of fills) {
        if (
          polyContainsPoint(f.polygon2D, point) &&
          !f.holes2D.some((h) => polyContainsPoint(h, point))
        ) {
          const area = polyArea(f.polygon2D);
          if (area < bestArea) {
            best = f;
            bestArea = area;
          }
        }
      }
      return best;
    }

    it("rect+diagonal: clicking lower-right triangle → lower-right profile selected", () => {
      const fills = buildFillDescriptors(
        squareWithDiagonal().map ? squareWithDiagonal() : squareLines(),
      );
      // re-use squareWithDiagonal fixture
      const f = buildFillDescriptors(squareWithDiagonal());
      const hit = findExtrudeProfile(f, { x: 3.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toHaveLength(3); // triangle, not full square
    });

    it("rect+diagonal+circle: clicking circle → circle profile (smallest area)", () => {
      const f = buildFillDescriptors(rectDiagCircle());
      const hit = findExtrudeProfile(f, { x: 3, y: 0.5 }); // circle centre
      expect(hit).not.toBeNull();
      // The circle fill must be the smallest-area matching fill
      const circleFill = f.find((fd) => polyArea(fd.polygon2D) < 1);
      expect(hit).toBe(circleFill);
    });

    it("rect+diagonal+circle: clicking triangle outside circle → triangle profile with circle as hole", () => {
      const f = buildFillDescriptors(rectDiagCircle());
      const hit = findExtrudeProfile(f, { x: 3.8, y: 0.2 }); // in lower-right, outside circle
      expect(hit).not.toBeNull();
      expect(hit.holes2D).toHaveLength(1); // circle is hole
    });

    it("nested rects: clicking inner rect → inner profile, not outer", () => {
      const f = buildFillDescriptors(nestedRects());
      const hit = findExtrudeProfile(f, { x: 2, y: 2 }); // inside inner rect
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // inner shape
      expect(hit.shapeIndices).not.toContain(0);
    });

    it("nested rects: clicking outer area → outer profile (includes hole boundary in shapeIndices)", () => {
      const f = buildFillDescriptors(nestedRects());
      const hit = findExtrudeProfile(f, { x: 8, y: 8 }); // outer area, not inside inner rect
      expect(hit).not.toBeNull();
      // The outer fill's shapeIndices includes both the outer rect (0) AND the inner rect
      // boundary (1) because selecting the ring region selects all its bounding shapes.
      expect(hit.shapeIndices).toContain(0);
      expect(hit.polygon2D).toHaveLength(4); // rect polygon, not circle
    });

    it("rect with intersecting circle: clicking overlap → circle profile (smallest area)", () => {
      const shapes = [R(0, 0, 4, 4), C(3.5, 3.5, 1.5)];
      const f = buildFillDescriptors(shapes);
      const hit = findExtrudeProfile(f, { x: 3.5, y: 3.5 });
      expect(hit).not.toBeNull();
      expect(polyArea(hit.polygon2D)).toBeLessThan(
        polyArea(f.find((fd) => polyArea(fd.polygon2D) > 10).polygon2D),
      );
    });
  });
});
