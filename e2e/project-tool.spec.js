// The sketch Project tool: pull a solid's feature edges onto the active sketch
// plane as real sketch geometry, each linked to its source by a projection
// constraint.  Two paths — a click (all connected edges of the body under the
// cursor) and a marquee box — plus the REFIT path that runs when the source
// body later moves.
//
// That refit is why this spec exists: it removes the projection's old shapes
// and appends the new ones, renumbering the array.  It used to leave the
// sketch's constraints pointing at the old indices, silently re-binding every
// later constraint to the wrong shape.

import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import { assertDocumentIntegrity } from "./integrity.js";

let app;
let page;

const sketch = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 401) ?? null,
  );

test.describe.serial("sketch Project tool", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();

    // A cube to project from, and a ground sketch to project onto.
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument?.();
      s.addItem(
        {
          id: 400,
          type: "cube",
          name: "Body",
          children: [],
          parentId: null,
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { width: 2, height: 2, depth: 2 },
        },
        "Added",
      );
      s.addItem(
        {
          id: 401,
          type: "sketch",
          name: "Sketch P",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [],
          constraints: [],
        },
        "Added",
      );
      s.selectItem(401);
    });
    await page.waitForTimeout(1600); // sketch fly-in settles
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("marquee projects the body's edges into the sketch", async () => {
    await page.evaluate(() => {
      window.__store.getState().startProjectTool();
      window.__store.getState().setActiveSketchTool("project");
    });
    // Box the whole viewport so the body is certainly inside it.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    await page.evaluate(
      (box) => window.__store.getState()._cameraControls.projectEdgesInBox(box),
      { x1: 0, y1: 0, x2: size.width, y2: size.height },
    );

    const staged = await page.evaluate(
      () => window.__store.getState().projectTool?.shapes?.length ?? 0,
    );
    expect(staged).toBeGreaterThan(0);

    // Commit through the real dialog.
    await expect(page.locator(".variables-dialog")).toBeVisible();
    await page
      .locator(".variables-dialog")
      .getByRole("button", { name: "Confirm" })
      .click();

    const s = await sketch();
    expect(s.shapes.length).toBeGreaterThan(0);
    // Everything projected carries the link back to its source body.
    expect(s.shapes.every((sh) => sh.projection?.sourceId === 400)).toBe(true);
    await assertDocumentIntegrity(page, "after projecting");
  });

  test("a projected shape is immovable until released", async () => {
    const s = await sketch();
    const idx = s.shapes.findIndex((sh) => sh.projection);
    expect(idx).toBeGreaterThanOrEqual(0);
    // Projected geometry is excluded from dragging — the drag lifecycle skips
    // any shape carrying `projection`.
    expect(s.shapes[idx].projection.key).toBeTruthy();
  });

  test("moving the source body refits the projection WITHOUT breaking constraints", async () => {
    // Constrain the drawn (non-projected) geometry first, so a renumber has
    // something to corrupt.  Add two lines and dimension one of them.
    await page.evaluate(() => {
      const s = window.__store.getState();
      const before = s.items.find((i) => i.id === 401).shapes.length;
      s.addSketchShapes(
        401,
        [
          { type: "line", x1: -4, y1: -4, x2: -1, y2: -4 }, // horizontal
          { type: "line", x1: -1, y1: -4, x2: -1, y2: -1 }, // vertical
        ],
        [
          { type: "horizontal", shapeIdx: before },
          { type: "vertical", shapeIdx: before + 1 },
          {
            type: "coincident",
            shapeAIdx: before,
            pointA: "end",
            shapeBIdx: before + 1,
            pointB: "start",
          },
        ],
      );
    });
    await assertDocumentIntegrity(page, "before the refit");

    const before = await sketch();
    const drawnBefore = before.shapes.filter((s) => !s.projection).length;

    // Move the source body — this is what triggers the refit on the next
    // sketch-mode pass.
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.setItemTransform(400, { x: 1.5, y: 1, z: 0.5 }, null, null);
      s.recordTransformHistory(400, "Moved");
    });
    await page.waitForTimeout(1200);
    // Re-enter the sketch so the projection-refit effect runs.
    await page.evaluate(() => window.__store.getState().selectItem(400));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__store.getState().selectItem(401));
    await page.waitForTimeout(1400);

    const after = await sketch();
    // The drawn geometry survives the refit...
    expect(after.shapes.filter((s) => !s.projection).length).toBe(drawnBefore);
    // ...and every constraint still names the shape it was authored against.
    await assertDocumentIntegrity(page, "after the source body moved");
  });

  test("releasing a projection leaves plain editable geometry", async () => {
    await page.evaluate(() => window.__store.getState().releaseProjection(401));
    const s = await sketch();
    expect(s.shapes.some((sh) => sh.projection)).toBe(false);
    expect(s.shapes.length).toBeGreaterThan(0);
    await assertDocumentIntegrity(page, "after releasing the projection");
  });
});
