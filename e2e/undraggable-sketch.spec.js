import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// Regression: this document's sketch is saved in a state that VIOLATES its
// own midpoint constraints, which used to freeze every drag (the drag solve
// started from the bad seed, failed its residual guard, and held the last
// state).  Drag-start now repairs the sketch first, so a body drag moves the
// whole constrained network.

let app;
let page;

test.describe.serial("constraint-drifted sketch drags", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    const doc = JSON.parse(
      fs.readFileSync("test-files/undraggable-sketch-bug.pcad", "utf8"),
    );
    await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__store.getState().selectItem(1));
    await page.waitForTimeout(1800); // fly into the sketch
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("body-dragging a border line translates the sketch", async () => {
    // Calibrate screen↔local with a probe line.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape");
    const probe = await page.evaluate(() =>
      window.__store.getState().items.find((i) => i.id === 1).shapes.at(-1),
    );
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    const toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    await page.evaluate(() => window.__store.getState().undoSketch(1));
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );

    const before = await page.evaluate(
      () => window.__store.getState().items.find((i) => i.id === 1).shapes[0],
    );
    // Body-drag the top border up by ~3 units.
    const from = toScreen(0, before.y1);
    const to = toScreen(2, before.y1 + 3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store.getState().items.find((i) => i.id === 1).shapes[0]
                .y1,
          ),
        { timeout: 5000 },
      )
      .toBeCloseTo(before.y1 + 3, 0);
    // The bottom border followed (the whole network translated).  The exact
    // landing spot depends on the drag-start repair (the file also violates
    // its Depth dimension, which the repair corrects), so assert the
    // regression invariant: the bottom moved substantially with the top —
    // before the fix it stayed put while the corner arcs stretched.
    const after = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 1)
        .shapes.map((s) => s.y1),
    );
    expect(after[2]).toBeGreaterThan(-5.7);
  });
});
