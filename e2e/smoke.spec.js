import { test, expect } from "./fixtures.js";
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

  // A title only shows if hover reaches the element: pointer-events:none on
  // disabled buttons silently killed every disabled-tool tooltip.
  const hoverBlocked = await page.evaluate(() =>
    [...document.querySelectorAll(".toolbar button")]
      .filter((b) => getComputedStyle(b).pointerEvents === "none")
      .map((b) => b.title || b.className)
      .slice(0, 10),
  );
  expect(hoverBlocked).toEqual([]);

  // Dropdown menus render on demand — open each known trigger and audit its
  // items the same way.
  for (const trigger of ["Save / Export", "Load / Import"]) {
    const btn = page.getByTitle(trigger, { exact: false }).first();
    if ((await btn.count()) === 0) continue;
    await btn.click();
    await page.locator(".toolbar-dropdown-item").first().waitFor();
    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".toolbar-dropdown-item")].map((b) => ({
        label: b.textContent?.trim().slice(0, 30),
        // The tooltip layer parks a hovered element's title in data-tooltip;
        // either location counts as "has a tooltip".
        titled: !!(b.title?.trim() || b.dataset.tooltip?.trim()),
      })),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.titled, `"${it.label}"`).toBe(true);
    await btn.click(); // toggle the menu closed
    await page
      .locator(".toolbar-dropdown-item")
      .first()
      .waitFor({ state: "detached" });
  }
});

test("hovering a toolbar button displays the app tooltip", async () => {
  for (const name of ["Chamfer", "Bevel"]) {
    const btn = page.getByTitle(name, { exact: false }).first();
    const box = await btn.boundingBox();
    // Approach in steps from elsewhere — the tooltip layer arms on mousemove,
    // and a same-position "move" fires no event (the flake).
    await page.mouse.move(10, 400);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 4,
    });
    await expect(page.locator(".app-tooltip.visible")).toBeVisible({
      timeout: 2000,
    });
    await expect(page.locator(".app-tooltip")).toContainText(name);
    // Moving away hides it and restores the title attribute for the next
    // audit / assistive tech.
    await page.mouse.move(10, 400);
    await expect(page.locator(".app-tooltip.visible")).toBeHidden();
    expect(
      await page.evaluate(
        (n) =>
          [...document.querySelectorAll(".toolbar button")].some((b) =>
            b.title.startsWith(n),
          ),
        name,
      ),
    ).toBe(true);
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

test("the corner tag shows scene totals and memory beside the version", async () => {
  await page.evaluate(() => {
    window.__store.getState().addItem({
      id: 8,
      name: "Cube 8",
      type: "cube",
      children: [],
      position: { x: 0, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });
  await expect(page.locator(".version-tag")).toContainText("faces", {
    timeout: 5000,
  });
  const text = await page.locator(".version-tag").textContent();
  expect(text).toMatch(/\d[\d.km]* faces/i);
  expect(text).toMatch(/\d[\d.km]* pts/i);
  expect(text).toMatch(/\d+ MB/);
  expect(text).toMatch(/v\d+\.\d+/);

  // Hovering lifts the tag to full-contrast black-on-light for readability.
  const box = await page.locator(".version-tag").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 3,
  });
  await expect
    .poll(() =>
      page.locator(".version-tag").evaluate((el) => getComputedStyle(el).color),
    )
    .toBe("rgb(0, 0, 0)");
  await page.mouse.move(400, 300);
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

test("the About box names the license and opens its full text", async () => {
  await page.evaluate(() => window.__store.getState().setAboutDialogOpen(true));
  await expect(page.locator(".about-license")).toHaveText(
    "License: PolyForm Noncommercial 1.0.0",
  );
  await page
    .getByRole("button", { name: "PolyForm Noncommercial 1.0.0" })
    .click();
  const dialog = page.getByRole("dialog", { name: "License" });
  // The repository's own LICENSE.md, Required Notice lines first.
  await expect(dialog).toContainText(
    "Required Notice: Copyright (c) 2026 Robeena Shepherd",
  );
  await expect(dialog).toContainText("PolyForm Noncommercial License 1.0.0");
  await dialog.getByRole("tab", { name: "Trademarks" }).click();
  await expect(dialog).toContainText("Takes its own name, logo and icons.");
  await dialog.getByRole("tab", { name: "Open CASCADE" }).click();
  await expect(dialog).toContainText("GNU LESSER GENERAL PUBLIC LICENSE");
  // Closing the license leaves the About box open behind it.
  await dialog.getByTitle("Close").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".about-license")).toBeVisible();
  await page.evaluate(() =>
    window.__store.getState().setAboutDialogOpen(false),
  );
});
