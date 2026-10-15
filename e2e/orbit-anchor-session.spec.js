// Shift+scroll orbit re-anchors the pivot to whatever's under the (panel-
// aware) crosshair whenever a NEW rotate "session" starts (see navigation.js
// targetAnchorStale). That must only happen after something has actually
// moved the view (a pan) — not merely because the user paused mid-gesture,
// which restarts a session too (the 400ms shiftScrollSessionTimer). Re-
// sampling the crosshair ray while nothing moved traces a cone around the
// true pivot (the ray isn't the rotation axis) and lands on a slightly
// different point every time, at a magnitude that scales with distance —
// "rotate, pause half a second, rotate again jumps the view".
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

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

// Load the document and wait for its rebuild to finish.  Rotating while it
// ran was the cause of this spec's intermittent failure: the first session
// anchored on whatever was built so far, and the next one, after the pause,
// on the finished body -- a real re-anchor (5.24 to 9.43 every time), not a
// pause artefact.  It failed or passed by how fast the machine rebuilt.
const loadSettled = async (page, file) => {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  await page.waitForTimeout(500);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          return (
            s.pendingOperations === 0 &&
            (s.regenProgress == null || s.regenProgress.total === 0)
          );
        }),
      { timeout: 60000 },
    )
    .toBe(true);
};

const getTarget = (page) =>
  page.evaluate(() =>
    window.__store.getState()._cameraControls.getViewTarget(),
  );

test("pausing mid Shift+scroll rotate does not move the pivot", async () => {
  await loadSettled(page, "test-files/bad-cut-extrude.pcad");
  await page.locator(".home-button").click();
  await page.waitForTimeout(400);

  await page.mouse.move(700, 400);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(20, 0);
  await page.waitForTimeout(20);
  const beforePause = await getTarget(page);

  // Longer than the 400ms session timeout — starts a NEW rotate session.
  await page.waitForTimeout(500);
  await page.mouse.wheel(20, 0);
  await page.waitForTimeout(20);
  const afterPause = await getTarget(page);
  await page.keyboard.up("Shift");

  expect(afterPause.x).toBeCloseTo(beforePause.x, 6);
  expect(afterPause.y).toBeCloseTo(beforePause.y, 6);
  expect(afterPause.z).toBeCloseTo(beforePause.z, 6);
});

test("panning then Shift+scroll rotating still re-anchors the pivot", async () => {
  await loadSettled(page, "test-files/bad-cut-extrude.pcad");
  await page.locator(".home-button").click();
  await page.waitForTimeout(400);

  await page.mouse.move(700, 400);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(60, 0);
    await page.waitForTimeout(20);
  }
  const afterPan = await getTarget(page);

  await page.keyboard.down("Shift");
  await page.mouse.wheel(20, 0);
  await page.waitForTimeout(20);
  const afterRotate = await getTarget(page);
  await page.keyboard.up("Shift");

  // The pivot SHOULD move to re-centre on whatever's now under the crosshair
  // — a pan genuinely relocated the view, unlike a mere pause.
  const moved = Math.hypot(
    afterRotate.x - afterPan.x,
    afterRotate.y - afterPan.y,
    afterRotate.z - afterPan.z,
  );
  expect(moved).toBeGreaterThan(0.1);
});
