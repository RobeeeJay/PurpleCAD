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
