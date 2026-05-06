import { describe, it, expect, vi } from "vitest";
import {
  findClosedLoopsWithShapes,
  polyContainsPoint,
  polyArea,
  groupLoopsWithHoles,
} from "../sceneObjects.js";

// ── Minimal THREE.js mock (same as sketchRegions) ─────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Simulate hover: returns the smallest-area fill that contains the point but
// is not inside any of its holes.
function findHoverFill(fills, point) {
  let best = null;
  for (const f of fills) {
    if (
      polyContainsPoint(f.polygon2D, point) &&
      !f.holes2D.some((h) => polyContainsPoint(h, point))
    ) {
      const fOrder = f.renderOrder ?? 0,
        bOrder = best ? (best.renderOrder ?? 0) : -1;
      const fArea = polyArea(f.polygon2D),
        bArea = best ? polyArea(best.polygon2D) : Infinity;
      if (!best || fOrder > bOrder || (fOrder === bOrder && fArea < bArea))
        best = f;
    }
  }
  return best;
}

// Build fill descriptors from shapes (mirrors buildSketchShapesGroup logic).
function buildFillDescriptors(shapes) {
  const {
    findClosedLoopsWithShapes: fw,
    polyArea: pa,
    groupLoopsWithHoles: gw,
  } = {
    findClosedLoopsWithShapes,
    polyArea,
    groupLoopsWithHoles,
  };
  const loopsWithShapes = fw(shapes);
  const polygons = loopsWithShapes.map((l) => l.polygon);
  const polyShapeMap = new Map(
    loopsWithShapes.map((l) => [l.polygon, l.shapeIndices]),
  );
  const grouped = gw(polygons);
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

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });
const R = (x1, y1, x2, y2) => ({ type: "rect", x1, y1, x2, y2 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("intersecting sketch shapes produce correct hover regions", () => {
  // ── Circle fully inside rectangle ─────────────────────────────────────────
  // (Non-intersecting: existing behaviour must be preserved.)

  describe("circle fully inside rectangle (no boundary crossing)", () => {
    // Rect (0,0)→(10,10), circle at (5,5) r=2 — circle never touches rect boundary.
    function rectWithInnerCircle() {
      return [R(0, 0, 10, 10), C(5, 5, 2)];
    }

    it("circle creates its own region (standalone loop)", () => {
      const loops = findClosedLoopsWithShapes(rectWithInnerCircle());
      const circleLoop = loops.find((l) => l.shapeIndices.includes(1));
      expect(circleLoop).toBeDefined();
      expect(circleLoop.polygon).toHaveLength(32); // 32-point direct loop
    });

    it("hover inside circle → circle region", () => {
      const fills = buildFillDescriptors(rectWithInnerCircle());
      const hit = findHoverFill(fills, { x: 5, y: 5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // circle
      expect(hit.shapeIndices).not.toContain(0); // not rect boundary
    });

    it("hover in rect outside circle → rect region", () => {
      const fills = buildFillDescriptors(rectWithInnerCircle());
      const hit = findHoverFill(fills, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // rect boundary
    });
  });

  // ── Circle overlapping one side of a square ───────────────────────────────
  // Circle centre is outside the square; the circle crosses one side, creating:
  //   – an overlap "bite" region inside the square,
  //   – the rest of the circle outside the square.

  describe("circle overlapping one side of a square", () => {
    // Square (0,0)→(4,4), circle centred at (5,2) r=2.
    // Circle intersects the right side (x=4) at approximately y=0.27 and y=3.73.
    function squareCircleOneSide() {
      return [R(0, 0, 4, 4), C(5, 2, 2)];
    }

    it("intersection points on the right side produce arc sub-regions", () => {
      const loops = findClosedLoopsWithShapes(squareCircleOneSide());
      const intersectLoops = loops.filter(
        (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
      );
      expect(intersectLoops.length).toBeGreaterThan(0);
    });

    it("the overlap region (inside both) is a separate, smaller fill", () => {
      const fills = buildFillDescriptors(squareCircleOneSide());
      // Find any fill whose boundary references both shapes (the overlap region)
      const overlapFills = fills.filter(
        (f) => f.shapeIndices.includes(0) && f.shapeIndices.includes(1),
      );
      expect(overlapFills.length).toBeGreaterThan(0);
    });

    it("hover in the overlap area → overlap region (smallest area) returned", () => {
      const fills = buildFillDescriptors(squareCircleOneSide());
      // (3.5, 2) is to the right, inside the square, and inside the circle
      const hit = findHoverFill(fills, { x: 3.5, y: 2 });
      expect(hit).not.toBeNull();
      // Both shapes' boundaries define this fill
      expect(hit.shapeIndices).toContain(0); // rect/square boundary
      expect(hit.shapeIndices).toContain(1); // circle boundary
    });

    it("hover in the square well away from the circle → square region", () => {
      const fills = buildFillDescriptors(squareCircleOneSide());
      // (0.5, 0.5) is far from the circle (centre (5,2) r=2)
      const hit = findHoverFill(fills, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // square
    });

    it("hover outside the square but inside the circle → circle-outside-square fill", () => {
      const fills = buildFillDescriptors(squareCircleOneSide());
      // (5, 2) is the circle centre — outside the square (x=5 > 4), inside the circle
      const hit = findHoverFill(fills, { x: 5, y: 2 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // circle boundary
    });

    it("hover outside both → null", () => {
      const fills = buildFillDescriptors(squareCircleOneSide());
      expect(findHoverFill(fills, { x: 8, y: 8 })).toBeNull();
    });
  });

  // ── Circle overlapping a rectangle on two sides ───────────────────────────
  // Circle centre is inside the rectangle; circle extends outside on two sides.
  // Regions: "ring" (rect minus the circle exit areas), "exit arc" regions, "inner arc" region.

  describe("circle inside rectangle but extending beyond two sides", () => {
    // Rect (0,0)→(4,4), circle centre (3.5,3.5) r=1.5.
    // Intersects right side at (4, ~2.08) and top side at (~2.08, 4).
    function rectWithLargeCircle() {
      return [R(0, 0, 4, 4), C(3.5, 3.5, 1.5)];
    }

    it("intersection sub-regions are created referencing both shapes", () => {
      const loops = findClosedLoopsWithShapes(rectWithLargeCircle());
      const intersectLoops = loops.filter(
        (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
      );
      expect(intersectLoops.length).toBeGreaterThan(0);
    });

    it("hover at circle centre (inside rect, inside circle) → overlap fill", () => {
      const fills = buildFillDescriptors(rectWithLargeCircle());
      // (3.5,3.5) is the circle centre, inside the rect and deep inside the circle
      const hit = findHoverFill(fills, { x: 3.5, y: 3.5 });
      expect(hit).not.toBeNull();
    });

    it("hover in rect area far from circle → rect-only fill", () => {
      const fills = buildFillDescriptors(rectWithLargeCircle());
      // (0.5, 0.5) is in the bottom-left corner, far from the circle
      const hit = findHoverFill(fills, { x: 0.5, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0);
    });

    it("hover outside rect but inside circle → circle-outside-rect fill", () => {
      const fills = buildFillDescriptors(rectWithLargeCircle());
      // (4.5, 3.5) is outside the rect (x>4) but inside the circle
      const hit = findHoverFill(fills, { x: 4.5, y: 3.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // circle
    });

    it("overlap region is smaller than the full rect region", () => {
      const fills = buildFillDescriptors(rectWithLargeCircle());
      const rectFills = fills.filter((f) => polyArea(f.polygon2D) > 10);
      const smallFills = fills.filter(
        (f) => polyArea(f.polygon2D) < 5 && f.shapeIndices.includes(1),
      );
      expect(rectFills.length).toBeGreaterThan(0);
      expect(smallFills.length).toBeGreaterThan(0);
    });
  });

  // ── Two overlapping circles ───────────────────────────────────────────────
  // Three regions: left-only, overlap lens, right-only.

  describe("two overlapping circles", () => {
    // Circle A: centre (0,0) r=2, Circle B: centre (2.5,0) r=2.
    // They intersect at 2 points (roughly at y ≈ ±1.5).
    function twoCircles() {
      return [C(0, 0, 2), C(2.5, 0, 2)];
    }

    it("intersection creates loops referencing both circles", () => {
      const loops = findClosedLoopsWithShapes(twoCircles());
      const bothLoops = loops.filter(
        (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
      );
      expect(bothLoops.length).toBeGreaterThan(0);
    });

    it("hover in left-only region → circle A fill", () => {
      const fills = buildFillDescriptors(twoCircles());
      // (-1, 0) is inside circle A but outside circle B
      const hit = findHoverFill(fills, { x: -1, y: 0 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0); // circle A
    });

    it("hover in right-only region → circle B fill", () => {
      const fills = buildFillDescriptors(twoCircles());
      // (3.5, 0) is outside circle A but inside circle B
      const hit = findHoverFill(fills, { x: 3.5, y: 0 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(1); // circle B
    });

    it("hover in overlap lens → lens fill (references both circles)", () => {
      const fills = buildFillDescriptors(twoCircles());
      // (1.2, 0) is inside both circles (near the midpoint of their centres)
      const hit = findHoverFill(fills, { x: 1.2, y: 0 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(0);
      expect(hit.shapeIndices).toContain(1);
    });

    it("the overlap lens is smaller than either circle-only region", () => {
      const fills = buildFillDescriptors(twoCircles());
      const lensHit = findHoverFill(fills, { x: 1.2, y: 0 });
      const circleAHit = findHoverFill(fills, { x: -1, y: 0 });
      const circleBHit = findHoverFill(fills, { x: 3.5, y: 0 });
      expect(polyArea(lensHit.polygon2D)).toBeLessThan(
        polyArea(circleAHit.polygon2D),
      );
      expect(polyArea(lensHit.polygon2D)).toBeLessThan(
        polyArea(circleBHit.polygon2D),
      );
    });

    it("hover outside both circles → null", () => {
      const fills = buildFillDescriptors(twoCircles());
      expect(findHoverFill(fills, { x: -3, y: 0 })).toBeNull();
      expect(findHoverFill(fills, { x: 5.5, y: 0 })).toBeNull();
    });
  });

  // ── Circle overlapping a bisected rectangle ───────────────────────────────
  // Rectangle + diagonal + circle that intersects the diagonal and the rect boundary.
  // This is the fully general case combining all three previous scenarios.

  describe("circle overlapping a rectangle that is bisected by a diagonal", () => {
    // Square (0,0)→(4,4) + diagonal BL→TR + circle at (3,0.5) r=0.6.
    // Circle is in the lower-right triangle and intersects the right side of the square.
    function squareDiagCircle() {
      return [
        L(0, 4, 4, 4),
        L(4, 4, 4, 0),
        L(4, 0, 0, 0),
        L(0, 0, 0, 4), // square sides: 0-3
        L(0, 0, 4, 4), // 4: diagonal
        C(3, 0.5, 0.8), // 5: circle in lower-right, centre inside triangle, but r=0.8 may cross right side
      ];
    }

    it("creates regions that reference the circle boundary", () => {
      const loops = findClosedLoopsWithShapes(squareDiagCircle());
      const circleLoops = loops.filter((l) => l.shapeIndices.includes(5));
      expect(circleLoops.length).toBeGreaterThan(0);
    });

    it("there is a fill for the circle sub-region", () => {
      const fills = buildFillDescriptors(squareDiagCircle());
      const circleFills = fills.filter((f) => f.shapeIndices.includes(5));
      expect(circleFills.length).toBeGreaterThan(0);
    });

    it("hover inside the circle → fill involving circle returned", () => {
      const fills = buildFillDescriptors(squareDiagCircle());
      // (3, 0.5) is the circle centre
      const hit = findHoverFill(fills, { x: 3, y: 0.5 });
      expect(hit).not.toBeNull();
      expect(hit.shapeIndices).toContain(5);
    });

    it("hover in lower-right triangle well outside circle → fill not the circle sub-region", () => {
      const fills = buildFillDescriptors(squareDiagCircle());
      const circleFills = fills.filter((f) => f.shapeIndices.includes(5));
      const minCircleArea = Math.min(
        ...circleFills.map((f) => polyArea(f.polygon2D)),
      );
      // (0.5, 0) is at the bottom-left, far from the circle
      const hit = findHoverFill(fills, { x: 0.5, y: 0.05 });
      if (hit) expect(polyArea(hit.polygon2D)).toBeGreaterThan(minCircleArea);
    });

    it("hover in upper-left triangle → fill referencing the upper-left triangle boundary", () => {
      const fills = buildFillDescriptors(squareDiagCircle());
      // (0.5, 3) is in the upper-left triangle, far from both circle and diagonal
      const hit = findHoverFill(fills, { x: 0.5, y: 3 });
      expect(hit).not.toBeNull();
      // Must not be the circle
      expect(hit.shapeIndices).not.toContain(5);
    });
  });
});

// ── Curve resolution ────────────────────────────────────────────────────────

describe("curve resolution toggle", () => {
  const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });
  const R = (x1, y1, x2, y2) => ({ type: "rect", x1, y1, x2, y2 });
  const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

  // ── Preview (32) vs print (128) segment counts ───────────────────────────

  it("standalone circle: preview resolution uses 32 polygon points", () => {
    const loops = findClosedLoopsWithShapes([C(0, 0, 5)], 32);
    const circleLoop = loops.find((l) => l.shapeIndices.includes(0));
    expect(circleLoop).toBeDefined();
    expect(circleLoop.polygon).toHaveLength(32);
  });

  it("standalone circle: print resolution uses 128 polygon points", () => {
    const loops = findClosedLoopsWithShapes([C(0, 0, 5)], 128);
    const circleLoop = loops.find((l) => l.shapeIndices.includes(0));
    expect(circleLoop).toBeDefined();
    expect(circleLoop.polygon).toHaveLength(128);
  });

  it("print resolution has strictly more points than preview", () => {
    const previewLoops = findClosedLoopsWithShapes([C(0, 0, 5)], 32);
    const printLoops = findClosedLoopsWithShapes([C(0, 0, 5)], 128);
    const previewPts = previewLoops.find((l) => l.shapeIndices.includes(0))
      .polygon.length;
    const printPts = printLoops.find((l) => l.shapeIndices.includes(0)).polygon
      .length;
    expect(printPts).toBeGreaterThan(previewPts);
  });

  it("circle area is more accurately approximated at print resolution", () => {
    // A polygon with more points is a better approximation of a disk.
    const r = 5;
    const trueArea = Math.PI * r * r;
    const previewPoly = findClosedLoopsWithShapes([C(0, 0, r)], 32)[0].polygon;
    const printPoly = findClosedLoopsWithShapes([C(0, 0, r)], 128)[0].polygon;
    const previewErr = Math.abs(polyArea(previewPoly) - trueArea);
    const printErr = Math.abs(polyArea(printPoly) - trueArea);
    expect(printErr).toBeLessThan(previewErr);
  });

  it("arc segments in a split circle also increase with resolution", () => {
    // A circle split by a rectangle intersection creates arc sub-regions.
    // Higher resolution should produce longer arc polygons.
    const shapes = [R(0, 0, 4, 4), C(5, 2, 2)]; // circle crosses right side
    const previewLoops = findClosedLoopsWithShapes(shapes, 32);
    const printLoops = findClosedLoopsWithShapes(shapes, 128);

    // The lens region (inside both) exists at both resolutions.
    const previewLens = previewLoops.find(
      (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
    );
    const printLens = printLoops.find(
      (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
    );
    expect(previewLens).toBeDefined();
    expect(printLens).toBeDefined();
    expect(printLens.polygon.length).toBeGreaterThan(
      previewLens.polygon.length,
    );
  });

  it("resolution does not affect topological structure (same loop count)", () => {
    // Changing resolution should not alter which loops exist, only their
    // vertex count.  Both resolutions must produce the same number of loops.
    const shapes = [R(0, 0, 4, 4), C(5, 2, 2)];
    const previewLoops = findClosedLoopsWithShapes(shapes, 32);
    const printLoops = findClosedLoopsWithShapes(shapes, 128);
    expect(printLoops.length).toBe(previewLoops.length);
  });

  it("two-circle intersection topology is preserved across resolutions", () => {
    const shapes = [C(0, 0, 2), C(2.5, 0, 2)];
    const previewLoops = findClosedLoopsWithShapes(shapes, 32);
    const printLoops = findClosedLoopsWithShapes(shapes, 128);
    expect(printLoops.length).toBe(previewLoops.length);
    // Every loop that references both circles at preview must also exist at print.
    const previewBoth = previewLoops.filter(
      (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
    ).length;
    const printBoth = printLoops.filter(
      (l) => l.shapeIndices.includes(0) && l.shapeIndices.includes(1),
    ).length;
    expect(printBoth).toBe(previewBoth);
  });

  it("preview resolution is backwards-compatible (same as omitting the argument)", () => {
    const shapes = [C(0, 0, 3), R(0, 0, 5, 5)];
    const explicit = findClosedLoopsWithShapes(shapes, 32);
    const implicit = findClosedLoopsWithShapes(shapes); // default = 32
    expect(explicit.length).toBe(implicit.length);
    explicit.forEach((loop, i) => {
      expect(loop.polygon.length).toBe(implicit[i].polygon.length);
    });
  });
});
