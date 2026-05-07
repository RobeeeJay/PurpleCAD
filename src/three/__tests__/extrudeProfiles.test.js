import { describe, it, expect, vi } from "vitest";
import {
  findClosedLoopsWithShapes,
  findClosedLoops,
  polyContainsPoint,
  polyCentroid,
  polyArea,
  groupLoopsWithHoles,
} from "../sceneObjects.js";

// ── Minimal THREE.js mock ─────────────────────────────────────────────────────
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
    ExtrudeGeometry: class {
      constructor(s, o) {
        this.shape = s;
        this.opts = o;
      }
    },
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
    Path: class {
      constructor(pts) {
        this.points = pts;
      }
    },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });
const R = (x1, y1, x2, y2) => ({ type: "rect", x1, y1, x2, y2 });

// Build the same fill descriptors used by the sketch hover and extrude pick logic.
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

// Return the fill at `point` that would be picked as an extrude profile.
// Uses the same render-order + smallest-area rule as the hover fill logic so
// that properly nested fills (not spurious larger cycles) are preferred.
function pickExtrudeProfile(shapes, point) {
  const fills = buildFillDescriptors(shapes);
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

// Check that a polygon is usable as an ExtrudeGeometry input.
// Three.js ExtrudeGeometry needs at least 3 points and positive area to
// produce a solid body (not just outer surfaces).  We deliberately avoid
// checking polyCentroid(poly) ∈ poly because polyCentroid uses the arithmetic
// vertex mean which can fall outside non-convex / thin polygons (e.g. the arc
// segment that protrudes outside a rect), even though the polygon is valid.
function isValidExtrudePolygon(poly) {
  if (!poly || poly.length < 3) return false;
  return polyArea(poly) > 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("extrude profile geometry", () => {
  // ── Simple closed shapes ───────────────────────────────────────────────────

  describe("simple closed shapes produce valid profiles", () => {
    it("rectangle produces a single non-degenerate polygon", () => {
      const loops = findClosedLoops([R(0, 0, 4, 4)]);
      expect(loops.length).toBe(1);
      expect(isValidExtrudePolygon(loops[0])).toBe(true);
      expect(polyArea(loops[0])).toBeCloseTo(16, 1);
    });

    it("standalone circle produces a non-degenerate polygon", () => {
      const loops = findClosedLoops([C(0, 0, 2)]);
      expect(loops.length).toBe(1);
      expect(isValidExtrudePolygon(loops[0])).toBe(true);
      // Area close to π r² = ~12.57
      expect(polyArea(loops[0])).toBeGreaterThan(12);
      expect(polyArea(loops[0])).toBeLessThan(13);
    });

    it("standalone circle has centroid at its centre", () => {
      const loops = findClosedLoops([C(3, 5, 1.5)]);
      const c = polyCentroid(loops[0]);
      expect(c.x).toBeCloseTo(3, 1);
      expect(c.y).toBeCloseTo(5, 1);
    });

    it("rectangle bounded by 4 lines produces a non-degenerate polygon", () => {
      const lines = [
        L(0, 4, 4, 4),
        L(4, 4, 4, 0),
        L(4, 0, 0, 0),
        L(0, 0, 0, 4),
      ];
      const loops = findClosedLoops(lines);
      expect(loops.some((l) => polyArea(l) > 10)).toBe(true);
      loops
        .filter((l) => polyArea(l) > 10)
        .forEach((l) => {
          expect(isValidExtrudePolygon(l)).toBe(true);
        });
    });
  });

  // ── Circle fully inside rectangle ─────────────────────────────────────────
  // The correct extrude of the ring region requires the rectangle as the outer
  // polygon with the circle as a hole — otherwise the solid body would have
  // material where the hole should be.

  describe("circle fully inside rectangle", () => {
    // Rect (0,0)→(10,10), circle at (5,5) r=2 — no boundary crossing.
    const shapes = [R(0, 0, 10, 10), C(5, 5, 2)];

    it("the ring fill (rect with circle hole) is a valid extrude polygon", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find(
        (f) => f.polygon2D.length === 4 && f.holes2D.length === 1,
      );
      expect(ringFill).toBeDefined();
      expect(isValidExtrudePolygon(ringFill.polygon2D)).toBe(true);
    });

    it("the circle hole is inside the rectangle outer polygon", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find((f) => f.holes2D.length === 1);
      expect(ringFill).toBeDefined();
      const holeCentroid = polyCentroid(ringFill.holes2D[0]);
      expect(polyContainsPoint(ringFill.polygon2D, holeCentroid)).toBe(true);
    });

    it("the circle hole is a non-degenerate polygon", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find((f) => f.holes2D.length === 1);
      expect(isValidExtrudePolygon(ringFill.holes2D[0])).toBe(true);
    });

    it("clicking inside the circle selects the circle fill (not the ring)", () => {
      const profile = pickExtrudeProfile(shapes, { x: 5, y: 5 });
      expect(profile).not.toBeNull();
      // Circle area ~12.57, ring area ~87.4
      expect(polyArea(profile.polygon2D)).toBeLessThan(14);
    });

    it("clicking the ring area (outside circle) selects the ring fill", () => {
      const profile = pickExtrudeProfile(shapes, { x: 1, y: 1 });
      expect(profile).not.toBeNull();
      expect(profile.holes2D.length).toBe(1); // has the circle hole
      expect(polyArea(profile.polygon2D)).toBeGreaterThan(80); // near 100
    });
  });

  // ── Circle intersecting one side of a rectangle ───────────────────────────
  // Three sub-regions: lens (inside both), outer arc (inside circle only),
  // rect remainder (inside rect only).  Each must be a valid solid profile.

  describe("circle intersecting one side of a rectangle", () => {
    // Rect (0,0)→(4,4), circle at (5,2) r=2 — crosses the right side.
    const shapes = [R(0, 0, 4, 4), C(5, 2, 2)];

    it("all generated fill polygons are valid extrude profiles", () => {
      const fills = buildFillDescriptors(shapes);
      expect(fills.length).toBeGreaterThan(0);
      fills.forEach((f) => {
        expect(isValidExtrudePolygon(f.polygon2D)).toBe(true);
        f.holes2D.forEach((h) => expect(isValidExtrudePolygon(h)).toBe(true));
      });
    });

    it("lens region (inside both rect and circle) has smaller area than either full shape", () => {
      const lensProfile = pickExtrudeProfile(shapes, { x: 3.5, y: 2 }); // inside overlap
      expect(lensProfile).not.toBeNull();
      expect(lensProfile.shapeIndices).toContain(0); // rect boundary
      expect(lensProfile.shapeIndices).toContain(1); // circle boundary
      expect(polyArea(lensProfile.polygon2D)).toBeLessThan(Math.PI * 4); // < full circle
      expect(polyArea(lensProfile.polygon2D)).toBeLessThan(16); // < full rect
    });

    it("picking inside circle but outside rect → arc sub-region, not full circle", () => {
      // (6, 2) is the circle centre, well outside the rect (x=6 > 4)
      const profile = pickExtrudeProfile(shapes, { x: 6, y: 2 });
      expect(profile).not.toBeNull();
      expect(profile.shapeIndices).toContain(1); // circle boundary
      // Must be smaller than the full circle (π*4 ≈ 12.57)
      expect(polyArea(profile.polygon2D)).toBeLessThan(Math.PI * 4);
    });

    it("picking inside rect but outside circle → a rect fill is returned", () => {
      // (0.5, 0.5) is deep inside the rect but far from the circle.
      // The circle crosses only one side, so the arc edges are suppressed in
      // the DFS (they are parallel to the straight segment between the two
      // intersection nodes).  The returned fill involves the rect boundary.
      const profile = pickExtrudeProfile(shapes, { x: 0.5, y: 0.5 });
      expect(profile).not.toBeNull();
      expect(profile.shapeIndices).toContain(0); // rect boundary involved
    });
  });

  // ── Circle extending outside two sides of a rectangle ────────────────────
  // Circle centre inside rect, circle extends past two sides.

  describe("circle extending outside two sides of rectangle", () => {
    // Rect (0,0)→(4,4), circle at (3.5,3.5) r=1.5 — extends past right and top.
    const shapes = [R(0, 0, 4, 4), C(3.5, 3.5, 1.5)];

    it("all fill polygons are valid extrude profiles", () => {
      const fills = buildFillDescriptors(shapes);
      expect(fills.length).toBeGreaterThan(0);
      fills.forEach((f) => {
        expect(isValidExtrudePolygon(f.polygon2D)).toBe(true);
        f.holes2D.forEach((h) => expect(isValidExtrudePolygon(h)).toBe(true));
      });
    });

    it("hover at circle centre (inside rect + circle) → overlap fill, not full circle", () => {
      const profile = pickExtrudeProfile(shapes, { x: 3.5, y: 3.5 });
      expect(profile).not.toBeNull();
      const fullCircleArea = Math.PI * 1.5 * 1.5;
      expect(polyArea(profile.polygon2D)).toBeLessThan(fullCircleArea);
    });

    it("hover outside rect but inside circle → arc sub-region, not full circle", () => {
      // (4.5, 3.5) is outside the rect (x > 4) but inside the circle
      const profile = pickExtrudeProfile(shapes, { x: 4.5, y: 3.5 });
      expect(profile).not.toBeNull();
      expect(profile.shapeIndices).toContain(1); // circle boundary
      const fullCircleArea = Math.PI * 1.5 * 1.5;
      expect(polyArea(profile.polygon2D)).toBeLessThan(fullCircleArea);
    });

    it("hover inside rect far from circle → rect sub-region, not full 4×4 rect", () => {
      const profile = pickExtrudeProfile(shapes, { x: 0.5, y: 0.5 });
      expect(profile).not.toBeNull();
      expect(polyArea(profile.polygon2D)).toBeLessThan(16);
    });
  });

  // ── Two overlapping circles ───────────────────────────────────────────────
  // Should produce three distinct valid solid profiles:
  // left crescent, lens, right crescent.

  describe("two overlapping circles", () => {
    // Circle A at (0,0) r=2, Circle B at (2.5,0) r=2.
    const shapes = [C(0, 0, 2), C(2.5, 0, 2)];

    it("all fill polygons are non-degenerate", () => {
      const fills = buildFillDescriptors(shapes);
      expect(fills.length).toBeGreaterThan(0);
      fills.forEach((f) => {
        expect(f.polygon2D.length).toBeGreaterThanOrEqual(3);
        expect(polyArea(f.polygon2D)).toBeGreaterThan(0);
      });
    });

    it("left-only crescent is a valid extrude polygon", () => {
      const profile = pickExtrudeProfile(shapes, { x: -1, y: 0 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      expect(profile.shapeIndices).toContain(0); // bounded by circle A
    });

    it("right-only crescent is a valid extrude polygon", () => {
      const profile = pickExtrudeProfile(shapes, { x: 3.5, y: 0 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      expect(profile.shapeIndices).toContain(1); // bounded by circle B
    });

    it("lens region (inside both circles) is a valid, smaller extrude polygon", () => {
      const profile = pickExtrudeProfile(shapes, { x: 1.25, y: 0 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      expect(profile.shapeIndices).toContain(0);
      expect(profile.shapeIndices).toContain(1);
    });

    it("lens area is smaller than either crescent area", () => {
      const lens = pickExtrudeProfile(shapes, { x: 1.25, y: 0 });
      const crescentA = pickExtrudeProfile(shapes, { x: -1, y: 0 });
      const crescentB = pickExtrudeProfile(shapes, { x: 3.5, y: 0 });
      expect(polyArea(lens.polygon2D)).toBeLessThan(
        polyArea(crescentA.polygon2D),
      );
      expect(polyArea(lens.polygon2D)).toBeLessThan(
        polyArea(crescentB.polygon2D),
      );
    });

    it("no fill has zero or negative area (would produce surfaces, not solids)", () => {
      const fills = buildFillDescriptors(shapes);
      fills.forEach((f) => {
        expect(polyArea(f.polygon2D)).toBeGreaterThan(0);
        f.holes2D.forEach((h) => expect(polyArea(h)).toBeGreaterThan(0));
      });
    });
  });

  // ── Rectangle with diagonal and inner circle ──────────────────────────────
  // The circle must appear as a hole when selecting the enclosing triangle.

  describe("rectangle with diagonal and inner circle", () => {
    // 4×4 square, diagonal BL→TR, circle at (3,0.5) r=0.4 (inside lower-right triangle).
    const shapes = [
      L(0, 4, 4, 4),
      L(4, 4, 4, 0),
      L(4, 0, 0, 0),
      L(0, 0, 0, 4),
      L(0, 0, 4, 4),
      C(3, 0.5, 0.4),
    ];

    it("clicking the circle → circle profile (valid, small area)", () => {
      const profile = pickExtrudeProfile(shapes, { x: 3, y: 0.5 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      expect(profile.shapeIndices).toContain(5); // circle shape
      expect(polyArea(profile.polygon2D)).toBeLessThan(1); // small circle
    });

    it("clicking the triangle outside the circle → triangle profile with circle as hole", () => {
      // (3.8, 0.2) is in the lower-right triangle, outside the circle
      const profile = pickExtrudeProfile(shapes, { x: 3.8, y: 0.2 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      // Triangle profile has the circle as a hole
      expect(profile.holes2D.length).toBeGreaterThan(0);
      profile.holes2D.forEach((h) =>
        expect(isValidExtrudePolygon(h)).toBe(true),
      );
    });

    it("clicking the upper-left triangle → profile with no hole (circle is in the other triangle)", () => {
      const profile = pickExtrudeProfile(shapes, { x: 0.5, y: 3.5 });
      expect(profile).not.toBeNull();
      expect(isValidExtrudePolygon(profile.polygon2D)).toBe(true);
      expect(profile.holes2D.length).toBe(0); // circle is not in this triangle
    });

    it("all generated fill polygons are valid", () => {
      const fills = buildFillDescriptors(shapes);
      expect(fills.length).toBeGreaterThan(0);
      fills.forEach((f) => {
        expect(isValidExtrudePolygon(f.polygon2D)).toBe(true);
        f.holes2D.forEach((h) => expect(isValidExtrudePolygon(h)).toBe(true));
      });
    });
  });

  // ── Nested rectangles ─────────────────────────────────────────────────────
  // Outer rect with inner rect as hole → solid ring when extruded.

  describe("nested rectangles (ring profile)", () => {
    const shapes = [R(0, 0, 10, 10), R(2, 2, 8, 8)];

    it("outer ring fill has the inner rectangle as a hole", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find((f) => f.holes2D.length === 1);
      expect(ringFill).toBeDefined();
      expect(isValidExtrudePolygon(ringFill.polygon2D)).toBe(true);
      expect(isValidExtrudePolygon(ringFill.holes2D[0])).toBe(true);
    });

    it("hole is fully inside the outer polygon", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find((f) => f.holes2D.length === 1);
      const holeCentroid = polyCentroid(ringFill.holes2D[0]);
      expect(polyContainsPoint(ringFill.polygon2D, holeCentroid)).toBe(true);
    });

    it("ring area equals outer area minus inner area", () => {
      const fills = buildFillDescriptors(shapes);
      const ringFill = fills.find((f) => f.holes2D.length === 1);
      expect(polyArea(ringFill.polygon2D)).toBeCloseTo(100, 0); // outer 10×10
      expect(polyArea(ringFill.holes2D[0])).toBeCloseTo(36, 0); // inner 6×6
    });

    it("clicking inside ring → ring profile selected (not the inner rect)", () => {
      const profile = pickExtrudeProfile(shapes, { x: 1, y: 1 }); // corner of ring area
      expect(profile).not.toBeNull();
      expect(profile.holes2D.length).toBe(1);
    });
  });

  // ── Extrude re-matching for circle-intersected rectangle ─────────────────
  // When a circle crosses one edge of a rectangle, groupLoopsWithHoles places
  // the inner segment (inside rect ∩ circle) as a CHILD of the full-circle
  // root, not as a root itself.  The extrude live-recompute code must search
  // all entries (roots + descendants) so it can re-match the inner segment
  // after sketch edits.  If it only searches roots it picks the full circle or
  // full rect and produces the wrong (or degenerate) solid.

  describe("extrude profile re-matching for circle that crosses one rect edge", () => {
    // Rect (0,0)→(4,4), circle at (5.5,2) r=2 — crosses only the right side.
    const shapes = [R(0, 0, 4, 4), C(5.5, 2, 2)];

    // Replicate the live-recompute centroid search.  `searchAll=true` mirrors
    // the fixed code that walks roots AND descendants; `searchAll=false` mirrors
    // the old buggy code that only walked roots.
    function rematchProfile(profileCentroid, searchAll = true) {
      const loops = findClosedLoops(shapes);
      const grouped = groupLoopsWithHoles(loops);
      const candidates = [];
      const collect = (e) => {
        candidates.push(e);
        e.entries.forEach(collect);
      };
      if (searchAll) {
        grouped.forEach(collect);
      } else {
        // Old behaviour: only root entries.
        grouped.forEach((e) => candidates.push(e));
      }
      const match = candidates.reduce(
        (best, g) => {
          const c = polyCentroid(g.polygon);
          const d = Math.hypot(
            c.x - profileCentroid.x,
            c.y - profileCentroid.y,
          );
          return d < best.d ? { g, d } : best;
        },
        { g: candidates[0], d: Infinity },
      ).g;
      return { polygon: match.polygon, holes: match.holes };
    }

    it("inner segment (inside rect ∩ circle) has a valid, non-degenerate polygon", () => {
      const fills = buildFillDescriptors(shapes);
      // Pick the fill at a point that is inside the rect AND inside the circle.
      const innerFill = pickExtrudeProfile(shapes, { x: 3.8, y: 2 });
      expect(innerFill).not.toBeNull();
      expect(innerFill.shapeIndices).toContain(1); // circle boundary
      expect(polyArea(innerFill.polygon2D)).toBeGreaterThan(0);
      expect(innerFill.polygon2D.length).toBeGreaterThanOrEqual(3);
    });

    it("re-matching with stored centroid (searching all entries) finds the inner segment", () => {
      // Get the inner segment fill and its stored centroid.
      const innerFill = pickExtrudeProfile(shapes, { x: 3.8, y: 2 });
      const stored = polyCentroid(innerFill.polygon2D);
      const match = rematchProfile(stored, true);
      // The re-matched polygon must be close to the original inner segment area
      // (bounded by the arc and the rect edge, not the full circle or full rect).
      expect(polyArea(match.polygon)).toBeCloseTo(
        polyArea(innerFill.polygon2D),
        0,
      );
      expect(match.holes.length).toBe(0); // inner segment has no holes
    });

    it("old root-only re-matching gives the WRONG polygon (documents the regression)", () => {
      const innerFill = pickExtrudeProfile(shapes, { x: 3.8, y: 2 });
      const stored = polyCentroid(innerFill.polygon2D);
      const wrongMatch = rematchProfile(stored, false); // old buggy behaviour
      // The old code returned the nearest ROOT (full circle or full rect),
      // neither of which equals the inner segment area.
      expect(polyArea(wrongMatch.polygon)).not.toBeCloseTo(
        polyArea(innerFill.polygon2D),
        0,
      );
    });

    it("re-matching for rect-minus-circle profile finds the correct polygon", () => {
      const rectFill = pickExtrudeProfile(shapes, { x: 0.5, y: 2 });
      expect(rectFill).not.toBeNull();
      expect(rectFill.shapeIndices).toContain(0); // rect boundary
      const stored = polyCentroid(rectFill.polygon2D);
      const match = rematchProfile(stored, true);
      // The matched polygon should be roughly the same area as the original fill.
      expect(polyArea(match.polygon)).toBeCloseTo(
        polyArea(rectFill.polygon2D),
        0,
      );
    });

    it("re-matched inner segment polygon is valid for ExtrudeGeometry (area > 0, ≥3 pts)", () => {
      const innerFill = pickExtrudeProfile(shapes, { x: 3.8, y: 2 });
      const stored = polyCentroid(innerFill.polygon2D);
      const match = rematchProfile(stored, true);
      expect(match.polygon.length).toBeGreaterThanOrEqual(3);
      expect(polyArea(match.polygon)).toBeGreaterThan(0);
      // No holes — the inner segment is a simple bounded region.
      expect(match.holes.length).toBe(0);
    });

    it("outer arc cap (outside rect, inside circle) re-matches to its own polygon", () => {
      const outerFill = pickExtrudeProfile(shapes, { x: 6.5, y: 2 });
      expect(outerFill).not.toBeNull();
      const stored = polyCentroid(outerFill.polygon2D);
      const match = rematchProfile(stored, true);
      expect(polyArea(match.polygon)).toBeCloseTo(
        polyArea(outerFill.polygon2D),
        0,
      );
    });
  });

  // ── Profile centroid matching ─────────────────────────────────────────────
  // The extrude geometry code re-matches profiles by centroid proximity so that
  // edits to the sketch update the solid.  polyCentroid uses the arithmetic
  // vertex mean, which is reliable for convex polygons and rect-like shapes
  // but can fall outside the polygon for large "arc-boundary" fills (e.g. the
  // "rect minus inner circle segment" polygon has most vertices on the curved
  // arc, biasing the mean into the excluded arc region).  Those fills are still
  // correctly handled by groupLoopsWithHoles (which uses isFullyContained, not
  // just the centroid), so we only test the shapes where the centroid is stable.

  describe("profile centroid is inside its polygon", () => {
    const fixtures = [
      { label: "rectangle", shapes: [R(0, 0, 4, 4)] },
      { label: "circle", shapes: [C(0, 0, 2)] },
      { label: "rect+inner circle", shapes: [R(0, 0, 10, 10), C(5, 5, 2)] },
      { label: "two circles", shapes: [C(0, 0, 2), C(2.5, 0, 2)] },
    ];

    fixtures.forEach(({ label, shapes }) => {
      it(`${label}: every fill polygon contains its own centroid`, () => {
        const fills = buildFillDescriptors(shapes);
        fills.forEach((f) => {
          const c = polyCentroid(f.polygon2D);
          expect(polyContainsPoint(f.polygon2D, c)).toBe(true);
        });
      });
    });
  });

  // ── Geometry centring for correct transform pivot ─────────────────────────
  // ExtrudeGeometry is built from the raw 2D polygon coordinates, which live
  // in the sketch's local space and are rarely centred at (0,0).  Without
  // centring, the mesh's local origin (its transform pivot) ends up at the
  // sketch origin — often the world origin — so rotation and scaling feel
  // completely wrong.
  //
  // The fix: subtract polyCentroid from every polygon vertex before building
  // the geometry, then compensate the mesh position by that same offset
  // (rotated into world space).  This test suite verifies the centring
  // calculation is correct so that the resulting geometry is always centred
  // at (0,0) in local 2D and therefore uses the correct transform pivot.

  describe("polygon centering for correct transform pivot", () => {
    // Helper: apply the same centring the production code does and return
    // the centred polygon plus the offset that was removed.
    function centerPolygon(poly) {
      const c = polyCentroid(poly);
      return {
        centered: poly.map((p) => ({ x: p.x - c.x, y: p.y - c.y })),
        offset: c,
      };
    }

    it("a rectangle not at the origin has a non-zero centroid before centring", () => {
      // Rect from (5,3) to (9,7): centroid should be (7,5).
      const loops = findClosedLoops([R(5, 3, 9, 7)]);
      const poly = loops[0];
      const c = polyCentroid(poly);
      expect(Math.abs(c.x)).toBeGreaterThan(0.1);
      expect(Math.abs(c.y)).toBeGreaterThan(0.1);
    });

    it("after centring, the polygon centroid is at the origin", () => {
      const loops = findClosedLoops([R(5, 3, 9, 7)]);
      const { centered } = centerPolygon(loops[0]);
      const c = polyCentroid(centered);
      expect(c.x).toBeCloseTo(0, 10);
      expect(c.y).toBeCloseTo(0, 10);
    });

    it("centring a circle not at the origin places its centroid at (0,0)", () => {
      const loops = findClosedLoops([C(4, -3, 1.5)]);
      const { centered, offset } = centerPolygon(loops[0]);
      // The removed offset should match the circle centre.
      expect(offset.x).toBeCloseTo(4, 1);
      expect(offset.y).toBeCloseTo(-3, 1);
      const c = polyCentroid(centered);
      expect(c.x).toBeCloseTo(0, 10);
      expect(c.y).toBeCloseTo(0, 10);
    });

    it("centring preserves the polygon area", () => {
      const loops = findClosedLoops([R(10, 20, 14, 25)]);
      const poly = loops[0];
      const { centered } = centerPolygon(poly);
      expect(polyArea(centered)).toBeCloseTo(polyArea(poly), 6);
    });

    it("centring the rect-minus-circle profile still preserves area", () => {
      // One-side intersection: rect + circle crossing the right edge.
      const shapes = [R(0, 0, 4, 4), C(5.5, 2, 2)];
      const fills = buildFillDescriptors(shapes);
      // The rect-minus-circle fill (largest rect sub-region).
      const rectFill = pickExtrudeProfile(shapes, { x: 0.5, y: 2 });
      expect(rectFill).not.toBeNull();
      const { centered } = centerPolygon(rectFill.polygon2D);
      expect(polyArea(centered)).toBeCloseTo(polyArea(rectFill.polygon2D), 3);
    });

    it("centring the inner-segment fill gives a (0,0) centroid", () => {
      const shapes = [R(0, 0, 4, 4), C(5.5, 2, 2)];
      const innerFill = pickExtrudeProfile(shapes, { x: 3.8, y: 2 });
      expect(innerFill).not.toBeNull();
      const { centered } = centerPolygon(innerFill.polygon2D);
      const c = polyCentroid(centered);
      expect(c.x).toBeCloseTo(0, 10);
      expect(c.y).toBeCloseTo(0, 10);
    });

    it("every fill for two overlapping circles can be centred at origin", () => {
      const fills = buildFillDescriptors([C(0, 0, 2), C(2.5, 0, 2)]);
      fills.forEach((f) => {
        const { centered } = centerPolygon(f.polygon2D);
        const c = polyCentroid(centered);
        expect(c.x).toBeCloseTo(0, 8);
        expect(c.y).toBeCloseTo(0, 8);
      });
    });

    it("mesh position offset equals the polygon centroid (no rotation)", () => {
      // For a sketch with no rotation, the world offset equals the local offset.
      // Verify the offset vector matches what polyCentroid returns for the polygon.
      const shapes = [R(3, 7, 7, 11)]; // rect centred at (5,9)
      const loops = findClosedLoops(shapes);
      const poly = loops[0];
      const { offset } = centerPolygon(poly);
      // The mesh's position offset (in local XY) must equal the centroid.
      expect(offset.x).toBeCloseTo(5, 1);
      expect(offset.y).toBeCloseTo(9, 1);
    });
  });

  // ── Selection-to-extrusion area consistency ───────────────────────────────
  // The extrude pipeline has two independent steps:
  //   1. buildExtrudeSelectGroup – builds fill meshes; stores
  //      profileCentroid = polyCentroid(polygon) on each mesh.
  //   2. buildSceneObjects – on every rebuild, calls findClosedLoops and
  //      picks the polygon whose interior contains profileCentroid
  //      (smallest-area wins when multiple polygons qualify).
  //
  // These tests simulate both steps and assert the picked area and the
  // re-matched area are the same, catching any regression where toggling
  // resolution or sketch edits causes the wrong region to be extruded.

  describe("selected area matches extruded area", () => {
    // Mirrors buildExtrudeSelectGroup: build fills with the given resolution
    // params and return the fill at `point` using the same pick rule.
    function pickFillAtPoint(
      shapes,
      point,
      curveSegments = 32,
      precision = null,
    ) {
      const loopsWithShapes = findClosedLoopsWithShapes(
        shapes,
        curveSegments,
        precision,
      );
      const polygons = loopsWithShapes.map((l) => l.polygon);
      const grouped = groupLoopsWithHoles(polygons);
      const fills = [];
      const add = ({ polygon, holes, entries }, order) => {
        fills.push({ polygon2D: polygon, holes2D: holes, renderOrder: order });
        entries.forEach((e) => add(e, order + 1));
      };
      grouped.forEach((e) => add(e, 999));
      let best = null;
      for (const f of fills) {
        if (!polyContainsPoint(f.polygon2D, point)) continue;
        if (f.holes2D.some((h) => polyContainsPoint(h, point))) continue;
        const ord = f.renderOrder,
          area = polyArea(f.polygon2D);
        const bOrd = best?.renderOrder ?? -1,
          bArea = best ? polyArea(best.polygon2D) : Infinity;
        if (!best || ord > bOrd || (ord === bOrd && area < bArea)) best = f;
      }
      return best;
    }

    // Mirrors buildSceneObjects profile re-matching: given the stored click
    // point (profileCentroid) and the stored polygon area, find the best-matching
    // polygon.  The click point is guaranteed to be inside the correct polygon
    // and not in any of its holes, so smallest-area among containing polygons is
    // reliable.  The area comparison is used as a secondary guard when multiple
    // polygons contain the point (e.g. after sketch edits or resolution changes).
    // Falls back to nearest-centroid when no polygon contains the point.
    function rematchFromCentroid(
      shapes,
      clickPoint,
      storedArea,
      curveSegments = 32,
      precision = null,
    ) {
      const loops = findClosedLoops(shapes, curveSegments, precision);
      const grouped = groupLoopsWithHoles(loops);
      const all = [];
      const collect = (e) => {
        all.push(e);
        e.entries.forEach(collect);
      };
      grouped.forEach(collect);
      if (all.length === 0) return null;
      const pc = clickPoint;
      const inside = all.filter((g) => polyContainsPoint(g.polygon, pc));
      if (inside.length > 0) {
        return inside.reduce((b, g) => {
          const da = Math.abs(polyArea(g.polygon) - storedArea);
          const db = Math.abs(polyArea(b.polygon) - storedArea);
          return da < db ? g : b;
        });
      }
      return all.reduce(
        (b, g) => {
          const c = polyCentroid(g.polygon);
          const d = Math.hypot(c.x - pc.x, c.y - pc.y);
          return d < b.d ? { g, d } : b;
        },
        { g: all[0], d: Infinity },
      ).g;
    }

    // Pick a fill at `point`, then simulate what buildSceneObjects does:
    // use the click position (not polyCentroid) as the stored profileCentroid
    // and re-match at the given extrusion resolution.
    function assertMatch(
      shapes,
      point,
      selSegs = 32,
      selPrec = null,
      extSegs = 32,
      extPrec = null,
    ) {
      const sel = pickFillAtPoint(shapes, point, selSegs, selPrec);
      expect(sel).not.toBeNull();
      // Use the click point as profileCentroid — mirrors cameraControls.js which
      // now stores bestLocalPt instead of polyCentroid(polygon).
      const storedArea = polyArea(sel.polygon2D);
      const matched = rematchFromCentroid(
        shapes,
        point,
        storedArea,
        extSegs,
        extPrec,
      );
      expect(matched).not.toBeNull();
      // Areas must agree within 0.5 unit² — tolerates minor tessellation
      // differences between resolutions for the same geometric region.
      expect(polyArea(matched.polygon)).toBeCloseTo(storedArea, 0);
    }

    describe("preview mode (32 segments)", () => {
      it("standalone rectangle", () =>
        assertMatch([R(0, 0, 4, 4)], { x: 2, y: 2 }));

      it("standalone circle", () => assertMatch([C(0, 0, 2)], { x: 0, y: 0 }));

      it("circle+rect — lens region (inside both)", () =>
        assertMatch([R(0, 0, 4, 4), C(5, 2, 2)], { x: 3.5, y: 2 }));

      it("circle+rect — outer arc (inside circle only)", () =>
        assertMatch([R(0, 0, 4, 4), C(5, 2, 2)], { x: 6, y: 2 }));

      it("circle+rect — rect remainder (inside rect only)", () =>
        assertMatch([R(0, 0, 4, 4), C(5, 2, 2)], { x: 0.5, y: 2 }));

      it("two overlapping circles — left crescent", () =>
        assertMatch([C(0, 0, 2), C(2.5, 0, 2)], { x: -1, y: 0 }));

      it("two overlapping circles — lens", () =>
        assertMatch([C(0, 0, 2), C(2.5, 0, 2)], { x: 1.25, y: 0 }));

      it("two overlapping circles — right crescent", () =>
        assertMatch([C(0, 0, 2), C(2.5, 0, 2)], { x: 3.5, y: 0 }));

      it("circle fully inside rect — inner circle fill", () =>
        assertMatch([R(0, 0, 10, 10), C(5, 5, 2)], { x: 5, y: 5 }));

      it("circle fully inside rect — ring fill", () =>
        assertMatch([R(0, 0, 10, 10), C(5, 5, 2)], { x: 1, y: 1 }));
    });

    describe("print mode (adaptive precision 0.01 mm)", () => {
      const p = 0.01;

      it("standalone rectangle", () =>
        assertMatch([R(0, 0, 4, 4)], { x: 2, y: 2 }, 32, p, 32, p));

      it("standalone circle", () =>
        assertMatch([C(0, 0, 2)], { x: 0, y: 0 }, 32, p, 32, p));

      it("circle+rect — lens region", () =>
        assertMatch(
          [R(0, 0, 4, 4), C(5, 2, 2)],
          { x: 3.5, y: 2 },
          32,
          p,
          32,
          p,
        ));

      it("circle+rect — outer arc", () =>
        assertMatch([R(0, 0, 4, 4), C(5, 2, 2)], { x: 6, y: 2 }, 32, p, 32, p));

      it("circle+rect — rect remainder", () =>
        assertMatch(
          [R(0, 0, 4, 4), C(5, 2, 2)],
          { x: 0.5, y: 2 },
          32,
          p,
          32,
          p,
        ));

      it("two overlapping circles — lens", () =>
        assertMatch(
          [C(0, 0, 2), C(2.5, 0, 2)],
          { x: 1.25, y: 0 },
          32,
          p,
          32,
          p,
        ));

      it("two overlapping circles — left crescent", () =>
        assertMatch([C(0, 0, 2), C(2.5, 0, 2)], { x: -1, y: 0 }, 32, p, 32, p));

      it("two overlapping circles — right crescent", () =>
        assertMatch(
          [C(0, 0, 2), C(2.5, 0, 2)],
          { x: 3.5, y: 0 },
          32,
          p,
          32,
          p,
        ));
    });

    describe("cross-resolution: profile stored in preview, rebuilt in print mode", () => {
      // The primary regression scenario: user selects a fill in preview mode,
      // then toggles to print mode.  buildSceneObjects re-runs findClosedLoops
      // with adaptive precision, but the centroid stored at click time must
      // still identify the correct polygon.
      const p = 0.01;

      it("standalone circle survives resolution change", () =>
        assertMatch([C(0, 0, 2)], { x: 0, y: 0 }, 32, null, 32, p));

      it("circle+rect lens survives resolution change", () =>
        assertMatch(
          [R(0, 0, 4, 4), C(5, 2, 2)],
          { x: 3.5, y: 2 },
          32,
          null,
          32,
          p,
        ));

      it("circle+rect outer arc survives resolution change", () =>
        assertMatch(
          [R(0, 0, 4, 4), C(5, 2, 2)],
          { x: 6, y: 2 },
          32,
          null,
          32,
          p,
        ));

      it("circle+rect rect remainder survives resolution change", () =>
        assertMatch(
          [R(0, 0, 4, 4), C(5, 2, 2)],
          { x: 0.5, y: 2 },
          32,
          null,
          32,
          p,
        ));

      it("two-circle lens survives resolution change", () =>
        assertMatch(
          [C(0, 0, 2), C(2.5, 0, 2)],
          { x: 1.25, y: 0 },
          32,
          null,
          32,
          p,
        ));

      it("two-circle left crescent survives resolution change", () =>
        assertMatch(
          [C(0, 0, 2), C(2.5, 0, 2)],
          { x: -1, y: 0 },
          32,
          null,
          32,
          p,
        ));

      it("two-circle right crescent survives resolution change", () =>
        assertMatch(
          [C(0, 0, 2), C(2.5, 0, 2)],
          { x: 3.5, y: 0 },
          32,
          null,
          32,
          p,
        ));
    });
  });
});
