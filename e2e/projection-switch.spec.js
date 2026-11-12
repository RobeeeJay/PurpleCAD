// Switching between perspective and orthographic keeps the model the same
// size on screen at the pivot (useViewportCamera.js), and the pivot in the
// same place: the centre of the area right of the left panel
// (sceneSetup.js#panelAwareLookAt).  The orthographic view
// used to be a fixed 20 units tall, so objects jumped in size on a switch made
// anywhere but one particular distance.  The maths is checked in
// projectionSwitchSize.test.js; this checks the hook that applies it.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible({ timeout: 30000 });
});

test.afterAll(async () => {
  await app?.close();
});

// Screen pixels per world unit at the pivot (along the camera's own up), and
// where on the canvas the pivot is.
const atPivot = () =>
  page.evaluate(() => {
    const c = window.__store.getState()._cameraControls;
    const { cam } = c.getOrbitIndicator();
    const pivot = c.getViewTarget();
    const h = document.querySelector(".viewport canvas").clientHeight;
    const up = new cam.up.constructor(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.updateMatrixWorld();
    const eps = 1e-3;
    const a = pivot.clone().project(cam);
    const b = pivot.clone().addScaledVector(up, eps).project(cam);
    return {
      size: (Math.hypot(b.x - a.x, b.y - a.y) * h) / 2 / eps,
      // Where the pivot sits across the canvas, in pixels from its left edge.
      x:
        ((a.x + 1) / 2) *
        document.querySelector(".viewport canvas").clientWidth,
    };
  });

const setProjection = async (mode) => {
  await page.evaluate(
    (m) => window.__store.getState().setProjectionMode(m),
    mode,
  );
  await page.waitForTimeout(200);
};

test("the model keeps its size and place through a switch, both ways, at any zoom", async () => {
  await page.locator(".home-button").click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__store.getState().setWheelDevice("mouse"));
  await page.mouse.move(700, 400);
  for (const notches of [0, -4, 6]) {
    for (let i = 0; i < Math.abs(notches); i++)
      await page.mouse.wheel(0, Math.sign(notches) * 100);
    await page.waitForTimeout(600);
    const persp = await atPivot();
    await setProjection("orthographic");
    const ortho = await atPivot();
    await page.mouse.wheel(0, -100); // zoom the orthographic view itself
    await page.waitForTimeout(600);
    const orthoZoomed = await atPivot();
    await setProjection("perspective");
    const back = await atPivot();
    const detail = JSON.stringify({ notches, persp, ortho, orthoZoomed, back });
    expect(Math.abs(ortho.size / persp.size - 1), detail).toBeLessThan(0.02);
    expect(Math.abs(back.size / orthoZoomed.size - 1), detail).toBeLessThan(
      0.02,
    );
    // And it stays put: orthographic used to skip the left panel's
    // compensation, so the pivot jumped half the panel's width (125 px).
    expect(Math.abs(ortho.x - persp.x), detail).toBeLessThan(1);
    expect(Math.abs(back.x - orthoZoomed.x), detail).toBeLessThan(1);
  }
  await page.evaluate(() => window.__store.getState().setWheelDevice("auto"));
});
