import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let app;
let page;

test.beforeAll(async () => {
  // Launch the real Electron app at the project root (package.json `main` →
  // electron/main.cjs).  Leave ELECTRON_START_URL unset so it loads the built
  // renderer from dist/ via app://, and strip ELECTRON_RUN_AS_NODE (the test
  // runner's node sets it, which would make Electron run as a plain node
  // process instead of opening a window).
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [projectRoot], env });
  page = await app.firstWindow();
  // Surface renderer console errors in the test output for easier debugging.
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[renderer error] ${msg.text()}`);
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("app boots and the toolbar renders", async () => {
  // The React Toolbar root mounts once the renderer bundle has loaded.
  await expect(page.locator(".toolbar")).toBeVisible();
});

test("the OCC IPC bridge answers a push/pull request end-to-end", async () => {
  // Calls the real renderer → main-process IPC → native OCC addon path. This
  // is the exact surface that produced "No handler registered for
  // occ:pushPullFaces" — a missing handler or an addon failure shows up here,
  // where node-only unit tests structurally can't.
  const result = await page.evaluate(async () => {
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    return window.electronAPI.invokeOcc("pushPullFaces", {
      source: cube,
      subGeo: { faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }] },
      distance: 0.5,
      allItems: [cube],
      printPrecision: 0.01,
    });
  });

  expect(result).toBeTruthy();
  expect(result.geometryData.positions.length).toBeGreaterThan(0);
  // A 2-unit cube pulled +0.5 on its +Y face is 2.5 tall — confirms the addon
  // actually transformed the geometry, not just returned the input.
  const ys = result.geometryData.positions.filter((_, i) => i % 3 === 1);
  const heightY = Math.max(...ys) - Math.min(...ys);
  expect(heightY).toBeCloseTo(2.5, 2);
});

test("the store test hook is exposed for state-driven assertions", async () => {
  // VITE_E2E build exposes window.__store so future tests can read state /
  // drive actions instead of asserting on opaque WebGL canvas pixels.
  const itemCount = await page.evaluate(
    () => window.__store?.getState().items.length ?? -1,
  );
  expect(itemCount).toBeGreaterThanOrEqual(0);
});
