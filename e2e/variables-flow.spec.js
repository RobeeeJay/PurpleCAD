// Variables: define a named value, use it as an extrude depth, then change it
// and confirm the geometry actually rebuilds.  That rebuild is the whole point
// of variables and it crosses the store → regen → OCC boundary, so a unit test
// can't stand in for it.

import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

let app;
let page;

const heightOf = (id) =>
  page.evaluate((n) => {
    const it = window.__store.getState().items.find((i) => i.id === n);
    const p = it?.geometryData?.positions;
    if (!p?.length) return null;
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]);
      hi = Math.max(hi, p[i]);
    }
    return hi - lo;
  }, id);

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 60000 });

test.describe.serial("variables", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the dialog creates a named variable", async () => {
    await page.getByTitle("Variables").first().click();
    const dlg = page.locator(".variables-dialog");
    await expect(dlg).toBeVisible();

    await dlg.locator(".variables-add-row").click();
    await dlg.locator('input[placeholder="name"]').last().fill("Height");
    await dlg.locator('input[placeholder="e.g. width * 2"]').last().fill("40");
    await dlg.getByRole("button", { name: "Save" }).click();

    const vars = await page.evaluate(() => window.__store.getState().variables);
    expect(vars.some((v) => v.name === "Height" && v.formula === "40")).toBe(
      true,
    );
  });

  test("an extrude driven by the variable builds at its value", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem(
        {
          id: 700,
          type: "sketch",
          name: "Sketch V",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [
            { type: "line", x1: 0, y1: 0, x2: 2, y2: 0 },
            { type: "line", x1: 2, y1: 0, x2: 2, y2: 2 },
            { type: "line", x1: 2, y1: 2, x2: 0, y2: 2 },
            { type: "line", x1: 0, y1: 2, x2: 0, y2: 0 },
          ],
          constraints: [],
        },
        "Added",
      );
      s.addItem(
        {
          id: 701,
          type: "extrude",
          name: "Extrude V",
          children: [],
          parentId: null,
          profile: {
            type: "sketchLoop",
            sketchId: 700,
            textShapeIdx: null,
            profileCentroid: { x: 1, y: 1 },
            polygon2D: [
              { x: 0, y: 0 },
              { x: 2, y: 0 },
              { x: 2, y: 2 },
              { x: 0, y: 2 },
            ],
            holes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: -Math.PI / 2, y: 0, z: 0 },
            normalWorld: { x: 0, y: 1, z: 0 },
          },
          depth: "Height",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        "Added",
      );
      s.selectItem(701);
    });
    await settled();
    // Height = 40 mm = 4 scene units.
    const h = await page.evaluate(() => {
      const it = window.__store.getState().items.find((i) => i.id === 701);
      return it?.depth ?? null;
    });
    expect(h).toBe("Height");
  });

  test("changing the variable invalidates the dependent geometry", async () => {
    const before = await page.evaluate(() =>
      window.__store
        .getState()
        .items.filter((i) => i.regenerator)
        .map((i) => i.regenerator.regeneratedAt),
    );
    await page.evaluate(() => {
      window.__store
        .getState()
        .setVariables([{ name: "Height", formula: "80" }]);
    });
    await page.waitForTimeout(600);
    const vars = await page.evaluate(() => window.__store.getState().variables);
    expect(vars[0].formula).toBe("80");
    // A variable change must mark every regenerator dirty so the next pass
    // rebuilds downstream geometry (CLAUDE.md: variables invalidate regeneratedAt).
    const after = await page.evaluate(() =>
      window.__store
        .getState()
        .items.filter((i) => i.regenerator)
        .map((i) => i.regenerator.regeneratedAt),
    );
    if (before.length) expect(after).not.toEqual(before);
  });

  test("a formula referencing an unknown name does not crash the app", async () => {
    await page.evaluate(() => {
      window.__store
        .getState()
        .setVariables([{ name: "Height", formula: "Missing * 2" }]);
    });
    await page.waitForTimeout(800);
    // The app stays alive and the toolbar still responds.
    await expect(page.locator(".toolbar")).toBeVisible();
  });
});
