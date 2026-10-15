// One Resolution setting, in Settings: the Normal/High toolbar toggle and the
// High resolution setting are gone.  A new value rebuilds the WHOLE timeline
// at once (a forced recalc, as the Timeline's Recalculate does): steps after
// the one in view are rebuilt now, not left for when they are next visited.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test("there is no resolution toggle on the toolbar", async () => {
  await expect(
    page.getByTitle(/High resolution|Normal resolution/),
  ).toHaveCount(0);
});

test("a new Resolution rebuilds the steps after the one in view", async () => {
  // A cube chamfered twice: two CSG steps after the cube.
  await page.evaluate(async () => {
    const s = window.__store.getState();
    s.newDocument();
    s.addItem({
      id: 840,
      name: "Block",
      type: "cube",
      children: [],
      parentId: null,
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });
  // Chamfer through the store's own commit path, as the dialog does.
  for (const edge of [
    { ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 },
    { ax: -1, ay: -1, az: 1, bx: 1, by: -1, bz: 1 },
  ]) {
    await page.evaluate(async (edge) => {
      const s = window.__store.getState();
      const item = s.items.find((i) => i.id === 840);
      const r = await window.electronAPI.invokeOcc("chamferOrFilletItem", {
        source: item,
        subGeo: { edges: [edge], faces: [] },
        amount: 0.2,
        segments: 1,
        allItems: s.items,
        printPrecision: s.resolutionMm,
      });
      s.modifyItem(
        840,
        {
          type: "csg",
          geometryData: r.geometryData,
          regenerator: {
            kind: "chamfer",
            source: item,
            subGeo: r.resolvedSubGeo || { edges: [edge], faces: [] },
            amount: 0.2,
            segments: 1,
            centerOffset: r.centerOffset,
            regeneratedAt: s.resolutionMm,
          },
        },
        "Chamfered",
      );
    }, edge);
  }
  const steps = await page.evaluate(() =>
    window.__store.getState().history.map((h) => h.id),
  );
  // View the cube's step: the two chamfers come after it.
  await page.evaluate(
    (id) => window.__store.getState().restoreToHistory(id),
    steps[1],
  );

  await page.getByTitle("Settings — field of view and snap").click();
  const dialog = page.locator(".variables-dialog", { hasText: "Resolution" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("High resolution")).toHaveCount(0);
  // The innermost row holding the "Resolution" label.
  const input = dialog
    .locator("div")
    .filter({ has: page.getByText("Resolution", { exact: true }) })
    .last()
    .locator("input");
  await input.fill("0.1");
  await input.press("Enter");

  // The LAST step -- not in view -- is rebuilt at 0.1 mm.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const h = window.__store.getState().history;
          return h[h.length - 1].instruction.patches?.regenerator
            ?.regeneratedAt;
        }),
      { timeout: 60000 },
    )
    .toBe(0.1);
  await page.evaluate(() => window.__store.getState().setResolutionMm(0.05));
});
