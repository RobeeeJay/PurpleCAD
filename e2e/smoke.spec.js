import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
let app;
let page;
const securityWarnings = [];

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  // Surface renderer console errors in the test output for easier debugging,
  // and collect Electron's security warnings (they only print in unpackaged
  // runs — exactly what this suite is).
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[renderer error] ${msg.text()}`);
    if (/Electron Security Warning|Content-Security-Policy/i.test(msg.text()))
      securityWarnings.push(msg.text());
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("app boots and the toolbar renders", async () => {
  // The React Toolbar root mounts once the renderer bundle has loaded.
  await expect(page.locator(".toolbar")).toBeVisible();
});

test("every toolbar button and dropdown item has a hover tooltip", async () => {
  const missing = await page.evaluate(
    () =>
      [...document.querySelectorAll(".toolbar button")]
        .filter((b) => !b.title?.trim())
        .map((b) => b.textContent?.trim() || b.className)
        .slice(0, 10), // enough to name the offenders
  );
  expect(missing).toEqual([]);

  // Dropdown menus render on demand — open each known trigger and audit its
  // items the same way.
  for (const trigger of ["Save / Export", "Load / Import"]) {
    const btn = page.getByTitle(trigger, { exact: false }).first();
    if ((await btn.count()) === 0) continue;
    await btn.click();
    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".toolbar-dropdown-item")].map((b) => ({
        label: b.textContent?.trim().slice(0, 30),
        titled: !!b.title?.trim(),
      })),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.titled, `"${it.label}"`).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.click(600, 400); // close the menu
  }
});

test("no Electron security warnings (CSP present, no unsafe-eval)", async () => {
  // index.html ships a strict CSP; a missing policy (or one with
  // unsafe-eval) makes unpackaged Electron print a console warning.
  await page.waitForTimeout(500); // warnings print shortly after load
  expect(securityWarnings).toEqual([]);
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

test("duplicating a project copies its timeline and data", async () => {
  const result = await page.evaluate(() => {
    const s = window.__store.getState();
    s.addItem({
      id: 7,
      name: "Cube 7",
      type: "cube",
      children: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const before = window.__store.getState();
    const srcId = before.activeProjectId;
    const src = before.projects.find((p) => p.id === srcId);
    before.duplicateProject(srcId);
    const after = window.__store.getState();
    const copy = after.projects.find(
      (p) => p.id !== srcId && p.name === `${src.name} copy`,
    );
    return {
      copied: !!copy,
      stillActive: after.activeProjectId === srcId,
      count: after.projects.length,
      prevCount: before.projects.length,
    };
  });
  expect(result.copied).toBe(true);
  expect(result.stillActive).toBe(true);
  expect(result.count).toBe(result.prevCount + 1);

  // Switching to the copy loads the duplicated timeline (the cube is there).
  const inCopy = await page.evaluate(async () => {
    const s = window.__store.getState();
    const srcId = s.activeProjectId;
    const copy = s.projects.find((p) => p.id !== srcId);
    await s.switchProject(copy.id);
    const items = window.__store.getState().items;
    return items.some((i) => i.name === "Cube 7");
  });
  expect(inCopy).toBe(true);
});
