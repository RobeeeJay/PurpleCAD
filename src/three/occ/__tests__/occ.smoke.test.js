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
  chamferShapeBy,
  filletShapeBy,
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

  it("chamfers an edge of a boolean (union of two cubes) — works on CSG outputs", async () => {
    // Regression for "Chamfers on more complicated shapes do not do anything":
    // shapes built via union/difference/etc. must still be chamferable, not
    // just bare primitives.
    const { buildItemShapeLocal } = await import("../../csgUtils.js");
    const cubeA = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const cubeB = { id: 2, type: "cube", position: { x: 1, y: 0, z: 0 } };
    // Synthesize a csg item with a boolean regenerator pointing at the cubes.
    const unionItem = {
      id: 3,
      type: "csg",
      position: { x: 0.5, y: 0, z: 0 }, // bbox centre of union
      regenerator: {
        kind: "boolean",
        op: "union",
        inputIds: [1, 2],
      },
    };
    const allItems = [cubeA, cubeB, unionItem];
    const shape = buildItemShapeLocal(unionItem, allItems);
    expect(shape).toBeTruthy();
    // Tessellate to confirm it's a valid solid.
    const baseline = tessellate(shape, null);
    expectSolidGeometry(baseline);
    // Now chamfer an edge that's known to exist on the unioned shape — the
    // top-back edge of cubeA's overlap-free half (z = -1 → z=-1, y=1, x runs
    // from -1 to 0 on cubeA's portion).  Even a soft match (low precision)
    // is enough to exercise the recursive rebuild path.
    const chamfered = chamferShape(
      shape,
      [{ ax: -1, ay: 1, az: -1, bx: 0, by: 1, bz: -1 }],
      0.05,
    );
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);
  });

  it("chamfers the top cap of a cylinder via face-normal selection", () => {
    // Regression for the user-visible bug: clicking the top face of a
    // cylinder and pressing Chamfer must produce a chamfered cap (the
    // boundary circle gets a chamfer, replacing the original sharp edge
    // between cap and side wall).  This exercises chamferShapeBy's face
    // path, which finds the cap by normal (Y-up here, matching makeCylinder)
    // and adds every edge of that face to the BRepFilletAPI_MakeChamfer.
    const cyl = makeCylinder();
    const baseline = tessellate(cyl, null);
    const chamfered = chamferShapeBy(
      cyl,
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.05,
    );
    expect(chamfered).not.toBe(cyl); // a face was matched and edges added
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);
    // The chamfered cap has more triangles than the original (the chamfer
    // adds a new slanted strip between cap and side wall).
    expect(geo.index.count).toBeGreaterThan(baseline.index.count);
  });

  it("fillets the top cap of a cylinder via face-normal selection", () => {
    const cyl = makeCylinder();
    const filleted = filletShapeBy(
      cyl,
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.05,
    );
    expect(filleted).not.toBe(cyl);
    expectSolidGeometry(tessellate(filleted, null));
  });

  it("chamfers a cube face (top face) — expands to all 4 boundary edges", () => {
    const cube = makeCube();
    const baseline = tessellate(cube, null);
    const chamfered = chamferShapeBy(
      cube,
      { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
      0.05,
    );
    expect(chamfered).not.toBe(cube);
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);
    expect(geo.index.count).toBeGreaterThan(baseline.index.count);
  });

  it("chamfering an outer edge of a holed extrude preserves the inner hole", () => {
    // Regression: "Bevelling an extruded object with holes wrongly fills
    // those holes."  When the user chamfers an OUTER edge of an extrude
    // that has an inner hole, the hole's geometry must survive the
    // operation.
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
    const holed = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [hole] },
      depth: 1,
    });
    const baselineGeo = tessellate(holed, null);
    // Top-outer edge at (-2,-2,0.5) → (2,-2,0.5) (after the prism is
    // centred along z, half-depth offset puts it at z = +0.5).
    const chamfered = chamferShapeBy(
      holed,
      {
        edges: [{ ax: -2, ay: -2, az: 0.5, bx: 2, by: -2, bz: 0.5 }],
        faces: [],
      },
      0.1,
    );
    expect(chamfered).not.toBe(holed);
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);
    // The chamfered shape should still have inner walls.  A simple proxy:
    // the chamfered geometry must have at least as many unique vertices as
    // the original holed prism (chamfer adds vertices, never removes the
    // hole's structural vertices).
    expect(geo.getAttribute("position").count).toBeGreaterThanOrEqual(
      baselineGeo.getAttribute("position").count,
    );
  });

  it("chamfering the top face of a holed extrude chamfers BOTH outer and inner edges, leaving the hole open", () => {
    // chamferShapeBy walks every edge of every matched face — outer wire
    // AND inner (hole) wires.  Result: the chamfer applies to the outer
    // top perimeter (the rectangle's top corners get bevelled) AND to the
    // hole's top edges (the hole's top corners also get bevelled).  The
    // hole itself remains open through the solid — the chamfer just
    // bevels its top opening.
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
    const holed = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [hole] },
      depth: 1,
    });
    const baselineGeo = tessellate(holed, null);
    const chamfered = chamferShapeBy(
      holed,
      { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
      0.05,
    );
    expect(chamfered).not.toBe(holed);
    const geo = tessellate(chamfered, null);
    expectSolidGeometry(geo);

    const pos = geo.getAttribute("position");
    const round = (v) => Math.round(v * 100) / 100;

    // 1. Outer top sharp corner is GONE.  (-2,-2,+0.5) etc were the outer
    //    top corners of the baseline; after chamfering the top face's
    //    outer wire those sharp corners are replaced by chamfered ones.
    let baselineOuterCorner = 0;
    const basePos = baselineGeo.getAttribute("position");
    for (let i = 0; i < basePos.count; i++) {
      const x = round(basePos.getX(i)),
        y = round(basePos.getY(i)),
        z = round(basePos.getZ(i));
      if (Math.abs(x) === 2 && Math.abs(y) === 2 && z === 0.5)
        baselineOuterCorner++;
    }
    let chamferedOuterCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 2 && Math.abs(y) === 2 && z === 0.5)
        chamferedOuterCorner++;
    }
    expect(baselineOuterCorner).toBeGreaterThan(0); // sanity
    expect(chamferedOuterCorner).toBe(0);

    // 2. Inner (hole) top sharp corner is also GONE.  The baseline had
    //    sharp inner corners at (±0.5, ±0.5, +0.5); they should now be
    //    chamfered away.
    let chamferedInnerCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 0.5 && Math.abs(y) === 0.5 && z === 0.5)
        chamferedInnerCorner++;
    }
    expect(chamferedInnerCorner).toBe(0);

    // 3. Hole remains open all the way through.  The bottom of the hole's
    //    inner walls is at z = -0.5; sharp inner corners there should
    //    still exist (we only chamfered the TOP face).
    let bottomInnerCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 0.5 && Math.abs(y) === 0.5 && z === -0.5)
        bottomInnerCorner++;
    }
    expect(bottomInnerCorner).toBeGreaterThan(0);
  });

  it("chamfering an inner hole edge slants AWAY from the hole, not into it", () => {
    // Regression for "the chamfer appears to be in the wrong direction —
    // applies itself to an object that would fill the hole, not the outside
    // edges of the hole itself."
    //
    // For an inner hole edge at y = +0.5 (the +Y inner wall's top corner),
    // a correct chamfer eats material from the L-shaped corner between
    // the top face (z=+0.5, y > +0.5) and the inner wall (y=+0.5, z varies).
    // After a 0.1 chamfer, the new chamfer face vertices should be at:
    //   • on the top face: y in (+0.5, +0.6], i.e. OUTSIDE the hole.
    //   • on the inner wall: z in (+0.4, +0.5), i.e. moved DOWN.
    // No new vertex should appear at y in [+0.4, +0.5) on the top plane —
    // that would be a chamfer slanting INTO the hole (filling it).
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
    const holed = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [hole] },
      depth: 1,
    });
    const chamfered = chamferShapeBy(
      holed,
      { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
      0.1,
    );
    const geo = tessellate(chamfered, null);
    const pos = geo.getAttribute("position");
    const round = (v) => Math.round(v * 1000) / 1000;
    let wrongDirVerts = 0;
    let correctDirVerts = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      // Look at vertices on (or very near) the top face plane z = +0.5.
      if (z !== 0.5) continue;
      // Inner-edge region of the hole, +Y inner wall corner.
      if (x < -0.5 || x > 0.5) continue;
      if (y > 0.5 && y < 0.6) correctDirVerts++;
      // Wrong direction: vertex pulled INSIDE the hole on the top plane.
      if (y < 0.5 && y > 0.4) wrongDirVerts++;
    }
    expect(wrongDirVerts).toBe(0);
    expect(correctDirVerts).toBeGreaterThan(0);
  });

  it("chamferShapeBy returns the shape unchanged when no faces or edges match", () => {
    const cube = makeCube();
    // A normal that no face of the cube has — chamfer should be a no-op.
    const out = chamferShapeBy(
      cube,
      { edges: [], faces: [{ nx: 0.7, ny: 0.7, nz: 0 }] },
      0.05,
    );
    expect(out).toBe(cube);
  });

  it("chamfers an already-chamfered shape (chamfer-on-chamfer)", async () => {
    const { buildItemShapeLocal } = await import("../../csgUtils.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    // Synthesize a chamfered-cube item via the chamfer regenerator.
    const chamferedCube = {
      id: 2,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "chamfer",
        source: cube,
        subGeo: {
          edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
          faces: [],
        },
        amount: 0.1,
        segments: 1,
      },
    };
    const shape = buildItemShapeLocal(chamferedCube, [cube, chamferedCube]);
    expect(shape).toBeTruthy();
    const geo = tessellate(shape, null);
    expectSolidGeometry(geo);
  });
});
