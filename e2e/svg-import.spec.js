// SVG import into a sketch: parse paths to sketch shapes, place them with a
// live preview, scale, then commit as real geometry.  The parser normalises
// artwork so its LONGEST side is 200 mm regardless of the source file's own
// dimensions, and the Scale field multiplies that — this pins both.

import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import { assertDocumentIntegrity } from "./integrity.js";

let app;
let page;

// A 40x20 rectangle — longest side 40, so it normalises to 200 mm wide.
// Fed through the REAL hidden file input, so this exercises the menu handler,
// the parser and the placement flow exactly as a user would hit them.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">
  <path d="M 0 0 L 40 0 L 40 20 L 0 20 Z"/>
</svg>`;

const sketch = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 950) ?? null,
  );
// The hidden import input DocumentSection drives (the .pcad loader is the one
// carrying an `accept`, so the un-accepted input is the geometry importer).
const importSvg = async () => {
  await page
    .locator('input[type="file"]:not([accept*="pcad"])')
    .first()
    .setInputFiles({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(SVG),
    });
  await expect(page.locator(".sketch-placement-hint")).toBeVisible();
};
const spanOf = (shapes) => {
  const xs = shapes.flatMap((s) =>
    s.type === "line" ? [s.x1, s.x2] : [s.p0.x, s.p3.x],
  );
  return Math.max(...xs) - Math.min(...xs);
};

test.describe.serial("SVG import", () => {
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
          id: 950,
          type: "sketch",
          name: "Sketch S",
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
      s.selectItem(950);
    });
    await page.waitForTimeout(1400);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("importing an SVG normalises it to a fixed longest side", async () => {
    await importSvg();
    const staged = await page.evaluate(
      () => window.__store.getState().svgImport,
    );
    expect(staged).toBeTruthy();
    expect(staged.shapes.length).toBeGreaterThan(0);
    // 20 scene units = 200 mm across the longest side, whatever the source
    // file's own width/height said.
    expect(spanOf(staged.shapes)).toBeCloseTo(20, 3);
  });

  test("the placement bar previews the import and Scale resizes it", async () => {
    await expect(page.locator(".sketch-placement-hint")).toBeVisible();
    const scale = page.locator(".sketch-distance-input-overlay input").first();
    await scale.fill("0.25"); // 200 mm -> 50 mm
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => window.__store.getState().svgImport.scale),
    ).toBeCloseTo(0.25, 6);
  });

  test("Confirm commits the scaled geometry into the sketch", async () => {
    await page
      .locator(".sketch-distance-input-overlay")
      .getByRole("button", { name: "Confirm" })
      .click();

    const s = await sketch();
    expect(s.shapes.length).toBeGreaterThan(0);
    // Committed at quarter scale: 20 units -> 5 units (50 mm).
    expect(spanOf(s.shapes)).toBeCloseTo(5, 2);
    expect(
      await page.evaluate(() => window.__store.getState().svgImport),
    ).toBeNull();
    await assertDocumentIntegrity(page, "after SVG import");
  });

  test("Cancel discards the pending import", async () => {
    const before = (await sketch()).shapes.length;
    await importSvg();
    await page
      .locator(".sketch-distance-input-overlay")
      .getByRole("button", { name: "Cancel" })
      .click();

    expect(
      await page.evaluate(() => window.__store.getState().svgImport),
    ).toBeNull();
    expect((await sketch()).shapes.length).toBe(before);
  });
});
