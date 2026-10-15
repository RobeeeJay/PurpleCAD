import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The raster views draw a body from its colour and transparency only:
// metalness, roughness, clearcoat and specular belong to the path-traced
// render.  Two bodies of one colour must look alike there however different
// their finishes -- including while the Material dialog previews an edit.

let app;
let page;

const RED = "#cc3344";
const CHROME = {
  color: RED,
  metalness: 1,
  roughness: 0.02,
  clearcoat: 1,
  clearcoatRoughness: 0,
  opacity: 1,
};
const RUBBER = { ...CHROME, metalness: 0, roughness: 1, clearcoat: 0 };

const info = (id) =>
  page.evaluate(
    (i) => window.__store.getState()._cameraControls.meshDisplayInfo(i),
    id,
  );

test.describe.serial("shaded materials", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(
      ({ chrome, rubber }) => {
        const s = window.__store.getState();
        const body = (id, type, x, material) => ({
          id,
          type,
          name: `${type} ${id}`,
          children: [],
          parentId: null,
          position: { x, y: 1, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          material,
        });
        s.addItem(body(901, "cube", -3, chrome));
        s.addItem(body(902, "cube", 0, rubber));
        s.addItem(body(903, "cube", 3, { ...rubber, opacity: 0.4 }));
        s.addItem(body(904, "sphere", 6, chrome));
        s.setRenderMode("shaded");
      },
      { chrome: CHROME, rubber: RUBBER },
    );
    await expect.poll(async () => (await info(904))?.material).toBeTruthy();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("shaded: a chrome and a rubber body of one colour are drawn alike", async ({}, testInfo) => {
    const chrome = (await info(901)).material;
    const rubber = (await info(902)).material;
    expect(chrome).toEqual(rubber);
    expect(chrome).toMatchObject({
      type: "MeshLambertMaterial",
      color: RED.slice(1),
      opacity: 1,
      transparent: false,
      finish: [],
    });
    // The analytic sphere is a custom shader with no finish inputs at all.
    expect((await info(904)).material.finish).toEqual([]);
    const file = testInfo.outputPath("shaded-materials.png");
    await page.screenshot({ path: file, timeout: 15_000 });
    await testInfo.attach("shaded-materials", {
      path: file,
      contentType: "image/png",
    });
  });

  test("shaded: transparency still shows", async () => {
    expect((await info(903)).material).toMatchObject({
      type: "MeshLambertMaterial",
      opacity: 0.4,
      transparent: true,
      finish: [],
    });
  });

  test("transparent view: colour at half opacity, still no finish", async () => {
    await page.evaluate(() =>
      window.__store.getState().setRenderMode("transparent"),
    );
    await expect.poll(async () => (await info(901)).material.opacity).toBe(0.5);
    expect((await info(901)).material).toMatchObject({
      type: "MeshLambertMaterial",
      transparent: true,
      finish: [],
    });
    await page.evaluate(() =>
      window.__store.getState().setRenderMode("shaded"),
    );
    await expect.poll(async () => (await info(901)).material.opacity).toBe(1);
  });

  test("the Material dialog's live preview changes colour only", async () => {
    await page.evaluate(() =>
      window.__store.getState().setMaterialDialogTarget(902),
    );
    const metalness = page
      .getByTitle("How metallic the surface reads", { exact: false })
      .locator('input[type="range"]');
    await metalness.fill("0.9");
    const roughness = page
      .getByTitle("How scattered the reflections are", { exact: false })
      .locator('input[type="range"]');
    await roughness.fill("0.05");
    await page.waitForTimeout(300);
    expect((await info(902)).material).toMatchObject({
      type: "MeshLambertMaterial",
      finish: [],
    });
    // The dialog says where those settings DO show.
    await expect(
      page.getByText("only show in the Path traced", { exact: false }),
    ).toBeVisible();
    await page.getByTitle("Close", { exact: true }).click();
  });
});
