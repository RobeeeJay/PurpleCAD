import { test, expect } from "./fixtures.js";
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

  // Perpendicular distance from a line's start to another line.
  const gap = (it, a, b) => {
    const p = it.shapes[a];
    const l = it.shapes[b];
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    return (
      Math.abs((p.x1 - l.x1) * dy - (p.y1 - l.y1) * dx) / Math.hypot(dx, dy)
    );
  };
  const direction = (s) => (s.y2 - s.y1) / (s.x2 - s.x1);

  test("two lines each parallel to a third get a gap dimension", async () => {
    // Neither has a constraint naming the other: the link runs through line 4.
    await page.evaluate(() => {
      window.__store.getState().addSketchShapes(
        700,
        [
          { type: "line", x1: 6, y1: -6, x2: 10, y2: -2 },
          { type: "line", x1: 9, y1: -6, x2: 13, y2: -2 },
          { type: "line", x1: 14, y1: -6, x2: 18, y2: -2 },
        ],
        [
          { type: "parallel", shapeAIdx: 2, shapeBIdx: 4 },
          { type: "parallel", shapeAIdx: 3, shapeBIdx: 4 },
        ],
      );
    });
    await page.waitForTimeout(400);

    await page.keyboard.press("d");
    await page.mouse.click(toScreen(8, -4).x, toScreen(8, -4).y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().sketchDistanceInput?.shapeAIdx,
        ),
      )
      .toBe(2);
    await page.mouse.click(toScreen(11, -4).x, toScreen(11, -4).y);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchDistanceInput?.pointLine ?? null,
        ),
      )
      .toMatchObject({ pointShapeIdx: 2, lineShapeIdx: 3 });

    const overlay = page.locator(".sketch-distance-input-overlay");
    await overlay.locator("input").first().fill("30");
    await overlay.locator("input").first().press("Enter");

    await expect
      .poll(async () => gap(await line(), 2, 3), { timeout: 5000 })
      .toBeCloseTo(3, 3);
    const it = await line();
    expect(direction(it.shapes[2])).toBeCloseTo(direction(it.shapes[4]), 4);
    expect(direction(it.shapes[3])).toBeCloseTo(direction(it.shapes[4]), 4);
  });

  test("the distance tool goes straight to the gap of two selected parallel lines", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addSketchShapes(
        700,
        [
          { type: "line", x1: 22, y1: -6, x2: 22, y2: -2 },
          { type: "line", x1: 26, y1: -6, x2: 26, y2: -2 },
        ],
        [
          { type: "vertical", shapeIdx: 5 },
          { type: "vertical", shapeIdx: 6 },
        ],
      );
      s.setSketchMultiSelectedIndices([5, 6]);
    });
    await page.getByTitle(/^Distance/).click();

    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay.locator("input").first()).toBeFocused();
    await expect(overlay.locator("input").first()).toHaveValue("40.00");
    await overlay.locator("input").first().fill("20");
    await overlay.locator("input").first().press("Enter");

    await expect
      .poll(async () => gap(await line(), 5, 6), { timeout: 5000 })
      .toBeCloseTo(2, 3);
  });

  test("two selected lines that aren't held parallel leave the tool picking", async () => {
    await page.evaluate(() =>
      window.__store.getState().setSketchMultiSelectedIndices([0, 2]),
    );
    await page.getByTitle(/^Distance/).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__store.getState().sketchConstraintMode),
      )
      .toBe("distance");
    expect(
      await page.evaluate(() => window.__store.getState().sketchDistanceInput),
    ).toBeNull();
    await page.keyboard.press("Escape");
  });
});
