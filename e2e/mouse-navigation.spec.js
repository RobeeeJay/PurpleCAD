// A mouse navigates like a trackpad: dragging with the right button pans,
// orbits with Shift, and pans on the screen plane with Cmd (Ctrl off a Mac),
// and the wheel zooms -- eased over a few frames rather than in jumps.  The
// drags go through Playwright's real mouse, so the browser's own right-button
// handling (the context menu) is part of what is tested.
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

const view = () =>
  page.evaluate(() => {
    const c = window.__store.getState()._cameraControls;
    const t = c.getViewTarget();
    const p = c.getCameraPosition();
    const d = Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
    return {
      target: { x: t.x, y: t.y, z: t.z },
      dir: { x: (p.x - t.x) / d, y: (p.y - t.y) / d, z: (p.z - t.z) / d },
      dist: d,
    };
  });
const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const screenPanKey = process.platform === "darwin" ? "Meta" : "Control";

async function home() {
  await page.locator(".home-button").click();
  await page.waitForTimeout(500);
}

async function rightDrag(dx, dy, key) {
  await page.mouse.move(700, 400);
  if (key) await page.keyboard.down(key);
  await page.mouse.down({ button: "right" });
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(700 + (dx * i) / 10, 400 + (dy * i) / 10);
  await page.mouse.up({ button: "right" });
  if (key) await page.keyboard.up(key);
  await page.waitForTimeout(100);
}

test("a right drag pans the view across the ground", async () => {
  await home();
  const before = await view();
  await rightDrag(150, 0);
  const after = await view();
  expect(
    moved(after.target, before.target),
    JSON.stringify({ before, after }),
  ).toBeGreaterThan(0.1);
  // A pan slides the view: the camera keeps its distance and direction.
  expect(after.dist).toBeCloseTo(before.dist, 4);
  expect(moved(after.dir, before.dir)).toBeLessThan(1e-6);
  // A ground pan keeps the pivot on its ground plane.
  expect(after.target.y).toBeCloseTo(before.target.y, 6);
});

test("Shift with a right drag orbits about the pivot", async () => {
  await home();
  // Orbit sessions anchor the pivot first; read it after that has happened.
  await rightDrag(5, 0, "Shift");
  const before = await view();
  await rightDrag(150, 0, "Shift");
  const after = await view();
  expect(
    moved(after.dir, before.dir),
    JSON.stringify({ before, after }),
  ).toBeGreaterThan(0.1);
  expect(after.dist).toBeCloseTo(before.dist, 4);
});

test(`${screenPanKey} with a right drag pans up and down the screen`, async () => {
  await home();
  const before = await view();
  await rightDrag(0, 120, screenPanKey);
  const after = await view();
  // The ground pan never changes height; the screen-plane pan does.
  expect(
    Math.abs(after.target.y - before.target.y),
    JSON.stringify({ before, after }),
  ).toBeGreaterThan(0.1);
  expect(after.dist).toBeCloseTo(before.dist, 4);
});

test("the mouse wheel zooms in by easing, not in one jump", async () => {
  await page.evaluate(() => window.__store.getState().setWheelDevice("mouse"));
  await home();
  const before = await view();
  // Record the camera distance on every frame from now, then send one real
  // notch: Playwright's wheel is a notched mouse wheel (wheelDeltaY 120).
  await page.evaluate(() => {
    const c = window.__store.getState()._cameraControls;
    window.__dists = [];
    const frame = () => {
      window.__dists.push(c.getCameraPosition().distanceTo(c.getViewTarget()));
      if (window.__dists.length < 40) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.evaluate(() => window.__dists.length)).toBe(40);
  const dists = await page.evaluate(() => window.__dists);
  const detail = JSON.stringify({ before: before.dist, dists });
  // Lands one notch closer (ZOOM_PER_NOTCH, 1.15), about the same pivot...
  expect(dists.at(-1), detail).toBeCloseTo(before.dist / 1.15, 3);
  expect(moved((await view()).target, before.target)).toBeLessThan(1e-6);
  // ...through several distances between, each closer than the last.
  const between = dists.filter(
    (d) => d < before.dist - 1e-6 && d > dists.at(-1) + 1e-6,
  );
  expect(between.length, detail).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < dists.length; i++)
    expect(dists[i], detail).toBeLessThanOrEqual(dists[i - 1] + 1e-9);
  await page.evaluate(() => window.__store.getState().setWheelDevice("auto"));
});

test("the Scroll wheel setting cycles Auto, Mouse and Trackpad into the store", async () => {
  await page.evaluate(() =>
    window.__store.getState().setSettingsDialogOpen(true),
  );
  const button = page.locator(".wheel-device");
  await expect(button).toHaveText("Auto");
  await button.click();
  await expect(button).toHaveText("Mouse");
  await button.click();
  await expect(button).toHaveText("Trackpad");
  const saved = await page.evaluate(
    () => window.__store.getState().wheelDevice,
  );
  expect(saved).toBe("trackpad");
  await button.click();
  await expect(button).toHaveText("Auto");
  await page.evaluate(() =>
    window.__store.getState().setSettingsDialogOpen(false),
  );
});

// Home animates for 300 ms, and its end used to set the orbit angles back to
// its own pose -- undoing any navigation made meanwhile.  On a slow machine
// that landed in the middle of touch-input's one-finger orbit.
test("an orbit made while Home is animating is kept", async () => {
  await home();
  const atHome = await view();
  await rightDrag(150, 0, "Shift"); // somewhere else, for Home to return from
  await page.evaluate(() => window.__store.getState()._cameraControls.home());
  expect(
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.isCameraAnimating(),
    ),
    "Home should still be animating when the drag starts",
  ).toBe(true);
  await rightDrag(150, 0, "Shift");
  await page.waitForTimeout(600);
  const after = await view();
  expect(
    moved(after.dir, atHome.dir),
    JSON.stringify({ atHome, after }),
  ).toBeGreaterThan(0.1);
});

test("a right click without a drag does not move the view", async () => {
  await home();
  const before = await view();
  await rightDrag(1, 0);
  const after = await view();
  // The click may re-anchor the pivot, but never slides or turns the camera.
  expect(moved(after.dir, before.dir)).toBeLessThan(0.05);
});
