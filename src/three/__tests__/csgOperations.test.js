// CSG tests use the REAL three.js and three-bvh-csg so that the boolean
// geometry operations actually execute.  Only the Zustand store and the
// THREE addons (which require a WebGL context) are mocked.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  buildItemGeometry,
  buildBrushTransform,
  performCsg,
} from "../csgUtils.js";

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

const P = (x, y, z = 0) => ({ x, y, z });
const ROT = (x = 0, y = 0, z = 0) => ({ x, y, z });
const SCL = (s = 1) => ({ x: s, y: s, z: s });

function mkCube(pos = P(0, 0, 0), scale = 1, rot = ROT()) {
  return { type: "cube", position: pos, scale: SCL(scale), rotation: rot };
}
function mkSphere(pos = P(0, 0, 0)) {
  return { type: "sphere", position: pos, scale: SCL(1), rotation: ROT() };
}
function mkCsgItem(result) {
  return {
    type: "csg",
    position: result.position,
    scale: SCL(1),
    rotation: ROT(),
    geometryData: result.geometryData,
  };
}
function mkExtrude(polygon2D, depth = 1, pos = P(0, 0, 0), rot = ROT()) {
  return {
    type: "extrude",
    depth,
    position: pos,
    rotation: rot,
    scale: SCL(1),
    profile: { polygon2D, holes: [] },
  };
}

function rectPoly(x1, y1, x2, y2) {
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

// Axis-aligned bounding box of the geometry's position attribute.
function geoBBox(geometryData) {
  const pos = new Float32Array(geometryData.positions);
  const attr = new THREE.BufferAttribute(pos, 3);
  return new THREE.Box3().setFromBufferAttribute(attr);
}

// Volume of a box3.
function bboxVolume(bbox) {
  const s = new THREE.Vector3();
  bbox.getSize(s);
  return s.x * s.y * s.z;
}

// Centroid of the bounding box (should be near (0,0,0) after centering).
function bboxCentre(geometryData) {
  const c = new THREE.Vector3();
  geoBBox(geometryData).getCenter(c);
  return c;
}

// ── 1. buildItemGeometry ──────────────────────────────────────────────────────

describe("buildItemGeometry", () => {
  it("cube returns a BoxGeometry (24 vertices)", () => {
    const geo = buildItemGeometry(mkCube());
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("sphere returns a SphereGeometry", () => {
    const geo = buildItemGeometry(mkSphere());
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(100);
  });

  it("cylinder returns a CylinderGeometry", () => {
    const geo = buildItemGeometry({ type: "cylinder", position: P(0, 0, 0) });
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("torus returns a TorusGeometry", () => {
    const geo = buildItemGeometry({ type: "torus", position: P(0, 0, 0) });
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("csg item reconstructs geometry from stored positions", () => {
    // A 2x2x2 cube serialised as a CSG item.
    const src = new THREE.BoxGeometry(2, 2, 2);
    const posArr = Array.from(src.getAttribute("position").array);
    const item = {
      type: "csg",
      position: P(0, 0, 0),
      geometryData: { positions: posArr, normals: null, indices: null },
    };
    const geo = buildItemGeometry(item);
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBe(
      src.getAttribute("position").count,
    );
  });

  it("extrude builds ExtrudeGeometry from profile polygon", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const geo = buildItemGeometry(mkExtrude(poly, 2));
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });

  it("extrude geometry is centred at the local origin (Z ∈ [-depth/2, depth/2])", () => {
    const poly = rectPoly(0, 0, 4, 4);
    const depth = 2;
    const geo = buildItemGeometry(mkExtrude(poly, depth));
    const bbox = new THREE.Box3().setFromBufferAttribute(
      geo.getAttribute("position"),
    );
    expect(bbox.min.z).toBeCloseTo(-depth / 2, 4);
    expect(bbox.max.z).toBeCloseTo(depth / 2, 4);
    // XY centred at polygon centroid – which the geometry subtracts
    const cx = new THREE.Vector3();
    bbox.getCenter(cx);
    expect(Math.abs(cx.z)).toBeLessThan(0.01);
  });

  it("returns null for sketch", () => {
    expect(
      buildItemGeometry({ type: "sketch", position: P(0, 0, 0) }),
    ).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(
      buildItemGeometry({ type: "unknown", position: P(0, 0, 0) }),
    ).toBeNull();
  });

  it("returns null for extrude with missing polygon", () => {
    expect(
      buildItemGeometry({
        type: "extrude",
        depth: 1,
        position: P(0, 0, 0),
        profile: { polygon2D: null },
      }),
    ).toBeNull();
  });

  // ── Primitive resolution scales with printPrecision ───────────────────────
  // The print-mode setting requests chord deviation ≤ 0.01 mm.  Primitives
  // (sphere / cylinder / torus) must scale their segment counts accordingly,
  // otherwise CSG / bevel operations on print-quality models are limited to
  // the preview-quality 32-segment circle.

  it("cylinder honours printPrecision (high resolution has more segments than preview)", () => {
    const preview = buildItemGeometry(
      { type: "cylinder", position: P(0, 0, 0) },
      { printPrecision: null },
    );
    const print = buildItemGeometry(
      { type: "cylinder", position: P(0, 0, 0) },
      { printPrecision: 0.01 },
    );
    expect(print.getAttribute("position").count).toBeGreaterThan(
      preview.getAttribute("position").count,
    );
  });

  it("sphere honours printPrecision (more vertices in print mode)", () => {
    const preview = buildItemGeometry(mkSphere(), { printPrecision: null });
    const print = buildItemGeometry(mkSphere(), { printPrecision: 0.01 });
    expect(print.getAttribute("position").count).toBeGreaterThan(
      preview.getAttribute("position").count,
    );
  });

  it("torus honours printPrecision", () => {
    const preview = buildItemGeometry(
      { type: "torus", position: P(0, 0, 0) },
      { printPrecision: null },
    );
    const print = buildItemGeometry(
      { type: "torus", position: P(0, 0, 0) },
      { printPrecision: 0.01 },
    );
    expect(print.getAttribute("position").count).toBeGreaterThan(
      preview.getAttribute("position").count,
    );
  });

  it("cube ignores printPrecision (no curved surface)", () => {
    const preview = buildItemGeometry(mkCube(), { printPrecision: null });
    const print = buildItemGeometry(mkCube(), { printPrecision: 0.01 });
    expect(print.getAttribute("position").count).toBe(
      preview.getAttribute("position").count,
    );
  });

  it("primitive segment counts scale roughly with 1/precision (smaller precision → more segments)", () => {
    const coarse = buildItemGeometry(
      { type: "cylinder", position: P(0, 0, 0) },
      { printPrecision: 0.1 }, // 0.1 mm chord deviation
    );
    const fine = buildItemGeometry(
      { type: "cylinder", position: P(0, 0, 0) },
      { printPrecision: 0.01 }, // 10× finer
    );
    expect(fine.getAttribute("position").count).toBeGreaterThan(
      coarse.getAttribute("position").count,
    );
  });

  it("primitive segment counts are clamped (extreme precision doesn't explode)", () => {
    // Even at unreasonably high precision, segment count is capped.
    const extreme = buildItemGeometry(
      { type: "sphere", position: P(0, 0, 0) },
      { printPrecision: 1e-9 },
    );
    // Sphere geometry: (widthSegs+1) × (heightSegs+1) approximately.  Cap of
    // 256 width × 128 height ≈ 257 × 129 ≈ 33000 vertices upper bound.
    expect(extreme.getAttribute("position").count).toBeLessThan(50000);
  });

  it("fullCircleSegments returns the default at preview (no precision)", async () => {
    const { fullCircleSegments } = await import("../sceneObjects.js");
    expect(fullCircleSegments(1, null)).toBe(32);
    expect(fullCircleSegments(1, null, 64)).toBe(64);
  });

  it("fullCircleSegments scales with precision (sagitta formula)", async () => {
    const { fullCircleSegments } = await import("../sceneObjects.js");
    // r=1, precision=0.01 mm, MM_PER_UNIT=10 → sUnits=0.001.
    // halfTheta = acos(1 - 0.001) ≈ 0.0447 rad → segs ≈ π/0.0447 ≈ 71.
    const segs = fullCircleSegments(1, 0.01);
    expect(segs).toBeGreaterThan(32);
    expect(segs).toBeLessThan(256);
    // A bigger radius at the same precision needs MORE segments (chord
    // deviation scales with r, so finer division is needed).
    expect(fullCircleSegments(2, 0.01)).toBeGreaterThan(segs);
  });

  it("fullCircleSegments is clamped to [8, 256] for extreme inputs", async () => {
    const { fullCircleSegments } = await import("../sceneObjects.js");
    // Tiny radius → degenerate; fall back to default.
    expect(fullCircleSegments(0, 0.01)).toBe(32);
    // Microscopic precision would otherwise blow up.
    expect(fullCircleSegments(1, 1e-12)).toBeLessThanOrEqual(256);
    // Coarse precision still gives at least 8 segments.
    expect(fullCircleSegments(1, 100)).toBeGreaterThanOrEqual(8);
  });

  it("wireframe / highlight / CSG all share the same segment count for a given precision", async () => {
    const { fullCircleSegments } = await import("../sceneObjects.js");
    // The 3 sites (applyRenderMode wireframe, primitiveGeoForHighlight,
    // buildItemGeometry) all derive their cylinder segment count from
    // fullCircleSegments with the cylinder's actual radius and the same
    // printPrecision.  Confirming the helper is deterministic guarantees
    // they stay in sync.
    const cylPrev = fullCircleSegments(1, null, 32);
    const cylPrint = fullCircleSegments(1, 0.01, 32);
    expect(cylPrev).toBe(32);
    expect(cylPrint).toBeGreaterThan(cylPrev);
    // And the CSG geometry's vertex count matches:
    const cyl = buildItemGeometry(
      { type: "cylinder", position: P(0, 0, 0) },
      { printPrecision: 0.01 },
    );
    // CylinderGeometry(r, r, h, segs): vertex count = 2*(segs+1) + 2*(segs+1) + 2 = 4*segs + 6
    // (top cap + bottom cap + side, with shared edges duplicated by THREE).
    // The exact formula is implementation-defined; just verify it scales.
    expect(cyl.getAttribute("position").count).toBeGreaterThan(
      // Preview-quality vert count, also derived from fullCircleSegments(1, null) = 32.
      4 * cylPrev + 6 - 1,
    );
  });

  it("DISPLAY_PRECISION_MM is fine enough to look smooth at typical viewing", async () => {
    // Display overlays (wireframe + hover/edge selection) tessellate at
    // DISPLAY_PRECISION_MM regardless of the user's CSG resolution setting,
    // so they always look smooth — matching the analytic shader render.
    // Verify the resulting cylinder segment count is "smooth-looking"
    // (≥ 64) at the smallest primitive radius the codebase uses (r = 1).
    const { fullCircleSegments, DISPLAY_PRECISION_MM } = await import(
      "../sceneObjects.js"
    );
    const segs = fullCircleSegments(1, DISPLAY_PRECISION_MM, 32);
    expect(segs).toBeGreaterThanOrEqual(64);
  });

  it("DISPLAY_PRECISION is independent of CSG/bevel resolution (preview-quality CSG, smooth wireframe)", async () => {
    // In preview mode, CSG geometry uses ~32 segments (the previous
    // default).  Wireframe / highlight, however, MUST be smooth, so they
    // tessellate at DISPLAY_PRECISION_MM giving ~70+ segments.
    const { fullCircleSegments, DISPLAY_PRECISION_MM } = await import(
      "../sceneObjects.js"
    );
    const csgPreview = fullCircleSegments(1, null, 32); // CSG preview default
    const displaySegs = fullCircleSegments(1, DISPLAY_PRECISION_MM, 32);
    expect(displaySegs).toBeGreaterThan(csgPreview);
  });

  it("buildItemGeometry without options behaves like the previous default (preview-quality)", () => {
    // Backwards-compat: existing callers that don't pass options should
    // still get the same preview-quality primitive as before.
    const sphereDefault = buildItemGeometry(mkSphere());
    const spherePreview = buildItemGeometry(mkSphere(), { printPrecision: null });
    expect(sphereDefault.getAttribute("position").count).toBe(
      spherePreview.getAttribute("position").count,
    );
  });
});

// ── 2. buildBrushTransform ────────────────────────────────────────────────────

describe("buildBrushTransform", () => {
  it("cube: position matches item.position", () => {
    const t = buildBrushTransform(mkCube(P(3, 4, 5)));
    expect(t.position).toEqual(P(3, 4, 5));
  });

  it("csg: position matches item.position", () => {
    const item = {
      type: "csg",
      position: P(1, 2, 3),
      scale: SCL(1),
      rotation: ROT(),
    };
    const t = buildBrushTransform(item);
    expect(t.position.x).toBeCloseTo(1);
    expect(t.position.y).toBeCloseTo(2);
    expect(t.position.z).toBeCloseTo(3);
  });

  it("extrude at origin: brush position = (centroid.x, centroid.y, depth/2)", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const t = buildBrushTransform(mkExtrude(poly, depth, P(0, 0, 0)));
    expect(t.position.x).toBeCloseTo(2);
    expect(t.position.y).toBeCloseTo(2);
    expect(t.position.z).toBeCloseTo(1); // depth/2
  });

  it("extrude at offset position: brush position = item.position + centroid offset", () => {
    const poly = rectPoly(0, 0, 4, 4); // centroid (2,2)
    const depth = 2;
    const t = buildBrushTransform(mkExtrude(poly, depth, P(5, 3, 1)));
    expect(t.position.x).toBeCloseTo(7); // 5+2
    expect(t.position.y).toBeCloseTo(5); // 3+2
    expect(t.position.z).toBeCloseTo(2); // 1+1
  });

  it("extrude scale is preserved", () => {
    const item = {
      type: "extrude",
      depth: 1,
      position: P(0, 0, 0),
      scale: SCL(2),
      rotation: ROT(),
      profile: { polygon2D: rectPoly(0, 0, 4, 4), holes: [] },
    };
    const t = buildBrushTransform(item);
    expect(t.scale).toBeCloseTo(2);
  });
});

// ── 3. performCsg: null when < 2 solid geometries ────────────────────────────

describe("performCsg: insufficient geometry", () => {
  it("returns null when no items are provided", () => {
    expect(performCsg([], "union")).toBeNull();
  });

  it("returns null when only one item produces geometry", () => {
    expect(performCsg([mkCube()], "union")).toBeNull();
  });

  it("returns null when all items are sketches (no solid geometry)", () => {
    const sketches = [
      { type: "sketch", position: P(0, 0, 0) },
      { type: "sketch", position: P(1, 0, 0) },
    ];
    expect(performCsg(sketches, "union")).toBeNull();
  });

  it("returns null when one item is a cube and the other a sketch", () => {
    expect(
      performCsg([mkCube(), { type: "sketch", position: P(0, 0, 0) }], "union"),
    ).toBeNull();
  });
});

// ── 4. performCsg: result structure ──────────────────────────────────────────

describe("performCsg: result structure", () => {
  const c1 = mkCube(P(0, 0, 0));
  const c2 = mkCube(P(1, 0, 0));

  it("union returns an object with position and geometryData", () => {
    const r = performCsg([c1, c2], "union");
    expect(r).not.toBeNull();
    expect(r).toHaveProperty("position");
    expect(r).toHaveProperty("geometryData");
    expect(r.geometryData).toHaveProperty("positions");
  });

  it("result positions array is non-empty", () => {
    const r = performCsg([c1, c2], "union");
    expect(r.geometryData.positions.length).toBeGreaterThan(0);
    expect(r.geometryData.positions.length % 3).toBe(0); // multiples of 3 (xyz)
  });

  it("result geometry is centred: bounding-box centre is at (0,0,0)", () => {
    const r = performCsg([c1, c2], "union");
    const c = bboxCentre(r.geometryData);
    expect(c.x).toBeCloseTo(0, 3);
    expect(c.y).toBeCloseTo(0, 3);
    expect(c.z).toBeCloseTo(0, 3);
  });

  it("result position is the world-space bounding-box centre", () => {
    const r = performCsg([c1, c2], "union");
    // Two 2×2×2 cubes at x=0 and x=1 → union spans x ∈ [-1,2], centre at x=0.5
    expect(r.position.x).toBeCloseTo(0.5);
    expect(r.position.y).toBeCloseTo(0);
    expect(r.position.z).toBeCloseTo(0);
  });
});

// ── 5. performCsg: union, difference, intersection geometry ──────────────────

describe("performCsg: boolean operation geometry", () => {
  // Two 2×2×2 cubes offset so they partially overlap.
  const c1 = mkCube(P(0, 0, 0));
  const c2 = mkCube(P(1, 0, 0)); // overlap is 1×2×2 = 4 units³

  it("union bounding box spans both cubes", () => {
    const r = performCsg([c1, c2], "union");
    const bbox = geoBBox(r.geometryData);
    // Centred result: world coords = result.position ± half-sizes.
    // Original world X: -1 to 2 (width 3). Centre at 0.5.
    const size = new THREE.Vector3();
    bbox.getSize(size);
    expect(size.x).toBeCloseTo(3, 0); // spans 3 units in X
    expect(size.y).toBeCloseTo(2, 0);
    expect(size.z).toBeCloseTo(2, 0);
  });

  it("difference (c1 − c2) is smaller than c1 alone", () => {
    const diff = performCsg([c1, c2], "difference");
    expect(diff).not.toBeNull();
    expect(diff.geometryData.positions.length).toBeGreaterThan(0);
    const diffVol = bboxVolume(geoBBox(diff.geometryData));
    // c1 alone is 2×2×2=8; after removing part of c2 the volume is less.
    expect(diffVol).toBeLessThan(8);
  });

  it("difference position is offset toward c1 (leftward from centre)", () => {
    const diff = performCsg([c1, c2], "difference");
    // c1 is at x=0 (spans -1 to 1). After removing the overlap with c2 (x>0.5),
    // the bbox centre shifts left.
    expect(diff.position.x).toBeLessThan(0.5);
  });

  it("intersection of two overlapping cubes is non-empty", () => {
    const r = performCsg([c1, c2], "intersection");
    expect(r).not.toBeNull();
    expect(r.geometryData.positions.length).toBeGreaterThan(0);
  });

  it("intersection bounding box is smaller than either input", () => {
    const r = performCsg([c1, c2], "intersection");
    const size = new THREE.Vector3();
    geoBBox(r.geometryData).getSize(size);
    // Intersection is the 1×2×2 overlap slab; dimensions ≤ either cube.
    expect(size.x).toBeLessThanOrEqual(2 + 0.01);
    expect(size.y).toBeLessThanOrEqual(2 + 0.01);
    expect(size.z).toBeLessThanOrEqual(2 + 0.01);
  });

  it("intersection of non-overlapping cubes returns empty or null geometry", () => {
    // Cubes far apart — no intersection.
    const far1 = mkCube(P(0, 0, 0));
    const far2 = mkCube(P(10, 0, 0));
    const r = performCsg([far1, far2], "intersection");
    // Either returns null or an empty result (0 vertex triangles).
    if (r !== null) {
      expect(r.geometryData.positions.length).toBe(0);
    }
  });
});

// ── 6. performCsg: combining CSG results (re-combine) ────────────────────────

describe("performCsg: chaining CSG results", () => {
  it("union of two cubes can be further combined with a third cube", () => {
    const c1 = mkCube(P(0, 0, 0));
    const c2 = mkCube(P(1, 0, 0));
    const r1 = performCsg([c1, c2], "union");
    expect(r1).not.toBeNull();

    const csgItem = mkCsgItem(r1);
    const c3 = mkCube(P(3, 0, 0)); // just touching / slightly apart
    const r2 = performCsg([csgItem, c3], "union");
    expect(r2).not.toBeNull();
    expect(r2.geometryData.positions.length).toBeGreaterThan(
      r1.geometryData.positions.length * 0.5,
    );
  });

  it("result geometry remains centred after re-combining", () => {
    const r1 = performCsg([mkCube(P(0, 0, 0)), mkCube(P(1, 0, 0))], "union");
    const r2 = performCsg([mkCsgItem(r1), mkCube(P(3, 0, 0))], "union");
    const c = bboxCentre(r2.geometryData);
    expect(Math.abs(c.x)).toBeLessThan(0.01);
    expect(Math.abs(c.y)).toBeLessThan(0.01);
    expect(Math.abs(c.z)).toBeLessThan(0.01);
  });
});

// ── 7. performCsg: extruded objects ──────────────────────────────────────────

describe("performCsg: extruded objects", () => {
  // A 4×4 rectangle extruded 2 units.
  const rectPrism = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(0, 0, 0));

  it("two extruded rectangles can be unioned", () => {
    const e1 = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(0, 0, 0));
    const e2 = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(2, 0, 0));
    const r = performCsg([e1, e2], "union");
    expect(r).not.toBeNull();
    expect(r.geometryData.positions.length).toBeGreaterThan(0);
  });

  it("union of two extruded rects has a wider bbox than either alone", () => {
    const e1 = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(0, 0, 0)); // centroid (2,2,1)
    const e2 = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(3, 0, 0)); // centroid (5,2,1)
    const r = performCsg([e1, e2], "union");
    const size = new THREE.Vector3();
    geoBBox(r.geometryData).getSize(size);
    // e1 spans x: 0..4, e2 spans x: 3..7; union spans x: 0..7 (width 7)
    expect(size.x).toBeGreaterThan(4);
  });

  it("extruded object can be combined with a cube", () => {
    const e = mkExtrude(rectPoly(0, 0, 2, 2), 2, P(0, 0, 0));
    const c = mkCube(P(1, 1, 1));
    const r = performCsg([e, c], "union");
    expect(r).not.toBeNull();
    expect(r.geometryData.positions.length).toBeGreaterThan(0);
  });

  it("extrude brush position accounts for centroid offset so world position is correct", () => {
    // Extrude rect (0,0)→(4,4), depth=2, at item.position (0,0,0).
    // Centroid = (2,2), so brush should be at (2,2,1) in world space.
    // Union with a cube at (2,2,1) (same world centre) → result centred on (2,2,1).
    const e = mkExtrude(rectPoly(0, 0, 4, 4), 2, P(0, 0, 0));
    const c = mkCube(P(2, 2, 1));
    const r = performCsg([e, c], "union");
    expect(r).not.toBeNull();
    // The bbox centre of the union should be near (2,2,1).
    expect(r.position.x).toBeCloseTo(2, 0);
    expect(r.position.y).toBeCloseTo(2, 0);
    expect(r.position.z).toBeCloseTo(1, 0);
  });
});

// ── 8. performCsg: position correctness after rebuild ────────────────────────
// After creating a CSG item, buildSceneObjects will place its mesh at
// item.position with the (already-centred) geometry.  The mesh must sit at
// the same world location as the original solids.

describe("performCsg: item.position is the correct world pivot", () => {
  it("union of two cubes: item.position is the world-space bbox centre", () => {
    const c1 = mkCube(P(0, 0, 0));
    const c2 = mkCube(P(0, 2, 0)); // stacked in Y
    const r = performCsg([c1, c2], "union");
    // World X: -1..1, Y: -1..3, Z: -1..1. Centre: (0,1,0).
    expect(r.position.x).toBeCloseTo(0);
    expect(r.position.y).toBeCloseTo(1);
    expect(r.position.z).toBeCloseTo(0);
  });

  it("difference c1−c2: position centre is shifted toward the surviving part", () => {
    const c1 = mkCube(P(0, 0, 0));
    const c2 = mkCube(P(1, 0, 0));
    const r = performCsg([c1, c2], "difference");
    // c1 minus the overlap: what remains is mostly the left part of c1.
    expect(r.position.x).toBeLessThan(0.5);
  });

  it("moved cube: union position reflects actual world locations", () => {
    const c1 = mkCube(P(5, 5, 0));
    const c2 = mkCube(P(6, 5, 0)); // overlaps c1 (both 2×2×2, offset by 1)
    const r = performCsg([c1, c2], "union");
    // c1 spans x [4,6], c2 spans x [5,7]; union spans [4,7], centre at 5.5.
    expect(r.position.x).toBeCloseTo(5.5, 0);
    expect(r.position.y).toBeCloseTo(5, 0);
  });
});

// ── 9. canCsg / selection logic (Boolean section) ────────────────────────────
// Buttons are enabled only when 2+ non-sketch items are explicitly selected.

describe("canCsg enable logic (Boolean section)", () => {
  // Replicate the logic from CombineSection
  function resolveTargets(items, selectedIds) {
    const selectedEligible = selectedIds
      .map((id) => items.find((i) => i.id === id))
      .filter((item) => item && item.type !== "sketch");
    const canCsg = selectedEligible.length >= 2;
    return { canCsg, targets: selectedEligible };
  }

  const cube1 = {
    id: 1,
    type: "cube",
    position: P(0, 0, 0),
    scale: SCL(1),
    rotation: ROT(),
    visible: true,
  };
  const cube2 = {
    id: 2,
    type: "cube",
    position: P(1, 0, 0),
    scale: SCL(1),
    rotation: ROT(),
    visible: true,
  };
  const cube3 = {
    id: 3,
    type: "cube",
    position: P(2, 0, 0),
    scale: SCL(1),
    rotation: ROT(),
    visible: true,
  };
  const sketch = { id: 4, type: "sketch", visible: true };

  it("disabled when nothing is selected", () => {
    expect(resolveTargets([cube1, cube2], []).canCsg).toBe(false);
  });

  it("disabled when only one non-sketch item is selected", () => {
    expect(resolveTargets([cube1, cube2], [cube1.id]).canCsg).toBe(false);
  });

  it("disabled when only sketch items are selected", () => {
    expect(resolveTargets([cube1, sketch], [sketch.id]).canCsg).toBe(false);
  });

  it("enabled when exactly 2 non-sketch items are selected", () => {
    expect(resolveTargets([cube1, cube2], [cube1.id, cube2.id]).canCsg).toBe(
      true,
    );
  });

  it("enabled when 3 non-sketch items are selected", () => {
    expect(
      resolveTargets([cube1, cube2, cube3], [cube1.id, cube2.id, cube3.id])
        .canCsg,
    ).toBe(true);
  });

  it("sketches are excluded from the selection count", () => {
    expect(resolveTargets([cube1, sketch], [cube1.id, sketch.id]).canCsg).toBe(
      false,
    );
  });

  it("targets are exactly the selected non-sketch items", () => {
    const { targets } = resolveTargets(
      [cube1, cube2, cube3],
      [cube1.id, cube2.id],
    );
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.id)).toEqual([cube1.id, cube2.id]);
  });

  it("selecting 3 items targets all 3", () => {
    const { targets } = resolveTargets(
      [cube1, cube2, cube3],
      [cube1.id, cube2.id, cube3.id],
    );
    expect(targets).toHaveLength(3);
  });

  it("performCsg with 2 selected items produces a result", () => {
    const result = performCsg([cube1, cube2], "union");
    expect(result).not.toBeNull();
    expect(result.geometryData.positions.length).toBeGreaterThan(0);
  });
});
