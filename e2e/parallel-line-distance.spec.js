import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// Distance constraint between two PARALLEL lines (sharing a horizontal /
// vertical / parallel constraint): the distance tool's first line click opens
// a length dimension; clicking a second parallel line switches it to the
// perpendicular gap.  Its own clean sketch — deterministic screen picks.

let app;
let page;
let toScreen;

test.describe.serial("parallel-line distance", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem({
        id: 700,
        type: "sketch",
        name: "PL",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(700);
    });
    await page.waitForTimeout(1600);
    // Calibrate with a probe line.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape");
    const probe = await page.evaluate(
      () => window.__store.getState().items.find((i) => i.id === 700).shapes[0],
    );
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    await page.evaluate(() => window.__store.getState().undoSketch(700));
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
  });

  test.afterAll(async () => {
    await app?.close();
  });

  const line = () =>
    page.evaluate(() =>
      window.__store.getState().items.find((i) => i.id === 700),
    );

  test("two parallel lines get a perpendicular gap dimension", async () => {
    // Two exactly-horizontal lines with horizontal constraints, y=0 and y=4.
    await page.evaluate(() => {
      window.__store.getState().addSketchShapes(
        700,
        [
          { type: "line", x1: -3, y1: 0, x2: 3, y2: 0 },
          { type: "line", x1: -3, y1: 4, x2: 3, y2: 4 },
        ],
        [
          { type: "horizontal", shapeIdx: 0 },
          { type: "horizontal", shapeIdx: 1 },
        ],
      );
    });
    await page.waitForTimeout(400); // overlay rebuilds the line objects

    await page.keyboard.press("d");
    // First line (y=0): opens a length dimension.
    await page.mouse.click(toScreen(0, 0).x, toScreen(0, 0).y);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const di = window.__store.getState().sketchDistanceInput;
          return di && di.shapeAIdx === 0 && di.shapeBIdx === 0;
        }),
      )
      .toBe(true);
    // A hint tells the user they can click a parallel line for the gap.
    await expect(page.locator(".sketch-placement-hint")).toContainText(
      "click a parallel line for the gap",
    );
    // Second, parallel line (y=4): switches to the line-to-line gap.
    await page.mouse.click(toScreen(0, 4).x, toScreen(0, 4).y);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchDistanceInput?.pointLine ?? null,
        ),
      )
      .toMatchObject({ pointShapeIdx: 0, lineShapeIdx: 1 });

    const overlay = page.locator(".sketch-distance-input-overlay");
    await overlay.locator("input").first().fill("30");
    await overlay.locator("input").first().press("Enter");

    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window.__store.getState().items.find((i) => i.id === 700)
              .constraints || []
          ).some((c) => c.type === "pointLineDistance"),
        ),
      )
      .toBe(true);
    // The first line moved to the 3-unit (30 mm) gap; it stays horizontal.
    const it = await line();
    expect(Math.abs(it.shapes[0].y1 - it.shapes[1].y1)).toBeCloseTo(3, 1);
    expect(it.shapes[0].y1).toBeCloseTo(it.shapes[0].y2, 3);
  });
});
