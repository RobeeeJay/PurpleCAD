import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// Bridge-parity sweep: drives each core OCC op through the REAL renderer →
// main-process IPC → electron/occ-bridge.cjs → native addon path, asserting
// concrete result extents.  vitest exercises only src/three/occOps.js — the
// bridge is a parallel implementation that "mirrors occOps.js" by hand, and
// an un-mirrored edit passes every unit test while doing nothing in the
// shipped app.  These numbers fail here instead.
//
// All asserts are on the returned mesh's bbox EXTENTS (positions are
// bbox-centred, so absolute coordinates carry no signal).  Scene units: a
// cube is 2×2×2 at scale 1.

let app;
let page;

const cube = (id, overrides = {}) => ({
  id,
  name: `Cube ${id}`,
  type: "cube",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...overrides,
});

// Runs in the renderer: invoke the op over IPC and reduce the result mesh to
// extents + vertex predicates the tests assert on.
const runOp = (op, args) =>
  page.evaluate(
    async ([op, args]) => {
      const result = await window.electronAPI.invokeOcc(op, args);
      if (!result?.geometryData?.positions) return { result, extents: null };
      const p = result.geometryData.positions;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[i + k]);
          max[k] = Math.max(max[k], p[i + k]);
        }
      // Does any vertex sit on the (pre-chamfer) top-back edge y≈max, z≈max?
      let onTopBackEdge = false;
      for (let i = 0; i < p.length; i += 3)
        if (p[i + 1] > max[1] - 1e-3 && p[i + 2] > max[2] - 1e-3)
          onTopBackEdge = true;
      return {
        extents: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        triCount: (result.geometryData.indices?.length ?? p.length / 3) / 3,
        onTopBackEdge,
      };
    },
    [op, args],
  );

const edgeYZ = {
  edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
  faces: [],
};

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test("chamfer bevels the selected edge, extents preserved", async () => {
  const c = cube(1);
  const r = await runOp("chamferOrFilletItem", {
    source: c,
    subGeo: edgeYZ,
    amount: 0.3,
    segments: 1,
    allItems: [c],
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(2, 3);
  expect(r.extents[1]).toBeCloseTo(2, 3);
  expect(r.extents[2]).toBeCloseTo(2, 3);
  // The top-back edge was cut away — no vertex remains on it.
  expect(r.onTopBackEdge).toBe(false);
});

test("fillet rounds the selected edge", async () => {
  const c = cube(2);
  const r = await runOp("chamferOrFilletItem", {
    source: c,
    subGeo: edgeYZ,
    amount: 0.3,
    segments: 3,
    allItems: [c],
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(2, 3);
  expect(r.onTopBackEdge).toBe(false);
});

test("boolean honours a non-uniform input scale", async () => {
  // The classic drift: booleanInputLocal/scaleLocal collapsing {x,y,z} to
  // scale.x silently drops the stretch (see the display↔rebuild parity
  // landmines).  A y-stretched cube unioned with a far, small cube must span
  // the stretched height.
  const a = cube(3, { scale: { x: 1, y: 2, z: 1 } });
  const b = cube(9, { position: { x: 3, y: 0, z: 0 } });
  const r = await runOp("performCsg", {
    selectedItems: [a, b],
    allItems: [a, b],
    operation: "union",
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(5, 3); // -1..4
  expect(r.extents[1]).toBeCloseTo(4, 3); // the stretch survives
  expect(r.extents[2]).toBeCloseTo(2, 3);
});

test("boolean union spans both bodies", async () => {
  const a = cube(4);
  const b = cube(5, { position: { x: 1, y: 0, z: 0 } });
  const r = await runOp("performCsg", {
    selectedItems: [a, b],
    allItems: [a, b],
    operation: "union",
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(3, 3); // -1..2
  expect(r.extents[1]).toBeCloseTo(2, 3);
  expect(r.extents[2]).toBeCloseTo(2, 3);
});

test("boolean difference truncates the body", async () => {
  const a = cube(6);
  const b = cube(7, { position: { x: 1.5, y: 0, z: 0 } });
  const r = await runOp("performCsg", {
    selectedItems: [a, b],
    allItems: [a, b],
    operation: "difference",
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(1.5, 3); // -1..0.5
  expect(r.extents[1]).toBeCloseTo(2, 3);
});

test("shell hollows without changing the outer extents", async () => {
  const c = cube(8);
  const solid = await runOp("chamferOrFilletItem", {
    source: c,
    subGeo: edgeYZ,
    amount: 0.1,
    segments: 1,
    allItems: [c],
    printPrecision: 0.1,
  });
  const r = await runOp("shellItem", {
    source: c,
    thickness: 0.2,
    allItems: [c],
    printPrecision: 0.1,
  });
  expect(r.extents[0]).toBeCloseTo(2, 3);
  expect(r.extents[1]).toBeCloseTo(2, 3);
  expect(r.extents[2]).toBeCloseTo(2, 3);
  // Hollowing adds the inner wall — strictly more triangles than any solid
  // variant of the same cube.
  expect(r.triCount).toBeGreaterThan(solid.triCount > 12 ? 12 : 0);
});
