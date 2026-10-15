import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// A tool preview that finishes after its dialog has closed must not be drawn.
// A boolean with an imported mesh previews through OCC and takes seconds; its
// result used to land after Cancel and stay in the scene -- in every project,
// new ones included, until some later preview replaced it.
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

test("a boolean preview that lands after Cancel is dropped", async () => {
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.newDocument();
    // A dense closed sphere standing in for an imported STL: slow enough in
    // OCC that Cancel comes first.
    const seg = 100;
    const positions = [0, 1, 0];
    for (let i = 1; i < seg; i++)
      for (let j = 0; j < seg; j++) {
        const v = (i / seg) * Math.PI;
        const u = (j / seg) * 2 * Math.PI;
        positions.push(
          Math.sin(v) * Math.cos(u),
          Math.cos(v),
          Math.sin(v) * Math.sin(u),
        );
      }
    positions.push(0, -1, 0);
    const south = positions.length / 3 - 1;
    const at = (i, j) =>
      i === 0 ? 0 : i === seg ? south : 1 + (i - 1) * seg + (j % seg);
    const indices = [];
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < seg; j++) {
        if (i !== 0) indices.push(at(i, j), at(i, j + 1), at(i + 1, j));
        if (i !== seg - 1)
          indices.push(at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
      }
    s.addItem({
      id: 700,
      name: "Base (STL)",
      type: "csg",
      children: [],
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      geometryData: { positions, indices, normals: null, flat: true },
    });
    s.addItem({
      id: 701,
      name: "Box",
      type: "cube",
      children: [],
      position: { x: 1, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    s.startBooleanTool("union");
    window.__store.setState({ selectedIds: [700, 701] });
  });
  // The preview starts (OCC busy), and the dialog is cancelled under it.
  await expect
    .poll(() =>
      page.evaluate(() => window.__store.getState().pendingOperations),
    )
    .toBeGreaterThan(0);
  await page.getByTitle("Cancel").click();
  await expect
    .poll(
      () => page.evaluate(() => window.__store.getState().pendingOperations),
      { timeout: 60000 },
    )
    .toBe(0);
  await page.waitForTimeout(300);
  const shown = () =>
    page.evaluate(() =>
      window.__store.getState()._cameraControls.previewShown(),
    );
  expect(await shown(), "a preview left behind after Cancel").toBe(false);

  // And nothing carries into a new document.
  await page.evaluate(() => window.__store.getState().newDocument());
  await page.waitForTimeout(300);
  expect(await shown()).toBe(false);
});
