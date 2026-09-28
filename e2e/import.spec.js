import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// STL and STEP import through the real menu → file chooser → importGeometry
// path.  The STL fixture is generated in-test (a 20 mm binary-STL cube); the
// STEP fixture is produced by the app's own exporter, so the import test also
// round-trips the exchange format.

let app;
let page;

// Binary STL: 12 triangles of a cube spanning ±10 mm -- or 10, with its top
// face left off, for a mesh that isn't closed.
const cubeStl = ({ lidless = false } = {}) => {
  const tris = [];
  const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
  const v = (x, y, z) => [x * 10, y * 10, z * 10];
  if (!lidless) quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));
  quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1));
  quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1));
  quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1));
  quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1));
  quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    o += 12; // zero normal — readers recompute
    for (const p of t)
      for (const c of p) {
        buf.writeFloatLE(c, o);
        o += 4;
      }
    o += 2;
  }
  return buf;
};

test.describe.serial("import", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  const importVia = async (menuItemTitle, file) => {
    await page.getByTitle("Load / Import", { exact: false }).first().click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTitle(menuItemTitle, { exact: false }).click();
    await (await chooser).setFiles(file);
  };

  test("importing a binary STL creates a solid body", async () => {
    await importVia("Import an STL mesh", {
      name: "cube.stl",
      mimeType: "model/stl",
      buffer: cubeStl(),
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const it = window.__store
              .getState()
              .items.find((i) => i.type === "csg");
            return it ? it.geometryData.positions.length / 3 : 0;
          }),
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    // 20 mm cube → 2-unit extent in the scene (Z-up file → Y-up scene).
    const ext = await page.evaluate(() => {
      const p = window.__store.getState().items.find((i) => i.type === "csg")
        .geometryData.positions;
      const mn = [1e9, 1e9, 1e9],
        mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], p[i + k]);
          mx[k] = Math.max(mx[k], p[i + k]);
        }
      return mx.map((v, k) => v - mn[k]);
    });
    for (const e of ext) expect(e).toBeCloseTo(2, 1);

    // Welded as it came in: the STL's 36 private vertices are its 8 corners,
    // stored indexed -- and still DRAWN per triangle (split apart for display),
    // so the cube's edges stay crisp rather than smooth-shaded.  A closed mesh
    // raises no warning.
    const stored = await page.evaluate(() => {
      const s = window.__store.getState();
      const it = s.items.find((i) => i.type === "csg");
      const drawn = s._cameraControls.meshWorldData(it.id);
      return {
        vertices: it.geometryData.positions.length / 3,
        indices: it.geometryData.indices?.length,
        flat: it.geometryData.flat,
        drawnIndexed: drawn.indices != null,
        note: s.notification,
      };
    });
    expect(stored).toEqual({
      vertices: 8,
      indices: 36,
      flat: true,
      drawnIndexed: false,
      note: null,
    });
  });

  test("an STL that isn't closed is imported with a warning", async () => {
    await page.evaluate(() => window.__store.getState().newDocument());
    await importVia("Import an STL mesh", {
      name: "open box.stl",
      mimeType: "model/stl",
      buffer: cubeStl({ lidless: true }),
    });
    await expect
      .poll(() => page.evaluate(() => window.__store.getState().notification), {
        timeout: 30000,
      })
      .toBe(
        "open box (STL) isn't a closed solid: it has 4 open edges. Booleans with it may leave holes.",
      );
    // It is still imported: a warning, not a refusal.
    expect(
      await page.evaluate(
        () =>
          window.__store.getState().items.filter((i) => i.type === "csg")
            .length,
      ),
    ).toBe(1);
  });

  test("importing a STEP file (exported by the app) creates a solid body", async () => {
    // Round-trip: export a cube through the app's own STEP writer...
    const stepText = await page.evaluate(async () => {
      const item = {
        id: 900,
        type: "cube",
        position: { x: 0, y: 1, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      return window.electronAPI.invokeOcc("exportSTEP", {
        items: [item],
        allItems: [item],
        precision: 0.1,
      });
    });
    expect(stepText).toContain("ISO-10303-21");
    const before = await page.evaluate(
      () =>
        window.__store.getState().items.filter((i) => i.type === "csg").length,
    );
    await importVia("Import a STEP file", {
      name: "cube.step",
      mimeType: "application/step",
      buffer: Buffer.from(stepText, "utf8"),
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store.getState().items.filter((i) => i.type === "csg")
                .length,
          ),
        { timeout: 60000 },
      )
      .toBe(before + 1);
  });
});
