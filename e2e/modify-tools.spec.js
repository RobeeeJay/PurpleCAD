import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// The remaining modify tools driven end-to-end through their REAL dialogs:
// Boolean (union via BooleanDialog), Shell, Hole, Draft, and Split.  Picks
// are seeded through the store (raycast picking isn't DOM-addressable), but
// the dialog UI, Confirm wiring, OCC round-trip, and timeline entry are all
// the real thing.

let app;
let page;

const addCube = (id, x = 0) =>
  page.evaluate(
    ({ id, x }) => {
      window.__store.getState().addItem({
        id,
        name: `Cube ${id}`,
        type: "cube",
        children: [],
        position: { x, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    },
    { id, x },
  );

const item = (id) =>
  page.evaluate(
    (id) => {
      const it = window.__store.getState().items.find((i) => i.id === id);
      return it
        ? {
            type: it.type,
            kind: it.regenerator?.kind ?? null,
            tris: it.geometryData ? it.geometryData.indices.length / 3 : 0,
          }
        : null;
    },
    id,
  );

test.describe.serial("modify tools through their dialogs", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("boolean union fuses two cubes via the dialog", async () => {
    await addCube(1, 0);
    await addCube(2, 1.5);
    const entriesBefore = await page.evaluate(
      () => window.__store.getState().history.length,
    );
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startBooleanTool("union");
      window.__store.setState({ selectedIds: [1, 2] });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Apply Union").click();
    // The union consumes both inputs into a NEW csg item.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .items.find((i) => i.regenerator?.kind === "boolean")?.id ??
              null,
          ),
        { timeout: 30000 },
      )
      .not.toBe(null);
    const after = await page.evaluate(() => {
      const s = window.__store.getState();
      return {
        solids: s.items.filter((i) => i.type === "csg").length,
        entries: s.history.length,
        toolOpen: !!s.booleanTool,
      };
    });
    expect(after.solids).toBe(1); // inputs consumed into one body
    expect(after.entries).toBeGreaterThan(entriesBefore);
    expect(after.toolOpen).toBe(false);
  });

  test("shell hollows a cube via the dialog", async () => {
    await addCube(11);
    await page.evaluate(() =>
      window.__store.getState().setShellTarget({ itemId: 11 }),
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Apply the shell").click();
    await expect.poll(() => item(11).then((i) => i.kind)).toBe("shell");
    expect((await item(11)).tris).toBeGreaterThan(12);
  });

  test("hole cuts a plain bore via the dialog", async () => {
    await addCube(12, 5);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startHoleTool();
      // Picks are recorded in the ITEM-LOCAL frame (the cube spans ±1
      // locally regardless of its world position).
      s.setHoleFace(12, {
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 0, y: 1, z: 0 },
      });
      s.setHolePoint({ x: 0, y: 1, z: 0 });
      s.updateHoleParams({ threaded: false, lengthMm: 12, diameterMm: 6 });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Cut the hole").click();
    await expect.poll(() => item(12).then((i) => i.kind), { timeout: 30000 }).toBe(
      "hole",
    );
    expect((await item(12)).tris).toBeGreaterThan(20); // bore wall added
  });

  test("draft tapers a face via the dialog", async () => {
    await addCube(13, -5);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startDraftTool();
      s.setDraftNeutral({ nx: 0, ny: 1, nz: 0, cx: -5, cy: 2, cz: 0 }, 13);
      s.toggleDraftFace({ nx: 1, ny: 0, nz: 0, cx: -4, cy: 1, cz: 0 });
    });
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await page.getByTitle("Apply the draft").click();
    await expect.poll(() => item(13).then((i) => i.kind), { timeout: 30000 }).toBe(
      "draft",
    );
  });

  test("split cuts a cube into two bodies via the dialog", async () => {
    await addCube(14, 10);
    const countBefore = await page.evaluate(
      () => window.__store.getState().items.length,
    );
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startSplit3d({ objectId: 14, objectName: "Cube 14" });
      s.updateSplit3d({
        cutFrame: {
          position: { x: 10, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        cutLabel: "plane",
      });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Split the object").click();
    // The cut yields two csg halves carrying the source's name.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .items.filter(
                  (i) => i.type === "csg" && /Cube 14/.test(i.name || ""),
                ).length,
          ),
        { timeout: 30000 },
      )
      .toBe(2);
    const halves = await page.evaluate(() =>
      window.__store
        .getState()
        .items.filter((i) => i.type === "csg" && /Cube 14/.test(i.name || ""))
        .map((i) => i.geometryData.indices.length / 3),
    );
    for (const tris of halves) expect(tris).toBeGreaterThan(4);
    expect(
      await page.evaluate(() => window.__store.getState().items.length),
    ).toBeGreaterThan(countBefore);
  });
});
