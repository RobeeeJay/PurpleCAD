// Scene inspector: the Objects-panel debug listing.  Beyond "it opens", the
// thing worth pinning is that it actually SURFACES a mis-bound constraint —
// that's its whole reason for existing, and it's the same check the e2e
// integrity helper relies on.

import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

let app;
let page;

const openInspector = () =>
  page.locator(".tree-view-header .tree-header-btn").first().click();
// The dialog closes via its × (no Escape handler — matches the other dialogs).
const closeInspector = () =>
  page.locator(".scene-inspector-dialog .projects-close").click();

test.describe.serial("scene inspector", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("lists every object with its identity and mesh counts", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument?.();
      for (const [id, name] of [
        [600, "Box A"],
        [601, "Box B"],
      ])
        s.addItem(
          {
            id,
            type: "cube",
            name,
            children: [],
            parentId: null,
            position: { x: id - 600, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            dimensions: { width: 2, height: 2, depth: 2 },
          },
          "Added",
        );
    });
    await page.waitForTimeout(500);
    await openInspector();

    const dlg = page.locator(".scene-inspector-dialog");
    await expect(dlg).toBeVisible();
    await expect(page.locator(".si-card")).toHaveCount(2);
    await expect(dlg).toContainText("Box A");
    // Live mesh facts come from the renderer, not the store.
    await expect(page.locator(".si-card").first()).toContainText("verts");

    // Expanding shows the transform readout.
    await page.locator(".si-card").first().locator(".si-card-head").click();
    await expect(page.locator(".si-card-body").first()).toContainText(
      "Position",
    );
    await expect(page.locator(".si-card-body").first()).toContainText(
      "internal",
    );
  });

  test("the filter narrows the list", async () => {
    await page.locator(".si-filter").fill("Box B");
    await expect(page.locator(".si-card")).toHaveCount(1);
    await page.locator(".si-filter").fill("");
    await expect(page.locator(".si-card")).toHaveCount(2);
    await closeInspector();
  });

  test("flags a sketch whose constraints are bound to the wrong shape", async () => {
    // The real reported corruption: a projection refit renumbered Sketch 3's
    // shapes without remapping its constraints.
    const doc = JSON.parse(
      fs.readFileSync("test-files/circle-sketch-move.pcad", "utf8"),
    );
    await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
    await expect(page.getByText(/Recalculating/)).toBeHidden({
      timeout: 60000,
    });
    await openInspector();

    const warned = page.locator(".si-card-warn");
    await expect(warned).toHaveCount(1);
    await expect(warned).toContainText("reference the wrong shape");

    await warned.locator(".si-card-head").click();
    // Each offending constraint row is called out individually, with a reason.
    const bad = page.locator("tr.si-bad");
    expect(await bad.count()).toBeGreaterThan(1);
    await expect(bad.first()).toContainText("line is");
    await closeInspector();
  });

  test("a healthy document raises no warnings", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument?.();
      s.addItem(
        {
          id: 610,
          type: "sketch",
          name: "Clean",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [
            { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
            { type: "line", x1: 4, y1: 0, x2: 4, y2: 4 },
          ],
          constraints: [
            { type: "horizontal", shapeIdx: 0 },
            { type: "vertical", shapeIdx: 1 },
          ],
        },
        "Added",
      );
    });
    await page.waitForTimeout(400);
    await openInspector();
    await expect(page.locator(".si-card")).toHaveCount(1);
    await expect(page.locator(".si-card-warn")).toHaveCount(0);
    await closeInspector();
  });
});
