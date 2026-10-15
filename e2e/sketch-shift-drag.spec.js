import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Shift while dragging sketch geometry locks the drag to one axis: the larger
// component of the drag so far, measured from where it started.  Driven with
// real mouse and keyboard input.  The screen↔sketch mapping is calibrated as
// in sketch-workflow.spec.js: draw a probe line between two known screen
// points and read its local endpoints back.

let app;
let page;
let toScreen;

const shapes = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 310)?.shapes,
  );

test.describe.serial("shift-drag in a sketch", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem({
        id: 310,
        type: "sketch",
        name: "Sketch S",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(310);
    });
    await page.waitForTimeout(1600); // fly-in tween settles top-down
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(1);
    const probe = (await shapes())[0];
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    await page.evaluate(() => window.__store.getState().undoSketch(310));
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(0);

    // The line to drag: (0, 0) to (2, 0) -- 20 mm along x.
    const A = toScreen(0, 0);
    const B = toScreen(2, 0);
    await page.mouse.click(A.x, A.y);
    await page.mouse.click(B.x, B.y);
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(1);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  // Where the line's first end sits.  A locked coordinate must not move at
  // all; a moving one lands within the screen calibration's rounding (about
  // 0.1 mm here), so it is checked to 0.5 mm.
  const start = async () => {
    const [ln] = await shapes();
    return { x: ln.x1, y: ln.y1 };
  };

  test("holding Shift slides it along the axis it has moved furthest on", async () => {
    const from = await start();
    const grab = toScreen(from.x + 1, from.y);
    // 10 mm right, then Shift, then on to 15 mm up: the drag has gone further
    // up, so it keeps the 15 mm up and drops the 10 mm across.
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    let p = toScreen(from.x + 2, from.y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.keyboard.down("Shift");
    p = toScreen(from.x + 2, from.y + 1.5);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => (await start()).y)
      .toBeCloseTo(from.y + 1.5, 1);
    expect((await start()).x, "locked: no sideways movement at all").toBe(
      from.x,
    );
  });

  test("letting go of Shift mid-drag frees it at once, without a move", async () => {
    const from = await start();
    const grab = toScreen(from.x + 1, from.y);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.keyboard.down("Shift");
    const p = toScreen(from.x + 2, from.y + 1.5);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    // Locked to up; releasing Shift with the mouse still takes both offsets.
    await page.keyboard.up("Shift");
    await page.mouse.up();
    await expect.poll(async () => (await start()).x).toBeCloseTo(from.x + 1, 1);
    expect((await start()).y).toBeCloseTo(from.y + 1.5, 1);
  });
});
