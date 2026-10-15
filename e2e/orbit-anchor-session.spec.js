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

// Zoom in with a two-finger pinch, the one zoom that works on every platform
// (Ctrl+wheel zooms only on a Mac).
const pinchIn = async (page) => {
  const box = await page.locator(".viewport canvas").boundingBox();
  const cx = box.x + 125 + box.width / 2;
  const cy = box.y + box.height / 2;
  const pointer = (type, id, x, y) =>
    page.evaluate(
      ([type, id, x, y]) =>
        document.querySelector(".viewport canvas").dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            clientX: x,
            clientY: y,
            buttons: type === "pointerup" ? 0 : 1,
            bubbles: true,
            cancelable: true,
          }),
        ),
      [type, id, x, y],
    );
  await pointer("pointerdown", 1, cx - 40, cy);
  await pointer("pointerdown", 2, cx + 40, cy);
  for (let i = 1; i <= 8; i++) {
    await pointer("pointermove", 1, cx - 40 - i * 10, cy);
    await pointer("pointermove", 2, cx + 40 + i * 10, cy);
  }
  await pointer("pointerup", 1, cx - 120, cy);
  await pointer("pointerup", 2, cx + 120, cy);
};

test("panning then Shift+scroll rotating still re-anchors the pivot", async () => {
  // A pan carries the pivot with the view, at its depth, so a rotate after it
  // re-anchors only when what's under the crosshair is at a different depth
  // by more than 5% of the view distance.  Zoomed in, panning down brings a
  // taller part of the body under it.  This spec used to pan at Home's zoom
  // and passed only while the document was still rebuilding: on the settled
  // part no pan at that zoom crosses the 5%, measured both ways (pivot moved
  // 0.000 settled; 3.511 here, and 0.000 here with re-anchoring disabled).
  await loadSettled(page, "test-files/bad-cut-extrude.pcad");
  await page.locator(".home-button").click();
  await page.waitForTimeout(400);
  await pinchIn(page);
  await page.waitForTimeout(100);

  await page.mouse.move(700, 400);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(20, 0);
  await page.waitForTimeout(20);
  await page.keyboard.up("Shift");
  // Past the 400 ms session timeout, so the next rotate starts a new session.
  await page.waitForTimeout(500);

  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(500);
  const afterPan = await getTarget(page);

  await page.keyboard.down("Shift");
  await page.mouse.wheel(20, 0);
  await page.waitForTimeout(20);
  const afterRotate = await getTarget(page);
  await page.keyboard.up("Shift");

  const moved = Math.hypot(
    afterRotate.x - afterPan.x,
    afterRotate.y - afterPan.y,
    afterRotate.z - afterPan.z,
  );
  expect(moved, "pivot moved by the rotate after the pan").toBeGreaterThan(0.1);
});
