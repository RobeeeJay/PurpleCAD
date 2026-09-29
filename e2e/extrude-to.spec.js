import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// "To…" in the extrude dialog: click a face and the distance is set so the
// extrusion reaches it.  Driven with real clicks, alongside "Start from…",
// which shares its face pick.
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

const screen = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) =>
      window.__store.getState()._cameraControls.worldToScreen(x, y, z),
    [x, y, z],
  );

test("To… sets the distance so the extrusion reaches the clicked face", async () => {
  // A circle on the ground, and beside it a 20 mm cube standing 5 mm up:
  // its top face is 25 mm above the ground (y = 2.5 internally).
  await page.evaluate(() =>
    window.__api.call("document.new", { discardCurrent: true }),
  );
  const sketch = await page.evaluate(() =>
    window.__api.call("sketch.create", {
      plane: "XY",
      shapes: [{ type: "circle", cx: 0, cy: 0, r: 5 }],
    }),
  );
  expect(sketch.ok, JSON.stringify(sketch.error)).toBe(true);
  await page.evaluate(() => {
    window.__store.getState().addItem({
      id: 500,
      name: "Target",
      type: "cube",
      children: [],
      position: { x: 3, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    window.__store.getState().selectItem(null);
    window.__store.getState().setExtrudeSelectMode("profile");
  });
  await page.waitForTimeout(600); // region fills materialise
  let p = await screen(0, 0, 0);
  await page.mouse.click(p.x, p.y);
  const overlay = page.locator(".sketch-distance-input-overlay");
  await expect(overlay).toBeVisible({ timeout: 5000 });
  const offset = overlay.locator("input").nth(0);
  const distance = overlay.locator("input").nth(1);

  // Start from the cube's top face: the offset reads 25 mm.
  await page.getByTitle("Start from…", { exact: false }).click();
  p = await screen(3, 2.5, 0);
  await page.mouse.click(p.x, p.y);
  await expect(offset).toHaveValue("25.00");

  // Reaching the face the extrude starts from is no distance at all.
  await page.getByTitle("To… — click a face", { exact: false }).click();
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(() => page.evaluate(() => window.__store.getState().notification))
    .toMatch(/where the extrude starts/);

  // A fresh extrude from the ground (Start from also fuses into the solid it
  // picked, which this check is not about): To… the cube's top face reads
  // exactly 25 mm.
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await page.evaluate(() =>
    window.__store.getState().setExtrudeSelectMode("profile"),
  );
  await page.waitForTimeout(600);
  const centre = await screen(0, 0, 0);
  await page.mouse.click(centre.x, centre.y);
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await page.getByTitle("To… — click a face", { exact: false }).click();
  await page.mouse.click(p.x, p.y);
  await expect(distance).toHaveValue("25");

  await distance.press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.type === "extrude")
              ?.depth ?? null,
        ),
      { timeout: 30000 },
    )
    .not.toBeNull();
  const depth = await page.evaluate(
    () =>
      window.__store.getState().items.find((i) => i.type === "extrude").depth,
  );
  expect(Number(depth)).toBe(25);
});
