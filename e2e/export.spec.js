import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// STL/STEP export round-trip through the real IPC + bridge.  The export path
// has its own rules (baked-mesh preference, skipCaps sew, mm scaling, the
// +π/2-about-X rotation to Z-up) and no other automated coverage.  A cube
// resting on the ground (internal y 0..2, x/z −1..1) must export as a
// 20 mm cube with Z 0..20 — proving both the mm scaling and the Z-up
// conversion in one assert.

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

const groundedCube = {
  id: 11,
  name: "Cube 11",
  type: "cube",
  children: [],
  position: { x: 0, y: 1, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

test("binary STL is mm-scaled and Z-up", async () => {
  const r = await page.evaluate(async (item) => {
    const buffer = await window.electronAPI.invokeOcc("exportSTL", {
      items: [item],
      allItems: [item],
      precision: 0.1,
    });
    const view = new DataView(
      buffer.buffer ?? buffer,
      buffer.byteOffset ?? 0,
      buffer.byteLength,
    );
    const triCount = view.getUint32(80, true);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < triCount; t++) {
      const base = 84 + t * 50 + 12; // skip normal
      for (let v = 0; v < 3; v++)
        for (let k = 0; k < 3; k++) {
          const val = view.getFloat32(base + v * 12 + k * 4, true);
          min[k] = Math.min(min[k], val);
          max[k] = Math.max(max[k], val);
        }
    }
    return { triCount, min, max, bytes: view.byteLength };
  }, groundedCube);

  expect(r.triCount).toBeGreaterThanOrEqual(12);
  expect(r.bytes).toBe(84 + r.triCount * 50);
  // X/Y centred ±10 mm; the internal +y height becomes Z 0..20 (Z-up).
  expect(r.min[0]).toBeCloseTo(-10, 3);
  expect(r.max[0]).toBeCloseTo(10, 3);
  expect(r.min[1]).toBeCloseTo(-10, 3);
  expect(r.max[1]).toBeCloseTo(10, 3);
  expect(r.min[2]).toBeCloseTo(0, 3);
  expect(r.max[2]).toBeCloseTo(20, 3);
});

test("chamfered body exports its BAKED mesh, not a recipe rebuild", async () => {
  // Chamfer the cube, bake the result onto the item (as commit does), and
  // export.  The STL must reflect the beveled geometry: no vertex remains on
  // the pre-chamfer top-back edge.
  const r = await page.evaluate(async (item) => {
    const chamfered = await window.electronAPI.invokeOcc(
      "chamferOrFilletItem",
      {
        source: item,
        subGeo: {
          edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
          faces: [],
        },
        amount: 0.3,
        segments: 1,
        allItems: [item],
        printPrecision: 0.1,
      },
    );
    const baked = {
      ...item,
      type: "csg",
      geometryData: chamfered.geometryData,
      regenerator: { kind: "chamfer" },
    };
    const buffer = await window.electronAPI.invokeOcc("exportSTL", {
      items: [baked],
      allItems: [baked],
      precision: 0.1,
    });
    const view = new DataView(
      buffer.buffer ?? buffer,
      buffer.byteOffset ?? 0,
      buffer.byteLength,
    );
    const triCount = view.getUint32(80, true);
    // In the exported Z-up frame the internal top-back edge (y=max, z=max)
    // maps to z=max, y=min.
    let zMax = -Infinity,
      yMin = Infinity;
    const verts = [];
    for (let t = 0; t < triCount; t++) {
      const base = 84 + t * 50 + 12;
      for (let v = 0; v < 3; v++) {
        const x = view.getFloat32(base + v * 12, true);
        const y = view.getFloat32(base + v * 12 + 4, true);
        const z = view.getFloat32(base + v * 12 + 8, true);
        zMax = Math.max(zMax, z);
        yMin = Math.min(yMin, y);
        verts.push([x, y, z]);
      }
    }
    const onEdge = verts.some(([, y, z]) => z > zMax - 0.01 && y < yMin + 0.01);
    return { triCount, onEdge };
  }, groundedCube);

  expect(r.triCount).toBeGreaterThan(12); // bevel adds facets
  expect(r.onEdge).toBe(false);
});

test("STEP export emits an ISO-10303 file", async () => {
  const text = await page.evaluate(
    (item) =>
      window.electronAPI.invokeOcc("exportSTEP", {
        items: [item],
        allItems: [item],
        precision: 0.1,
      }),
    groundedCube,
  );
  expect(typeof text).toBe("string");
  expect(text).toContain("ISO-10303-21");
  expect(text).toContain("END-ISO-10303-21");
});
