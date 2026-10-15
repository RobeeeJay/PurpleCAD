// Sketch reference underlay: a PNG/JPEG laid on the sketch plane to trace over.
// Covers the whole lifecycle — place, size, re-open to edit, remove — plus the
// invariant that matters most: the image is a GUIDE, never geometry, so it must
// not appear in `shapes` or affect anything that reads them.

import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { assertDocumentIntegrity } from "./integrity.js";

let app;
let page;

// A 2x1 red PNG — aspect 0.5, so the height should come out half the width.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFUlEQVR4nGP8z8Dwn4GBgYGJAQ0AABZ0AQdgLj7lAAAAAElFTkSuQmCC";

const sketch = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 500) ?? null,
  );

test.describe.serial("sketch underlay", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument?.();
      s.addItem(
        {
          id: 500,
          type: "sketch",
          name: "Sketch U",
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
      s.selectItem(500);
    });
    await page.waitForTimeout(1400);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the placement bar appears and commits an underlay at a real width", async () => {
    await page.evaluate(
      ([dataUrl]) => {
        window.__store.getState().setUnderlayImport({
          sketchId: 500,
          dataUrl,
          name: "guide",
          imageAspect: 0.5,
          widthMm: 100,
          offsetX: 0,
          offsetY: 0,
          rotationDeg: 0,
          opacity: 0.5,
        });
      },
      [PNG],
    );

    // The real placement bar renders, seeded from those values.
    await expect(page.locator(".sketch-placement-hint")).toBeVisible();
    const widthInput = page
      .locator(".sketch-distance-input-overlay input")
      .first();
    await widthInput.fill("60");
    await page
      .locator(".sketch-distance-input-overlay")
      .getByRole("button", { name: "Confirm" })
      .click();

    const s = await sketch();
    expect(s.underlay).toBeTruthy();
    expect(s.underlay.widthMm).toBeCloseTo(60, 6);
    expect(s.underlay.imageAspect).toBeCloseTo(0.5, 6);
    // It is NOT geometry.
    expect(s.shapes.length).toBe(0);
  });

  test("the underlay survives a save/reload round-trip", async () => {
    const doc = await page.evaluate(() => {
      const s = window.__store.getState();
      return JSON.parse(
        JSON.stringify({
          version: 1,
          history: s.history,
          activeHistoryId: s.activeHistoryId,
          variables: s.variables,
        }),
      );
    });
    // The underlay has to live in the sketch's CREATE entry, or a reload loses it.
    const entry = doc.history.find((h) => h.instruction?.item?.id === 500);
    expect(entry.instruction.item.underlay?.widthMm).toBeCloseTo(60, 6);

    await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
    await page.waitForTimeout(600);
    const reloaded = await sketch();
    expect(reloaded.underlay.widthMm).toBeCloseTo(60, 6);
  });

  test("re-opening edits in place, and Remove drops the image", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.selectItem(500);
      const item = s.items.find((i) => i.id === 500);
      s.setUnderlayImport({
        ...item.underlay,
        sketchId: 500,
        editing: true,
        original: item.underlay,
      });
    });
    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();
    // Editing exposes Remove; creating does not.
    await bar.getByRole("button", { name: "Remove" }).click();

    const s = await sketch();
    expect(s.underlay).toBeFalsy();
  });

  test("an underlay never affects sketch geometry or document integrity", async () => {
    await page.evaluate(
      ([dataUrl]) => {
        const s = window.__store.getState();
        s.addSketchShapes(
          500,
          [
            { type: "line", x1: 0, y1: 0, x2: 3, y2: 0 },
            { type: "line", x1: 3, y1: 0, x2: 3, y2: 3 },
          ],
          [
            { type: "horizontal", shapeIdx: 0 },
            { type: "vertical", shapeIdx: 1 },
          ],
        );
        s.setSketchUnderlay(500, {
          dataUrl,
          name: "guide",
          imageAspect: 0.5,
          widthMm: 40,
          offsetX: 1,
          offsetY: 2,
          rotationDeg: 15,
          opacity: 0.3,
        });
      },
      [PNG],
    );
    const s = await sketch();
    expect(s.shapes.length).toBe(2); // the image added nothing
    expect(s.underlay.rotationDeg).toBe(15);
    await assertDocumentIntegrity(page, "sketch with an underlay");
  });
});
