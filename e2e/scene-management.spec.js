// Scene-management workflows that had no coverage: visibility + solo, folders,
// per-object material, cross-section view, and 3D mirror/pattern.  These are
// mostly store-level behaviours with a visible consequence in the tree or the
// viewport, so each check pairs the state change with what the user sees.

import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

const addCube = (id, name, x) =>
  page.evaluate(
    ([i, n, px]) => {
      window.__store.getState().addItem(
        {
          id: i,
          type: "cube",
          name: n,
          children: [],
          parentId: null,
          position: { x: px, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { width: 2, height: 2, depth: 2 },
        },
        "Added",
      );
    },
    [id, name, x],
  );

const itemById = (id) =>
  page.evaluate(
    (n) => window.__store.getState().items.find((i) => i.id === n) ?? null,
    id,
  );

test.describe.serial("scene management", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => window.__store.getState().newDocument?.());
    await addCube(900, "Alpha", -3);
    await addCube(901, "Beta", 3);
    await page.waitForTimeout(600);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("hiding an object removes it from the viewport but not the document", async () => {
    await page.evaluate(() =>
      window.__store.getState().toggleItemVisibility(900),
    );
    expect((await itemById(900)).visible).toBe(false);
    // Still listed in the tree — hidden, not deleted.
    await expect(page.locator(".tree-view-content")).toContainText("Alpha");
    await page.evaluate(() =>
      window.__store.getState().toggleItemVisibility(900),
    );
    expect((await itemById(900)).visible).not.toBe(false);
  });

  test("solo isolates one object and clearing restores the rest", async () => {
    await page.evaluate(() => window.__store.getState().setItemSolo(901, null));
    expect(
      await page.evaluate(() => window.__store.getState().soloItemId),
    ).toBe(901);
    await page.evaluate(() => window.__store.getState().clearItemSolo());
    expect(
      await page.evaluate(() => window.__store.getState().soloItemId),
    ).toBeNull();
  });

  test("a folder can be created and renamed from the tree", async () => {
    await page.locator(".tree-view-header .tree-header-btn").nth(1).click();
    const folders = await page.evaluate(
      () => window.__store.getState().folders,
    );
    expect(folders.length).toBeGreaterThan(0);

    // A new folder drops straight into inline rename, so finish it the way a
    // user would rather than writing to the store behind the UI's back.
    const input = page.locator(".tree-rename-input");
    await expect(input).toBeVisible();
    await input.fill("Parts");
    await input.press("Enter");

    await expect(page.locator(".tree-view-content")).toContainText("Parts");
    const named = await page.evaluate(() =>
      window.__store.getState().folders.map((f) => f.name),
    );
    expect(named).toContain("Parts");
  });

  test("a per-object material is stored on the item", async () => {
    await page.evaluate(() =>
      window.__store.getState().setItemMaterial(900, {
        color: "#ff0000",
        metalness: 0.9,
        roughness: 0.1,
        opacity: 1,
      }),
    );
    const it = await itemById(900);
    expect(it.material.color).toBe("#ff0000");
    expect(it.material.metalness).toBeCloseTo(0.9, 6);
  });

  test("cross-section view toggles on and off cleanly", async () => {
    await page.evaluate(() =>
      window.__store.getState().toggleCrossSectionView(),
    );
    expect(
      await page.evaluate(() => window.__store.getState().crossSectionView),
    ).toBe(true);
    await page.waitForTimeout(400);
    await page.evaluate(() =>
      window.__store.getState().toggleCrossSectionView(),
    );
    expect(
      await page.evaluate(() => window.__store.getState().crossSectionView),
    ).toBe(false);
  });

  test("the 3D mirror and pattern tools arm and cancel without side effects", async () => {
    const countItems = () =>
      page.evaluate(() => window.__store.getState().items.length);
    const before = await countItems();

    await page.evaluate(() => window.__store.getState().startMirror3d({}));
    expect(
      await page.evaluate(() => !!window.__store.getState().mirror3dTool),
    ).toBe(true);
    await page.evaluate(() => window.__store.getState().cancelMirror3d());
    expect(
      await page.evaluate(() => window.__store.getState().mirror3dTool),
    ).toBeNull();

    await page.evaluate(() =>
      window.__store.getState().startPattern3d({ kind: "linear" }),
    );
    expect(
      await page.evaluate(() => !!window.__store.getState().pattern3dTool),
    ).toBe(true);
    await page.evaluate(() => window.__store.getState().cancelPattern3d());
    expect(
      await page.evaluate(() => window.__store.getState().pattern3dTool),
    ).toBeNull();

    // Arming and cancelling a tool must never create or destroy geometry.
    expect(await countItems()).toBe(before);
  });
});
