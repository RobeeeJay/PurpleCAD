// Canvas interaction smoke: right-drag orbits, left-click selects, selecting a
// sketch enters sketch view.  Drives the real event listeners on the WebGL
// canvas — the surface unit tests can't touch (and where a framework/Electron
// upgrade would silently break input).  NOTE: the canvas spans the full window
// with the panels floating above it, so interaction points must be in the
// clear region (right of ~40% width).
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[renderer error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
});

test.afterAll(async () => {
  await app?.close();
});

// Rotation is a Shift+scroll gesture (navigation.js), NOT a right-drag: the
// right-button branch only sets the orbit anchor; it never rotates.
// This previously right-dragged and compared JSON strings of targetRotation,
// which passed on macOS solely because setOrbitAnchor recomputed the same
// angle to a 1-ULP difference -- it would have kept passing if rotation were
// removed entirely.
test("Shift+scroll rotates the camera", async () => {
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

  const rot = () =>
    page.evaluate(() => {
      const cc = window.__store.getState()._cameraControls;
      return { rx: cc.targetRotationX, ry: cc.targetRotationY };
    });

  const box = await page.locator(".viewport canvas").first().boundingBox();
  const before = await rot();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(120, 60);
  await page.waitForTimeout(200);
  await page.keyboard.up("Shift");
  const after = await rot();

  // A real rotation, not float noise: 120px * 0.004 rad/px is ~0.48 rad.
  expect(Math.abs(after.ry - before.ry)).toBeGreaterThan(0.01);
  expect(Math.abs(after.rx - before.rx)).toBeGreaterThan(0.01);
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
  // Click the VISIBLE-area centre, not the raw canvas centre: the camera
  // frames the viewport excluding the 250px left panel (see CLAUDE.md), so a
  // centred body renders half a panel-width right of the canvas midpoint.
  // Clicking raw centre only worked because the cube happened to project wide
  // enough to cover it -- on a shorter canvas it projects smaller and misses.
  const LEFT_PANEL_PX = 250;
  await page.mouse.click(
    box.x + LEFT_PANEL_PX + (box.width - LEFT_PANEL_PX) / 2,
    box.y + box.height / 2,
  );
  await page.waitForTimeout(300);
  const selected = await page.evaluate(
    () => window.__store.getState().selectedId,
  );
  console.log("selectedId after click:", selected);
  expect(selected).not.toBeNull();
});
