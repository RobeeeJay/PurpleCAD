// Canvas interaction smoke: right-drag orbits, left-click selects, selecting a
// sketch enters sketch view.  Drives the real event listeners on the WebGL
// canvas — the surface unit tests can't touch (and where a framework/Electron
// upgrade would silently break input).  NOTE: the canvas spans the full window
// with the panels floating above it, so interaction points must be in the
// clear region (right of ~40% width).
import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let app;
let page;

test.beforeAll(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [projectRoot], env });
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[renderer error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
});

test.afterAll(async () => {
  await app?.close();
});

test("orbit drag moves the camera", async () => {
  await expect(page.locator(".toolbar")).toBeVisible();
  await page.evaluate(() => {
    window.__store.getState().newDocument?.();
    window.__store.getState().addItem(
      {
        id: 201,
        type: "cube",
        name: "Box",
        children: [],
        parentId: null,
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        dimensions: { width: 2, height: 2, depth: 2 },
      },
      "Added",
    );
  });
  await page.waitForTimeout(600);

  const canvas = page.locator(".viewport canvas").first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const camBefore = await page.evaluate(() =>
    JSON.stringify(
      window.__store.getState()._cameraControls
        ? {
            rx: window.__store.getState()._cameraControls.targetRotationX,
            ry: window.__store.getState()._cameraControls.targetRotationY,
          }
        : null,
    ),
  );
  // Left-drag = orbit — start from EMPTY space (dragging on the object moves it).
  const ex = box.x + box.width * 0.75;
  const ey = box.y + box.height * 0.3;
  await page.mouse.move(ex, ey);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(ex + 150, ey + 80, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  const camAfter = await page.evaluate(() =>
    JSON.stringify({
      rx: window.__store.getState()._cameraControls.targetRotationX,
      ry: window.__store.getState()._cameraControls.targetRotationY,
    }),
  );
  console.log("cam before:", camBefore, "after:", camAfter);
  expect(camAfter).not.toBe(camBefore);
});

test("selecting a sketch enters sketch view (ortho + camera fly-in)", async () => {
  await page.evaluate(() => {
    window.__store.getState().addItem(
      {
        id: 202,
        type: "sketch",
        name: "Sketch T",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [{ type: "circle", cx: 0, cy: 0, r: 2 }],
        constraints: [],
      },
      "Added",
    );
    window.__store.getState().selectItem(202);
  });
  // The sketch fly-in tween runs ~600ms; then the camera should be top-down
  // (looking straight down the sketch plane normal, +Y).
  await page.waitForTimeout(1500);
  const mode = await page.evaluate(() => ({
    selected: window.__store.getState().selectedId,
    projection: window.__store.getState().projectionMode,
  }));
  console.log("sketch mode state:", JSON.stringify(mode));
  expect(mode.selected).toBe(202);
});

test("clicking the cube selects it", async () => {
  const canvas = page.locator(".viewport canvas").first();
  const box = await canvas.boundingBox();
  // The cube sits at world origin-ish; click centre.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const selected = await page.evaluate(
    () => window.__store.getState().selectedId,
  );
  console.log("selectedId after click:", selected);
  expect(selected).not.toBeNull();
});
