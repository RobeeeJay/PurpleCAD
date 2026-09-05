import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Undo/redo through the real keyboard wiring (App.jsx's Ctrl/Cmd+Z handler),
// asserting the store state machine at every step: create → move → undo ×2 →
// redo ×2 must land back on identical state, and the timeline length must
// track it.

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

const snapshot = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    const item = s.items.find((i) => i.id === 41);
    return {
      hasItem: !!item,
      position: item?.position ?? null,
      steps: s.history.length,
      undoDepth: s.undoStack.length,
      redoDepth: s.redoStack.length,
    };
  });

test("create + move, undo twice, redo twice", async () => {
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.addItem({
      id: 41,
      name: "Cube 41",
      type: "cube",
      children: [],
      position: { x: 0, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });
  const created = await snapshot();
  expect(created.hasItem).toBe(true);

  await page.evaluate(() => {
    const s = window.__store.getState();
    s.setItemTransform(41, { x: 2, y: 1, z: 0 }, null, null);
    s.recordTransformHistory(41, "Moved");
  });
  const moved = await snapshot();
  expect(moved.position.x).toBeCloseTo(2, 6);
  expect(moved.steps).toBe(created.steps + 1);

  // Give the viewport focus so the app-level key handler receives the events.
  await page
    .locator("canvas")
    .first()
    .click({ position: { x: 400, y: 200 } });
  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const redoKey =
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

  await page.keyboard.press(undoKey);
  const afterUndo1 = await snapshot();
  expect(afterUndo1.position.x).toBeCloseTo(0, 6); // move undone
  expect(afterUndo1.steps).toBe(created.steps);

  await page.keyboard.press(undoKey);
  const afterUndo2 = await snapshot();
  expect(afterUndo2.hasItem).toBe(false); // create undone
  expect(afterUndo2.redoDepth).toBeGreaterThanOrEqual(2);

  await page.keyboard.press(redoKey);
  const afterRedo1 = await snapshot();
  expect(afterRedo1.hasItem).toBe(true);
  expect(afterRedo1.position.x).toBeCloseTo(0, 6);

  await page.keyboard.press(redoKey);
  const afterRedo2 = await snapshot();
  expect(afterRedo2.position).toEqual(moved.position);
  expect(afterRedo2.steps).toBe(moved.steps);
});
