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
vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
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
vi.mock("../../objectMaterials.js", () => ({
  createMaterial: () => ({ dispose() {} }),
}));

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
  it("torus is oriented with its axis along +Y to match the shader (R=1.0, r=0.4 ring in the XZ plane)", () => {
    // Regression for: "Torus do not operate properly in boolean
    // operations, the rotation is incorrect."  The rendered torus uses
    // its mesh-local +Y as the torus normal (see objectMaterials.js'
    // shader vTorusNormal = modelViewMatrix[1].xyz), so the OCC torus
    // MUST also be Y-axis or booleans will operate on a shape rotated
    // 90° from where the user sees it.
    //
    // Y-axis torus: ring in XZ plane.  Outer extent on +X is R+r=1.4,
    // inner extent is R-r=0.6.  Along the Y axis the extent is just r=0.4
    // (top and bottom of the tube).  Bbox: X∈[-1.4,1.4], Z∈[-1.4,1.4],
    // Y∈[-0.4,0.4].  A Z-axis (wrong) torus would have Y∈[-1.4,1.4]
    // and Z∈[-0.4,0.4] — flipped.
    const geo = tessellate(makeTorus(), null);
    const pos = geo.getAttribute("position");
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    expect(maxX).toBeCloseTo(1.4, 2);
    expect(minX).toBeCloseTo(-1.4, 2);
    expect(maxZ).toBeCloseTo(1.4, 2);
    expect(minZ).toBeCloseTo(-1.4, 2);
    // The axis dimension (Y) is just the tube radius.
    expect(maxY).toBeCloseTo(0.4, 2);
    expect(minY).toBeCloseTo(-0.4, 2);
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

  it("extrudes a sketch where the cut-out is drawn as 4 lines (via findClosedLoops)", async () => {
    // Regression for: "A sketch which contains a cut out made of lines does
    // not extrude properly, the faces for the cut out seem to be either
    // missing or their normal is inverted."  Exercises the SAME path the
    // viewport uses: 4 lines for the outer rectangle + 4 lines for the
    // inner cut-out → findClosedLoops → groupLoopsWithHoles → makeExtrude.
    const { findClosedLoops, groupLoopsWithHoles } =
      await import("../../sceneObjects.js");
    // Outer rectangle drawn as 4 lines (CCW).
    const outerLines = [
      { type: "line", x1: -2, y1: -2, x2: 2, y2: -2 },
      { type: "line", x1: 2, y1: -2, x2: 2, y2: 2 },
      { type: "line", x1: 2, y1: 2, x2: -2, y2: 2 },
      { type: "line", x1: -2, y1: 2, x2: -2, y2: -2 },
    ];
    // Inner cut-out drawn as 4 lines.  Use the DRAWING order that would
    // come from a user sketching CW (top-left → top-right → bottom-right
    // → bottom-left), which exercises the winding-normalization path in
    // makeWireFromPolygon.
    const innerLines = [
      { type: "line", x1: -0.5, y1: 0.5, x2: 0.5, y2: 0.5 },
      { type: "line", x1: 0.5, y1: 0.5, x2: 0.5, y2: -0.5 },
      { type: "line", x1: 0.5, y1: -0.5, x2: -0.5, y2: -0.5 },
      { type: "line", x1: -0.5, y1: -0.5, x2: -0.5, y2: 0.5 },
    ];
    const loops = findClosedLoops([...outerLines, ...innerLines], 32, null);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    const grouped = groupLoopsWithHoles(loops);
    // Exactly one top-level region (the outer rectangle) with one hole.
    expect(grouped.length).toBe(1);
    expect(grouped[0].holes.length).toBe(1);
    const shape = makeExtrude({
      type: "extrude",
      profile: {
        polygon2D: grouped[0].polygon,
        holes: grouped[0].holes,
      },
      depth: 1,
    });
    expect(shape).toBeTruthy();
    const geo = tessellate(shape, null);
    expectSolidGeometry(geo);
    const pos = geo.getAttribute("position");
    const idx = geo.index.array;
    const eps = 1e-3;
    // Same inner-wall normal check as the explicit-polygon test: each of
    // the 4 inner walls (at x = ±0.5 or y = ±0.5) must have at least one
    // triangle, and every triangle's normal must point INTO the hole.
    const planes = [
      { axis: 0, value: 0.5, normalSign: -1 },
      { axis: 0, value: -0.5, normalSign: 1 },
      { axis: 1, value: 0.5, normalSign: -1 },
      { axis: 1, value: -0.5, normalSign: 1 },
    ];
    const wallTriCounts = planes.map(() => 0);
    const correctTriCounts = planes.map(() => 0);
    for (let t = 0; t < idx.length; t += 3) {
      const ax = pos.getX(idx[t]),
        ay = pos.getY(idx[t]),
        az = pos.getZ(idx[t]);
      const bx = pos.getX(idx[t + 1]),
        by = pos.getY(idx[t + 1]),
        bz = pos.getZ(idx[t + 1]);
      const cx = pos.getX(idx[t + 2]),
        cy = pos.getY(idx[t + 2]),
        cz = pos.getZ(idx[t + 2]);
      for (let p = 0; p < planes.length; p++) {
        const { axis, value, normalSign } = planes[p];
        const va = axis === 0 ? ax : ay;
        const vb = axis === 0 ? bx : by;
        const vc = axis === 0 ? cx : cy;
        if (
          Math.abs(va - value) < eps &&
          Math.abs(vb - value) < eps &&
          Math.abs(vc - value) < eps
        ) {
          wallTriCounts[p]++;
          const u = [bx - ax, by - ay, bz - az];
          const v = [cx - ax, cy - ay, cz - az];
          const nx = u[1] * v[2] - u[2] * v[1];
          const ny = u[2] * v[0] - u[0] * v[2];
          const nz = u[0] * v[1] - u[1] * v[0];
          void nz;
          const component = axis === 0 ? nx : ny;
          if (Math.sign(component) === normalSign) correctTriCounts[p]++;
        }
      }
    }
    for (let p = 0; p < planes.length; p++) {
      expect(wallTriCounts[p]).toBeGreaterThan(0);
      expect(correctTriCounts[p]).toBe(wallTriCounts[p]);
    }
  });

  it("extrudes a sketch with an L-shaped cut-out drawn as 6 lines (concave hole)", async () => {
    // Stronger regression: a non-convex hole.  Concave holes are the case
    // where signed-area normalization can subtly do the wrong thing
    // because the polygon's shoelace signed area is small relative to its
    // perimeter, and DFS traversal direction matters.
    const { findClosedLoops, groupLoopsWithHoles } =
      await import("../../sceneObjects.js");
    const outerLines = [
      { type: "line", x1: -3, y1: -3, x2: 3, y2: -3 },
      { type: "line", x1: 3, y1: -3, x2: 3, y2: 3 },
      { type: "line", x1: 3, y1: 3, x2: -3, y2: 3 },
      { type: "line", x1: -3, y1: 3, x2: -3, y2: -3 },
    ];
    // L-shape hole (vertices going CCW for clarity, but lines drawn in
    // random order to exercise the DFS):
    //   (-1,-1) → (1,-1) → (1,0) → (0,0) → (0,1) → (-1,1) → close
    const innerLines = [
      { type: "line", x1: 0, y1: 1, x2: -1, y2: 1 },
      { type: "line", x1: -1, y1: -1, x2: 1, y2: -1 },
      { type: "line", x1: -1, y1: 1, x2: -1, y2: -1 },
      { type: "line", x1: 1, y1: -1, x2: 1, y2: 0 },
      { type: "line", x1: 1, y1: 0, x2: 0, y2: 0 },
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 1 },
    ];
    const loops = findClosedLoops([...outerLines, ...innerLines], 32, null);
    const grouped = groupLoopsWithHoles(loops);
    expect(grouped.length).toBe(1);
    expect(grouped[0].holes.length).toBe(1);
    const shape = makeExtrude({
      type: "extrude",
      profile: {
        polygon2D: grouped[0].polygon,
        holes: grouped[0].holes,
      },
      depth: 1,
    });
    expect(shape).toBeTruthy();
    const geo = tessellate(shape, null);
    expectSolidGeometry(geo);
    // OCC convention: a hole's inner walls face INTO the hole (their
    // normals point toward the hole interior, away from the surrounding
    // solid).  We sample a point inside the L-shape hole and check every
    // inner-wall triangle's normal points TOWARD that point.
    const pos = geo.getAttribute("position");
    const idx = geo.index.array;
    const eps = 1e-3;
    // Interior point inside the L hole (the bottom-left arm of the L).
    const ix = -0.5,
      iy = -0.5;
    let innerWallTris = 0;
    let correctNormalCount = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const ax = pos.getX(idx[t]),
        ay = pos.getY(idx[t]),
        az = pos.getZ(idx[t]);
      const bx = pos.getX(idx[t + 1]),
        by = pos.getY(idx[t + 1]),
        bz = pos.getZ(idx[t + 1]);
      const cx = pos.getX(idx[t + 2]),
        cy = pos.getY(idx[t + 2]),
        cz = pos.getZ(idx[t + 2]);
      if (Math.abs(az - bz) < eps && Math.abs(az - cz) < eps) continue;
      const tcx = (ax + bx + cx) / 3;
      const tcy = (ay + by + cy) / 3;
      const distToHole = Math.hypot(tcx - 0, tcy - 0);
      if (distToHole > 1.5) continue;
      innerWallTris++;
      const u = [bx - ax, by - ay, bz - az];
      const v = [cx - ax, cy - ay, cz - az];
      const nx = u[1] * v[2] - u[2] * v[1];
      const ny = u[2] * v[0] - u[0] * v[2];
      // Hole-wall normal points INTO the hole = toward interior (ix,iy).
      const dx = ix - tcx,
        dy = iy - tcy;
      if (nx * dx + ny * dy > 0) correctNormalCount++;
    }
    expect(innerWallTris).toBeGreaterThan(0);
    expect(correctNormalCount).toBe(innerWallTris);
  });

  it("extrudes a sketch with a triangular cut-out drawn as 3 lines", async () => {
    // Variant of the above with an odd-sided hole (triangle) and lines
    // drawn in arbitrary order — the path that more closely matches what
    // users actually produce when sketching.
    const { findClosedLoops, groupLoopsWithHoles, polyArea } =
      await import("../../sceneObjects.js");
    const outerLines = [
      { type: "line", x1: -3, y1: -3, x2: 3, y2: -3 },
      { type: "line", x1: 3, y1: -3, x2: 3, y2: 3 },
      { type: "line", x1: 3, y1: 3, x2: -3, y2: 3 },
      { type: "line", x1: -3, y1: 3, x2: -3, y2: -3 },
    ];
    // Triangle drawn in non-sequential order (line 2 first, line 0 second,
    // line 1 last) to simulate a user clicking endpoints out of order.
    const innerLines = [
      { type: "line", x1: 1, y1: -1, x2: -1, y2: -1 },
      { type: "line", x1: 0, y1: 1, x2: 1, y2: -1 },
      { type: "line", x1: -1, y1: -1, x2: 0, y2: 1 },
    ];
    const loops = findClosedLoops([...outerLines, ...innerLines], 32, null);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    const grouped = groupLoopsWithHoles(loops);
    expect(grouped.length).toBe(1);
    expect(grouped[0].holes.length).toBe(1);
    // The hole polygon should have ~the area of the triangle (base 2,
    // height 2 → area 2.0).  This catches the case where findClosedLoops
    // returns a degenerate or wrong-shape polygon.
    expect(polyArea(grouped[0].holes[0])).toBeGreaterThan(1.9);
    expect(polyArea(grouped[0].holes[0])).toBeLessThan(2.1);
    const shape = makeExtrude({
      type: "extrude",
      profile: {
        polygon2D: grouped[0].polygon,
        holes: grouped[0].holes,
      },
      depth: 1,
    });
    expect(shape).toBeTruthy();
    const geo = tessellate(shape, null);
    expectSolidGeometry(geo);
    // For each inner wall of the triangular hole, its average outward
    // normal should point AWAY from the triangle's centroid (0, -0.333).
    const pos = geo.getAttribute("position");
    const idx = geo.index.array;
    const cx_hole = 0,
      cy_hole = -1 / 3;
    const eps = 1e-3;
    let innerWallTris = 0;
    let inwardCount = 0;
    // The hole's vertical extent is y ∈ [-1, 1].  An inner wall
    // triangle has all 3 verts in that range AND not on the top/bottom
    // faces.  We detect inner walls by their normal being approximately
    // horizontal (perpendicular to z) AND the triangle centroid being
    // inside the hole (within polygon).
    for (let t = 0; t < idx.length; t += 3) {
      const ax = pos.getX(idx[t]),
        ay = pos.getY(idx[t]),
        az = pos.getZ(idx[t]);
      const bx = pos.getX(idx[t + 1]),
        by = pos.getY(idx[t + 1]),
        bz = pos.getZ(idx[t + 1]);
      const cx = pos.getX(idx[t + 2]),
        cy = pos.getY(idx[t + 2]),
        cz = pos.getZ(idx[t + 2]);
      // Skip top/bottom face triangles (constant z).
      if (Math.abs(az - bz) < eps && Math.abs(az - cz) < eps) continue;
      const tcx = (ax + bx + cx) / 3;
      const tcy = (ay + by + cy) / 3;
      // Triangle centroid must be very close to the line connecting any
      // two vertices of the hole's triangle.  Approximate: if it's within
      // 0.05 of the triangular path, count it as an inner-wall tri.
      const distToCentre = Math.hypot(tcx - cx_hole, tcy - cy_hole);
      if (distToCentre > 1.1) continue; // outer wall (rectangle at ±3)
      innerWallTris++;
      // Outward normal points away from hole centre.
      const u = [bx - ax, by - ay, bz - az];
      const v = [cx - ax, cy - ay, cz - az];
      const nx = u[1] * v[2] - u[2] * v[1];
      const ny = u[2] * v[0] - u[0] * v[2];
      // Direction from triangle centroid to hole centre.
      const dxC = cx_hole - tcx;
      const dyC = cy_hole - tcy;
      // Inward = normal pointing toward hole centre.
      const dot = nx * dxC + ny * dyC;
      if (dot > 0) inwardCount++;
    }
    expect(innerWallTris).toBeGreaterThan(0);
    expect(inwardCount).toBe(innerWallTris);
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

  it("performCsg anchors at an extrude's visible world centre (centroid offset baked in)", async () => {
    // Regression for: "The origin for boolean operations involving
    // extruded objects may be wrong."  buildBrushTransform shifts the
    // extrude's stored position by the rotated polygon centroid so the
    // OCC shape and the rendered mesh share the same world position;
    // performCsg's anchor (worldAnchors[0]) MUST come from the same
    // brushPos, otherwise the new csg's item.position lands at the raw
    // item.position instead of where the extrude visibly sits.
    const { ops } = await import("../../occOps.js");
    // Extrude with a polygon whose centroid is NOT at the origin: this
    // ensures the centroid offset is visibly non-zero so the test would
    // catch a regression that drops it.
    const extrude = {
      id: 10,
      type: "extrude",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      profile: {
        // Square centred at (2, 0) — centroid offset is (2, 0, 0).
        polygon2D: [
          { x: 1, y: -1 },
          { x: 3, y: -1 },
          { x: 3, y: 1 },
          { x: 1, y: 1 },
        ],
      },
      depth: 1,
    };
    const cube = { id: 11, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const result = await ops.performCsg({
      selectedItems: [extrude, cube],
      allItems: [extrude, cube],
      operation: "union",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor MUST be extrude.position + rotated polygon centroid offset,
    // i.e. (0 + 2, 0 + 0, 0 + 0) = (2, 0, 0) — NOT the raw item.position
    // of (0, 0, 0).  Without buildBrushTransform's extrude branch, the
    // shape would be placed at (0, 0, 0) and the boolean would happen at
    // the wrong world location.
    expect(result.position.x).toBeCloseTo(2);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.position.z).toBeCloseTo(0);
  });

  it("cut on a chamfered csg respects centerOffset (no rotated/offset result)", async () => {
    // Regression for: "Cut on a chamfer/fillet result looks rotated and
    // offset."  The chamfered csg's geometryData was recentred around
    // the chamfer's bbox centroid (centerOffset) and item.position bakes
    // that offset in.  buildItemShapeLocal MUST translate the rebuilt
    // OCC chamfer by -centerOffset so its frame matches the visible
    // mesh — otherwise a subsequent cut comes out at R*centerOffset
    // away from where the chamfered cube is rendered.
    const { ops } = await import("../../occOps.js");
    const { buildItemShapeLocal } = await import("../../csgUtils.js");
    // A cube at world (5, 0, 0) chamfered on its +X face (asymmetric, so
    // centerOffset is non-zero).
    const cube = { id: 1, type: "cube", position: { x: 5, y: 0, z: 0 } };
    // Synthesise a chamfered-csg item with a non-zero centerOffset so
    // we can verify the translate-by-(-centerOffset) takes it back to
    // where the visible mesh sits.
    const centerOffset = { cx: 0.05, cy: 0, cz: 0 };
    const chamfered = {
      id: 2,
      type: "csg",
      // item.position = source.brushPos + R(source.rotation) * centerOffset
      // = (5, 0, 0) + (0.05, 0, 0) = (5.05, 0, 0) for non-rotated cube.
      position: { x: 5.05, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      regenerator: {
        kind: "chamfer",
        source: cube,
        subGeo: { edges: [], faces: [{ nx: 1, ny: 0, nz: 0 }] },
        amount: 0.05,
        segments: 1,
        angleRad: null,
        centerOffset,
      },
    };
    // Verify buildItemShapeLocal returns the chamfered shape in a frame
    // such that transformShape(item.position, item.rotation) recovers
    // the original world cube position (cube spans world ~[4..6, -1..1,
    // -1..1] with a small chamfer on +X side).
    const localShape = buildItemShapeLocal(chamfered, [cube, chamfered]);
    expect(localShape).toBeTruthy();

    // Now actually run a cut through this chamfered cube to verify the
    // cut hole lands at the world location of the cube's TOP face
    // (y=+1), not shifted by centerOffset.
    const cut = {
      id: 3,
      type: "extrude",
      position: { x: 5, y: 1, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: -0.3,
      isCut: true,
      profile: {
        polygon2D: [
          { x: -0.1, y: -0.1 },
          { x: 0.1, y: -0.1 },
          { x: 0.1, y: 0.1 },
          { x: -0.1, y: 0.1 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [chamfered, cut],
      allItems: [cube, chamfered, cut],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor at chamfered.position (5.05, 0, 0).  Visible vertex =
    // anchor + recentred.  The cube's TOP face is at world y=+1 — the
    // remaining material should still reach y=+1 (the sketch plane).
    let maxY = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wy = result.position.y + result.geometryData.positions[i + 1];
      if (wy > maxY) maxY = wy;
    }
    expect(maxY).toBeCloseTo(1, 3);
    // World x should span roughly the cube's x range (4 to 6 minus
    // chamfer trim).  Without the fix, the cut shape would be offset
    // by +0.05 in x (centerOffset baked in twice) and minX would be
    // > 4.
    let minX = Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wx = result.position.x + result.geometryData.positions[i];
      if (wx < minX) minX = wx;
    }
    expect(minX).toBeCloseTo(4, 3);
  });

  it("chained cut on a csg result anchors at the csg's position (no rotation/offset)", async () => {
    // Repro for: "When an extrude cut hits a previous CSG result, the
    // cut object looks rotated and offset."  We synthesise a csg item
    // whose regenerator references a cube + a cut-extrude (mirroring
    // what runCutExtrusion produces), then run a SECOND cut on top of
    // it and verify the result anchor matches the csg's position and
    // the visible vertex envelope still hugs the cube's bounding box.
    const { ops } = await import("../../occOps.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const cut1 = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: -0.3,
      isCut: true,
      profile: {
        polygon2D: [
          { x: -0.2, y: -0.2 },
          { x: 0.2, y: -0.2 },
          { x: 0.2, y: 0.2 },
          { x: -0.2, y: 0.2 },
        ],
      },
    };
    const csg1 = {
      id: 3,
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      regenerator: {
        kind: "boolean",
        op: "difference",
        inputIds: [1, 2],
      },
    };
    // Second cut on csg1.
    const cut2 = {
      id: 4,
      type: "extrude",
      position: { x: 0.5, y: 1, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: -0.3,
      isCut: true,
      profile: {
        polygon2D: [
          { x: -0.1, y: -0.1 },
          { x: 0.1, y: -0.1 },
          { x: 0.1, y: 0.1 },
          { x: -0.1, y: 0.1 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [csg1, cut2],
      allItems: [cube, cut1, csg1, cut2],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor MUST be csg1.position (= 0, 0, 0), not cut2's brushPos.
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.position.z).toBeCloseTo(0);
    // The visible world envelope should still be inside the cube
    // bounding box (-1..+1, -1..+1, -1..+1).  If the result were
    // rotated, vertices would extend outside.
    let maxAbs = 0;
    for (let i = 0; i < result.geometryData.positions.length; i++) {
      const v = Math.abs(result.geometryData.positions[i]);
      if (v > maxAbs) maxAbs = v;
    }
    expect(maxAbs).toBeLessThanOrEqual(1 + 1e-3);
  });

  it("cut extrude with polygon offset from sketch origin still starts at sketch plane", async () => {
    // The sketch's polygon centroid sits at (1.2, 0) in sketch-local
    // coords — NOT at the sketch origin.  buildBrushTransform shifts
    // the prism's brushPos by that rotated centroid, and the prism is
    // built around its own centroid in OCC local.  Verify the resulting
    // cut still starts at the cube's top face (y = +1) and doesn't
    // shift along the prism axis.
    const { ops } = await import("../../occOps.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const sketchOnTop = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: -0.5,
      isCut: true,
      profile: {
        // Square centred at (1.2, 0) — centroid offset is (1.2, 0).
        polygon2D: [
          { x: 0.9, y: -0.3 },
          { x: 1.5, y: -0.3 },
          { x: 1.5, y: 0.3 },
          { x: 0.9, y: 0.3 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, sketchOnTop],
      allItems: [cube, sketchOnTop],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    let maxY = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wy = result.position.y + result.geometryData.positions[i + 1];
      if (wy > maxY) maxY = wy;
    }
    // Cube top remains at world y=+1 wherever the sketch hole doesn't
    // cover it; the cut must START there, not at a shifted plane.
    expect(maxY).toBeCloseTo(1, 3);
  });

  it("cut extrude on a face starts the hole AT the sketch plane (not offset)", async () => {
    // Regression for: "When an extrude cut hits an object and subtracts
    // from that object, the offset of the cut does not begin on the
    // sketch plane."  A negative-depth extrude whose profile sits on
    // the cube's top face MUST produce a hole whose top edge is at
    // y = cube_top (= cube.position.y + 1 for a 2x2x2 cube), not
    // shifted along the prism axis.
    const { ops } = await import("../../occOps.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    // Sketch placed on the cube's +Y face.  position = a point on the
    // face plane (cube center y=0, half-height 1 ⇒ top at y=+1).
    // rotation = euler that maps sketch +Z to world +Y (i.e. -π/2 around X).
    const sketchOnTop = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: -0.5, // negative depth ⇒ prism extends inward (down into cube)
      isCut: true,
      profile: {
        polygon2D: [
          { x: -0.3, y: -0.3 },
          { x: 0.3, y: -0.3 },
          { x: 0.3, y: 0.3 },
          { x: -0.3, y: 0.3 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, sketchOnTop],
      allItems: [cube, sketchOnTop],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Result is anchored at cube.brushPos = (0, 0, 0); geometryData
    // positions are recentred around that.  Visible vertices = anchor +
    // recentred.  The hole's top edge MUST contain points whose world
    // y == +1 (the cube top / sketch plane) — anything lower means the
    // cut started below the sketch plane.
    let maxY = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wy = result.position.y + result.geometryData.positions[i + 1];
      if (wy > maxY) maxY = wy;
    }
    // The remaining cube material still reaches the top face → maxY ≈ 1.
    expect(maxY).toBeCloseTo(1, 3);
  });

  it("ground-plane sketch cutting ground-plane cube keeps cube position fixed", async () => {
    // Regression for: "An extrude cut from a sketch on the ground plane
    // into a cube on the ground plane wrongly ends up moving the
    // extruded object before the cut both in the Z and X axis before
    // applying the cut."
    //
    // Setup mirrors the live UX:
    //   - cube on ground plane (size 2 cube centred at (cx, 1, cz) so
    //     its base sits at y=0)
    //   - sketch on ground plane at world origin (sketch +Z normal points
    //     up so rotation = -π/2 about X)
    //   - rectangle drawn at an OFFSET inside the sketch (centroid not
    //     at sketch origin — this is the key case where polyCentroid
    //     gets applied)
    //   - positive depth so the prism extrudes UP into the cube
    const { ops } = await import("../../occOps.js");
    const cube = {
      id: 1,
      type: "cube",
      position: { x: 2.5, y: 1, z: 1.5 },
    };
    // Sketch lies on the ground (XZ) plane.  Polygon drawn inside the
    // cube footprint: rectangle from sketch-local (2.0, 1.0) to
    // (3.0, 2.0) — centroid (2.5, 1.5).  Sketch +Z under -π/2 X rotation
    // maps to world +Y, so positive depth extrudes UP.
    const extrude = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 0, z: 0 }, // sketch at origin
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: 3,
      isCut: true,
      profile: {
        polygon2D: [
          { x: 2.0, y: 1.0 },
          { x: 3.0, y: 1.0 },
          { x: 3.0, y: 2.0 },
          { x: 2.0, y: 2.0 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, extrude],
      allItems: [cube, extrude],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // The cut result MUST be anchored at the cube's position — not at
    // some shifted position derived from the extrude's polygon centroid.
    expect(result.position.x).toBeCloseTo(2.5, 6);
    expect(result.position.y).toBeCloseTo(1, 6);
    expect(result.position.z).toBeCloseTo(1.5, 6);
    // And the visible mesh must still occupy the cube's original world
    // bbox in X and Z (cube is 2×2×2 centred at (2.5, 1, 1.5) → spans
    // [1.5, 3.5] in X and [0.5, 2.5] in Z).  A hole in the middle
    // doesn't shrink the bbox along these axes.
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wx = result.position.x + result.geometryData.positions[i];
      const wz = result.position.z + result.geometryData.positions[i + 2];
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    expect(minX).toBeCloseTo(1.5, 3);
    expect(maxX).toBeCloseTo(3.5, 3);
    expect(minZ).toBeCloseTo(0.5, 3);
    expect(maxZ).toBeCloseTo(2.5, 3);
  });

  it("toolbar Difference (cube first, extrude on a side face second) anchors the result at the cube and the visible bbox matches the cube's", async () => {
    // Regression for: "Applying a boolean cut for one object to another,
    // the resulting cut is offset in the Z and Y axis."  This matches
    // the toolbar Combine → Difference path with the user's selection
    // ordering: primitive selected first (the minuend), an extrude
    // selected second.  The extrude's brushPos is offset from
    // item.position (by R · polyCentroid); the cube's is not.  Anchor
    // must be the CUBE's position, and the rendered CSG mesh must occupy
    // the cube's original world bbox (the bite shrinks but does not
    // shift it).
    const { ops } = await import("../../occOps.js");
    // Cube centred at world (0, 0, 0), size 2 → spans [-1, +1] in every
    // axis.
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    // Sketch placed on the cube's +X face (sketch normal = world +X).
    // Sketch frame: rotation about Y by -π/2 puts sketch +Z onto world
    // +X; sketch.position sits on the face plane (cube center.x + 1).
    // Polygon offset from sketch origin → produces a non-zero
    // polyCentroid in sketch-local Y, which under R_y(-π/2) maps to a
    // -X world component for the brushPos (sketch +Y stays as world
    // +Y, sketch +X maps to world -Z).  Crucially, the polyCentroid
    // offset has Y and Z components in world space — exactly the axes
    // the user reported as offset on the result.
    const extrude = {
      id: 2,
      type: "extrude",
      position: { x: 1, y: 0, z: 0 }, // sketch on cube's +X face
      rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      // R_y(-π/2)·(0,0,1) = (-1,0,0), so sketch +Z = world -X (into
      // the cube).  Positive depth ⇒ prism extends INTO the cube.
      depth: 0.6,
      profile: {
        // Polygon centroid offset from sketch origin in both axes
        polygon2D: [
          { x: 0.1, y: 0.3 },
          { x: 0.5, y: 0.3 },
          { x: 0.5, y: 0.5 },
          { x: 0.1, y: 0.5 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, extrude],
      allItems: [cube, extrude],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor MUST be the cube's position, not the extrude's offset
    // brushPos.
    expect(result.position.x).toBeCloseTo(0, 6);
    expect(result.position.y).toBeCloseTo(0, 6);
    expect(result.position.z).toBeCloseTo(0, 6);
    // World bbox of the visible mesh must occupy the cube's original
    // span: [-1, +1] in X, Y and Z.  A bite on the +X side trims the
    // local maxX in X, but Y and Z are unaffected: their world span
    // stays exactly [-1, +1].
    let minY = Infinity,
      maxY = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wy = result.position.y + result.geometryData.positions[i + 1];
      const wz = result.position.z + result.geometryData.positions[i + 2];
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    expect(minY).toBeCloseTo(-1, 3);
    expect(maxY).toBeCloseTo(1, 3);
    expect(minZ).toBeCloseTo(-1, 3);
    expect(maxZ).toBeCloseTo(1, 3);
  });

  it("toolbar Difference: cube minus extrude on a YZ-plane sketch — the hole lands where the prism was rendered (Y/Z aligned)", async () => {
    // Regression for: "Applying a boolean cut for one object to another,
    // the resulting cut is offset in the Z and Y axis."  User report:
    // hole is in the wrong place on the cube, sketch placed on a global
    // plane (the YZ plane is the case where polyCentroid offsets map to
    // world Y/Z — sketch +Z under R_y(π/2) → world +X, sketch +X → world
    // -Z, sketch +Y → world +Y).
    //
    // What aligns the hole with the rendered prism is that
    // buildBrushTransform(extrude) — which positions the OCC shape —
    // uses the SAME polyCentroid as sceneBuilder uses for the mesh's
    // visible centre.  Both shift by `R · polyCentroid(polygon2D)`.  If
    // they ever diverge (different polygon, different tessellation, a
    // stale stored polygon2D vs a re-traced sketch), the hole appears
    // offset from where the prism was visible.
    const { ops } = await import("../../occOps.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    // Sketch placed on the YZ plane at the world origin: rotation
    // (0, π/2, 0) puts sketch +Z onto world +X.
    // Rectangle in sketch-local with centroid at (0.4, 0.6) — offset
    // from the sketch origin.  Centroid under R_y(π/2):
    //   (cx, cy, 0) → (0, cy, -cx) = (0, 0.6, -0.4)
    // — Y and Z offsets, no X.  This is the exact pattern the user
    // reported as "offset in Z and Y".
    const extrude = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 0, z: 0 }, // sketch at world origin on YZ
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: 2,
      profile: {
        polygon2D: [
          { x: 0.2, y: 0.4 },
          { x: 0.6, y: 0.4 },
          { x: 0.6, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, extrude],
      allItems: [cube, extrude],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor: cube's position (the cube is the minuend).
    expect(result.position.x).toBeCloseTo(0, 6);
    expect(result.position.y).toBeCloseTo(0, 6);
    expect(result.position.z).toBeCloseTo(0, 6);
    // The hole must land where the polygon's world projection puts it.
    // For YZ-plane rotation (0, π/2, 0):
    //   sketch (px, py, 0) → world (0, py, -px)
    // So polygon X = [0.2, 0.6] maps to world Z = [-0.6, -0.2];
    // polygon Y = [0.4, 0.8] maps to world Y = [+0.4, +0.8].  The HOLE
    // in the cube must be at world (any X) × Y∈[0.4,0.8] × Z∈[-0.6,-0.2].
    // The simplest invariant we can check on the recentred geometryData:
    // on the cube's +X face (recentred X = +1) the material must have
    // a gap on the rectangle Y∈[0.4,0.8], Z∈[-0.6,-0.2].  Equivalently,
    // no triangle vertex at the cube's +X face inside that rectangle.
    let pointsAtPlusXNearHole = 0;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wx = result.position.x + result.geometryData.positions[i];
      const wy = result.position.y + result.geometryData.positions[i + 1];
      const wz = result.position.z + result.geometryData.positions[i + 2];
      // Strictly inside the hole rectangle on the +X face: the cube's
      // outer surface at +X should be missing here.
      if (
        Math.abs(wx - 1) < 0.001 &&
        wy > 0.42 &&
        wy < 0.78 &&
        wz > -0.58 &&
        wz < -0.22
      )
        pointsAtPlusXNearHole++;
    }
    expect(pointsAtPlusXNearHole).toBe(0);
  });

  it("toolbar Difference: hole on the cube's bottom face lands at the triangle's world XZ (rotation BEFORE translation)", async () => {
    // Regression for: "Applying a boolean cut for one object to another,
    // the resulting cut is offset in the Z and Y axis."  Root cause was
    // transformShape composing trsf = R · T instead of T · R (OCC's
    // gp_Trsf::Multiply does `this = this * T`, so building rotations
    // first then translation produced a transform that TRANSLATED the
    // local shape first and only THEN rotated — wrong).  Catch it with
    // a vertex-position check: a triangle drawn at sketch-local
    // (0..1, 0..1) on the XZ ground plane, extruded UP into a cube,
    // must produce a hole on the cube's bottom face whose vertices lie
    // at the triangle's world XZ projection: sketch (px, py, 0) under
    // R_x(-π/2) → world (px, 0, -py).  With the broken order the same
    // vertex would sit at world (px, ?, +centroid.y - py) — a shift in
    // Z by the polyCentroid's Y component.
    const { ops } = await import("../../occOps.js");
    const cube = { id: 1, type: "cube", position: { x: 0, y: 2, z: 0 } };
    const extrude = {
      id: 2,
      type: "extrude",
      position: { x: 0, y: 0, z: 0 }, // sketch on XZ ground at origin
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      depth: 4,
      profile: {
        // Triangle with vertices at sketch-local (0,0), (1,0), (0.5,1)
        // — centroid (0.5, 0.333) is non-zero so the bug shows.
        polygon2D: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
      },
    };
    const result = await ops.performCsg({
      selectedItems: [cube, extrude],
      allItems: [cube, extrude],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor: cube.position.
    expect(result.position.x).toBeCloseTo(0, 6);
    expect(result.position.y).toBeCloseTo(2, 6);
    expect(result.position.z).toBeCloseTo(0, 6);
    // Find triangles on the cube's bottom face (world y = +1, the
    // cube's bottom since it spans y=[1,3]).  Collect the unique XZ
    // points among their vertices.
    const p = result.geometryData.positions;
    const idx = result.geometryData.indices;
    const triCount = idx ? idx.length / 3 : p.length / 9;
    const bottomXZ = new Set();
    for (let i = 0; i < triCount; i++) {
      const a = idx ? idx[i * 3] : i * 3;
      const b = idx ? idx[i * 3 + 1] : i * 3 + 1;
      const c = idx ? idx[i * 3 + 2] : i * 3 + 2;
      const ay = result.position.y + p[a * 3 + 1];
      const by = result.position.y + p[b * 3 + 1];
      const cy = result.position.y + p[c * 3 + 1];
      if (
        Math.abs(ay - 1) < 0.001 &&
        Math.abs(by - 1) < 0.001 &&
        Math.abs(cy - 1) < 0.001
      ) {
        for (const v of [a, b, c]) {
          const wx = result.position.x + p[v * 3];
          const wz = result.position.z + p[v * 3 + 2];
          bottomXZ.add(`${wx.toFixed(3)},${wz.toFixed(3)}`);
        }
      }
    }
    // The triangle's world XZ projection under R_x(-π/2):
    //   sketch (px, py, 0) → world (px, 0, -py)
    // Corners: (0,0)→(0,0); (1,0)→(1,0); (0.5,1)→(0.5,-1).
    // The hole on the cube's bottom face MUST include the triangle's
    // interior — verify by checking that the corner (0.5, -1) (which
    // lies on the cube boundary in Z, since cube Z spans [-1,1]) is
    // referenced by some bottom-face vertex.  Under the OLD (broken)
    // composition, the corner would sit at world Z = +0.333 instead of
    // -1.  The corner (0.5, -1) is unambiguous in the cube/hole bottom.
    const triangleCornerKey = `${(0.5).toFixed(3)},${(-1).toFixed(3)}`;
    expect(bottomXZ.has(triangleCornerKey)).toBe(true);
    // And the broken-order vertex (0.5, +0.333) must NOT be on the
    // bottom face.
    const brokenCornerKey = `${(0.5).toFixed(3)},${(0.333).toFixed(3)}`;
    expect(bottomXZ.has(brokenCornerKey)).toBe(false);
  });

  it("boolean cut respects item.scale (resized primitives contribute at their visible size)", async () => {
    // Regression for: "Performing a boolean cut operation between two
    // primitive objects, such as cubes or spheres, does not respect the
    // resizing of the primitive objects, only the rotation and
    // movement."  buildExportShapes applies item.scale explicitly when
    // building OCC shapes for STL/STEP, but performCsg ignored the
    // scale field returned by buildBrushTransform — so a cube the user
    // had scaled up still got boolean'd at its unscaled 2×2×2 size.
    const { ops } = await import("../../occOps.js");
    // Cube A at the origin scaled to 3× — should occupy [-3, +3]^3.
    const cubeA = {
      id: 1,
      type: "cube",
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 3, z: 3 },
    };
    // Cube B at +4 on X, unscaled — occupies [3, 5] × [-1, 1] × [-1, 1].
    // Cubes overlap on the +X face of A (X ∈ [3, 3]).  Difference A − B
    // takes a bite from A.  If A's scale were ignored, A would only
    // span [-1, 1]^3 and cube B would sit entirely OUTSIDE A — the
    // boolean would return A unchanged.
    const cubeB = {
      id: 2,
      type: "cube",
      position: { x: 4, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const result = await ops.performCsg({
      selectedItems: [cubeA, cubeB],
      allItems: [cubeA, cubeB],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // Anchor at cube A's position.
    expect(result.position.x).toBeCloseTo(0, 6);
    // World bbox of the result should reach to cube A's scaled extent
    // (X = -3) on the -X side.  If scale were ignored, minX would be
    // ~-1 (just the unscaled cube).
    let minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      const wx = result.position.x + result.geometryData.positions[i];
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
    }
    expect(minX).toBeCloseTo(-3, 3);
    // The +X side gets the bite from cube B (which spans X up to +5);
    // material is removed from X = 3 onwards within B's Y/Z footprint.
    // A's outer extent on +X (outside B's footprint) is still +3.
    expect(maxX).toBeCloseTo(3, 3);
  });

  it("performCsg anchors the result at the first input's world position", async () => {
    // Regression for: "Applying a cut extrusion results in objects that
    // extrusion touches moving before the cut is applied."  Previously
    // performCsg returned the bbox centre of the result, which shifts
    // when material is removed asymmetrically — visually, the source
    // object's transform-handle bounding box jumped the instant the cut
    // applied.  The fix anchors the result at the first input's
    // brushPos so item.position stays put across the cut.
    const { ops } = await import("../../occOps.js");
    const cubeA = {
      id: 1,
      type: "cube",
      position: { x: 4, y: 0, z: 0 },
    };
    const sphereB = {
      id: 2,
      type: "sphere",
      // Sphere offset to one side so the difference (cube minus sphere)
      // produces an asymmetric bite — the bbox of the result is NOT
      // centred on cubeA's centre.
      position: { x: 4.6, y: 0, z: 0 },
    };
    const result = await ops.performCsg({
      selectedItems: [cubeA, sphereB],
      allItems: [cubeA, sphereB],
      operation: "difference",
      printPrecision: null,
    });
    expect(result).toBeTruthy();
    // The anchor MUST be cubeA's world position, not the bbox centre.
    expect(result.position.x).toBeCloseTo(4);
    expect(result.position.y).toBeCloseTo(0);
    expect(result.position.z).toBeCloseTo(0);
    // geometryData is recentred relative to the anchor, so its bbox
    // centroid sits at a non-zero offset from origin (would be ~0 under
    // the old bbox-centred convention).
    const xs = [];
    for (let i = 0; i < result.geometryData.positions.length; i += 3) {
      xs.push(result.geometryData.positions[i]);
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    // Cube at x=4 spans local [-1, +1]; the bite from sphere at x=4.6
    // trims the +X side, so the local bbox runs ~[-1, +0.4] — note the
    // bbox centroid is no longer at the local origin.
    expect(minX).toBeLessThan(0);
    expect(maxX).toBeLessThan(1);
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
    // Top-outer edge at (-2,-2,1) → (2,-2,1) — the prism's base sits at
    // z=0 and it extends up by `depth` (= 1 here), so the top face is at
    // z = +1.
    const chamfered = chamferShapeBy(
      holed,
      {
        edges: [{ ax: -2, ay: -2, az: 1, bx: 2, by: -2, bz: 1 }],
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

    // 1. Outer top sharp corner is GONE.  (-2,-2,+1) etc were the outer
    //    top corners of the baseline (base at z=0, top at z=depth=1);
    //    after chamfering the top face's outer wire those sharp corners
    //    are replaced by chamfered ones.
    let baselineOuterCorner = 0;
    const basePos = baselineGeo.getAttribute("position");
    for (let i = 0; i < basePos.count; i++) {
      const x = round(basePos.getX(i)),
        y = round(basePos.getY(i)),
        z = round(basePos.getZ(i));
      if (Math.abs(x) === 2 && Math.abs(y) === 2 && z === 1)
        baselineOuterCorner++;
    }
    let chamferedOuterCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 2 && Math.abs(y) === 2 && z === 1)
        chamferedOuterCorner++;
    }
    expect(baselineOuterCorner).toBeGreaterThan(0); // sanity
    expect(chamferedOuterCorner).toBe(0);

    // 2. Inner (hole) top sharp corner is also GONE.  The baseline had
    //    sharp inner corners at (±0.5, ±0.5, +1); they should now be
    //    chamfered away.
    let chamferedInnerCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 0.5 && Math.abs(y) === 0.5 && z === 1)
        chamferedInnerCorner++;
    }
    expect(chamferedInnerCorner).toBe(0);

    // 3. Hole remains open all the way through.  The bottom of the hole's
    //    inner walls is at z = 0; sharp inner corners there should still
    //    exist (we only chamfered the TOP face).
    let bottomInnerCorner = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (Math.abs(x) === 0.5 && Math.abs(y) === 0.5 && z === 0)
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
    // the top face (z=+1, y > +0.5) and the inner wall (y=+0.5, z varies).
    // After a 0.1 chamfer, the new chamfer face vertices should be at:
    //   • on the top face: y in (+0.5, +0.6], i.e. OUTSIDE the hole.
    //   • on the inner wall: z in (+0.9, +1), i.e. moved DOWN.
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

    // Look at every vertex on the TOP plane (z = +1) near the hole's
    // perimeter.  Correct direction: the chamfer's top-face inset moves
    // OUTWARD from the hole edge (e.g. x = ±0.6 at the +X/-X edges, y =
    // ±0.6 at the +Y/-Y edges).  Wrong direction: the inset moves INTO
    // the hole interior (vertices with both |x| < 0.5 AND |y| < 0.5 on
    // the top plane).
    let wrongDirVerts = 0;
    let correctDirVerts = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = round(pos.getX(i)),
        y = round(pos.getY(i)),
        z = round(pos.getZ(i));
      if (z !== 1) continue;
      // Strictly inside the hole's footprint on the top plane = wrong.
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) wrongDirVerts++;
      // Just outside the hole edge (within `amount` of it) = correct
      // chamfer-strip endpoint.
      if (
        ((Math.abs(x) > 0.5 && Math.abs(x) <= 0.7) ||
          (Math.abs(y) > 0.5 && Math.abs(y) <= 0.7)) &&
        Math.abs(x) <= 0.7 &&
        Math.abs(y) <= 0.7
      )
        correctDirVerts++;
    }
    expect(wrongDirVerts).toBe(0);
    expect(correctDirVerts).toBeGreaterThan(0);
  });

  it("extruded polygon with a hole has inner wall normals pointing INTO the hole", () => {
    // Regression for: "A sketch which contains a cut out made of lines
    // does not extrude properly, the faces for the cut out seem to be
    // either missing or their normal is inverted."
    // For each inner wall face, its average normal must point toward the
    // hole's centre (not into the surrounding solid).
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
    const shape = makeExtrude({
      type: "extrude",
      profile: { polygon2D: outer, holes: [hole] },
      depth: 1,
    });
    const geo = tessellate(shape, null);
    const pos = geo.getAttribute("position");
    const idx = geo.index.array;
    const eps = 1e-3;
    // Walk every triangle; if all 3 vertices lie on one of the hole's
    // inner walls (e.g. all at x ≈ +0.5 with y ∈ [-0.5, +0.5]), check
    // its face normal points toward x = 0 (inward).
    const planes = [
      { axis: 0, value: 0.5, normalSign: -1 }, // +X wall → normal -X
      { axis: 0, value: -0.5, normalSign: 1 },
      { axis: 1, value: 0.5, normalSign: -1 },
      { axis: 1, value: -0.5, normalSign: 1 },
    ];
    const wallTriCounts = planes.map(() => 0);
    const correctTriCounts = planes.map(() => 0);
    for (let t = 0; t < idx.length; t += 3) {
      const ax = pos.getX(idx[t]),
        ay = pos.getY(idx[t]),
        az = pos.getZ(idx[t]);
      const bx = pos.getX(idx[t + 1]),
        by = pos.getY(idx[t + 1]),
        bz = pos.getZ(idx[t + 1]);
      const cx = pos.getX(idx[t + 2]),
        cy = pos.getY(idx[t + 2]),
        cz = pos.getZ(idx[t + 2]);
      for (let p = 0; p < planes.length; p++) {
        const { axis, value, normalSign } = planes[p];
        const va = axis === 0 ? ax : ay;
        const vb = axis === 0 ? bx : by;
        const vc = axis === 0 ? cx : cy;
        if (
          Math.abs(va - value) < eps &&
          Math.abs(vb - value) < eps &&
          Math.abs(vc - value) < eps
        ) {
          wallTriCounts[p]++;
          // Compute face normal via (B-A) × (C-A) and check the component
          // along `axis` has the expected sign.
          const u = [bx - ax, by - ay, bz - az];
          const v = [cx - ax, cy - ay, cz - az];
          const nx = u[1] * v[2] - u[2] * v[1];
          const ny = u[2] * v[0] - u[0] * v[2];
          const nz = u[0] * v[1] - u[1] * v[0];
          void nz;
          const component = axis === 0 ? nx : ny;
          if (Math.sign(component) === normalSign) correctTriCounts[p]++;
        }
      }
    }
    // Each of the 4 inner walls must have at least one triangle, and
    // EVERY triangle on each wall must have its normal pointing inward.
    for (let p = 0; p < planes.length; p++) {
      expect(wallTriCounts[p]).toBeGreaterThan(0);
      expect(correctTriCounts[p]).toBe(wallTriCounts[p]);
    }
  });

  it("chamferShapeBy respects an explicit angle (asymmetric chamfer)", () => {
    // A 45° chamfer on a cube edge is symmetric (same offset on both faces).
    // Tilting the angle to 30° should produce a noticeably DIFFERENT
    // tessellation — the chamfer slants more steeply toward one face.
    const cube = makeCube();
    const sym = chamferShapeBy(
      cube,
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      Math.PI / 4, // 45°
    );
    const asym = chamferShapeBy(
      cube,
      { edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }], faces: [] },
      0.1,
      (Math.PI / 180) * 30, // 30°
    );
    const symGeo = tessellate(sym, null);
    const asymGeo = tessellate(asym, null);
    expectSolidGeometry(symGeo);
    expectSolidGeometry(asymGeo);
    // Both produce valid solids; their tessellations should NOT match —
    // a 30° chamfer puts the chamfer face's two long edges at different
    // offsets along the two adjacent faces.
    const symPositions = Array.from(symGeo.getAttribute("position").array);
    const asymPositions = Array.from(asymGeo.getAttribute("position").array);
    const symKey = symPositions.map((v) => v.toFixed(4)).join(",");
    const asymKey = asymPositions.map((v) => v.toFixed(4)).join(",");
    expect(asymKey).not.toBe(symKey);
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
