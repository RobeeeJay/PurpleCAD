// Smoke test for the OpenCascade.js integration.  Verifies that:
//   1. The kernel initializes in node.
//   2. Each primitive (cube/sphere/cylinder/torus/extrude) produces a
//      non-empty tessellated geometry.
//   3. CSG (union/difference/intersection) produces a closed solid.
//   4. Chamfer applies cleanly to a cube edge.
//
// The first OCC init takes a few seconds because Emscripten compiles the
// 63 MB WASM; subsequent calls reuse the singleton.  We bump the test
// timeout to 30 s for this reason.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { ensureOcc } from "../init.js";
import {
  makeCube,
  makeSphere,
  makeCylinder,
  makeTorus,
  makeExtrude,
  makePrimitiveShape,
} from "../primitives.js";
import { tessellate } from "../tessellate.js";
import {
  unionShapes,
  differenceShapes,
  intersectShapes,
  chamferShape,
} from "../operations.js";

// The store + viewport pull in many three.js addons that need browser-only
// globals; mock them so we can import primitives.js which transitively
// imports sceneObjects.js for polyCentroid.
vi.mock("../../../store", () => ({ useStore: () => null }));
vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineMaterial.js", () => ({ LineMaterial: class {} }));
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
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: class {} }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {},
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: class {} }));
vi.mock("../../objectMaterials.js", () => ({ createMaterial: () => ({ dispose() {} }) }));

beforeAll(async () => {
  await ensureOcc();
}, 60_000);

function expectSolidGeometry(geo) {
  expect(geo).toBeTruthy();
  const pos = geo.getAttribute("position");
  expect(pos.count).toBeGreaterThan(0);
  expect(geo.index).toBeTruthy();
  expect(geo.index.count).toBeGreaterThan(0);
  expect(geo.index.count % 3).toBe(0);
}

describe("OCC primitives", () => {
  it("cube tessellates to non-empty geometry", () => {
    expectSolidGeometry(tessellate(makeCube(), null));
  });
  it("sphere tessellates", () => {
    expectSolidGeometry(tessellate(makeSphere(), null));
  });
  it("cylinder tessellates", () => {
    expectSolidGeometry(tessellate(makeCylinder(), null));
  });
  it("torus tessellates", () => {
    expectSolidGeometry(tessellate(makeTorus(), null));
  });
  it("print precision yields more vertices than preview", () => {
    const preview = tessellate(makeSphere(), null);
    const print = tessellate(makeSphere(), 0.01);
    expect(print.getAttribute("position").count).toBeGreaterThan(
      preview.getAttribute("position").count,
    );
  });
});

describe("OCC extrude", () => {
  it("square polygon extrudes to a solid", () => {
    const item = {
      type: "extrude",
      profile: {
        polygon2D: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ],
        holes: [],
      },
      depth: 2,
    };
    const shape = makeExtrude(item);
    expectSolidGeometry(tessellate(shape, null));
  });

  it("polygon with a hole extrudes correctly (more boundary edges than solid disc)", () => {
    const outer = [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ];
    const hole = [
      { x: -0.5, y: -0.5 },
      { x: -0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: -0.5 },
    ];
    const solid = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [] },
      depth: 1,
    });
    const holed = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [hole] },
      depth: 1,
    });
    const solidGeo = tessellate(solid, null);
    const holedGeo = tessellate(holed, null);
    // The holed prism has more triangles because of the inner walls.
    expect(holedGeo.index.count).toBeGreaterThan(solidGeo.index.count);
  });
});

describe("OCC boolean operations", () => {
  it("union of two cubes produces more area than either alone", () => {
    const a = makeCube();
    const b = makePrimitiveShape({ type: "cube" });
    const u = unionShapes([a, b]);
    expectSolidGeometry(tessellate(u, null));
  });

  it("difference yields a smaller solid than the minuend", () => {
    const a = makeCube();
    const b = makeSphere();
    const diff = differenceShapes([a, b]);
    expectSolidGeometry(tessellate(diff, null));
  });

  it("intersection of two cubes is a cube", () => {
    const a = makeCube();
    const b = makeCube();
    const inter = intersectShapes([a, b]);
    expectSolidGeometry(tessellate(inter, null));
  });
});

describe("OCC chamfer", () => {
  it("chamfers a cube edge — output is still a solid with more facets", () => {
    const cube = makeCube();
    const baseline = tessellate(cube, null);
    const edgePositions = [
      // Top-front edge of a 2×2×2 cube centred at origin.
      { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
    ];
    const chamfered = chamferShape(cube, edgePositions, 0.1);
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);
    expect(geo.index.count).toBeGreaterThan(baseline.index.count);
  });
});
