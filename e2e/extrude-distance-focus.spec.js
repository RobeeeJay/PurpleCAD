// Extrude started with something already selected opens its distance field at
// once -- and the length typed next has to REPLACE the default.  It used to
// arrive focused but unselected, so typing "25" made "10.0025".
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

test("a face selected before Extrude: typing replaces the default distance", async () => {
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.newDocument();
    s.addItem({
      id: 820,
      name: "Block",
      type: "cube",
      children: [],
      parentId: null,
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    s.selectItem(null);
    // The cube's top face, as an Alt+click selects it (mesh-local frame).
    s.setSelectedSubGeometry({
      itemId: 820,
      edges: [],
      faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }],
    });
  });
  await page.getByTitle("Extrude the selected face along its normal").click();

  const distance = page.locator("#extrude-distance");
  await expect(distance).toBeVisible({ timeout: 5000 });
  await expect(distance).toBeFocused();
  // All of the default selected, so the first keystroke replaces it.
  await expect
    .poll(() =>
      distance.evaluate(
        (el) =>
          el.value.length > 0 &&
          el.selectionStart === 0 &&
          el.selectionEnd === el.value.length,
      ),
    )
    .toBe(true);

  await page.keyboard.type("25");
  await expect(distance).toHaveValue("25");
  await page.keyboard.press("Escape");
});
