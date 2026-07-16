import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// The 2D sketch workflow with REAL mouse input: enter sketch mode, draw a
// rectangle and a circle by clicking the canvas, undo/redo a shape, then
// extrude the drawn region through the profile-pick + depth-overlay flow.
// This is the interaction surface (sketchDraw / sketchInteraction /
// SketchOverlays) that unit tests structurally can't touch.
//
// Screen↔sketch mapping: the top-down sketch camera is calibrated by drawing
// a probe line at two known SCREEN points, reading back its LOCAL endpoints,
// solving the axis-aligned affine transform, then undoing the probe.

let app;
let page;
let toScreen; // (lx, ly) -> {x, y}

const shapes = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 300)?.shapes,
  );

test.describe.serial("2D sketch workflow", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("enter sketch mode and calibrate the sketch plane", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem({
        id: 300,
        type: "sketch",
        name: "Sketch W",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // ground sketch
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(300);
    });
    await page.waitForTimeout(1600); // fly-in tween settles top-down

    // Probe: draw a line between two screen points, read its local coords.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape"); // end the line chain
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(1);
    const probe = (await shapes())[0];
    // Solve sx = a·lx + b, sy = c·ly + d (top-down view is axis-aligned).
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    expect(Number.isFinite(a) && Number.isFinite(c)).toBe(true);

    await page.evaluate(() => window.__store.getState().undoSketch(300));
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(0);
  });

  test("draw a rectangle with the mouse (4 lines at the right coords)", async () => {
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("rect"),
    );
    const A = toScreen(0, 0);
    const B = toScreen(2, 1.5); // 20 × 15 mm
    await page.mouse.click(A.x, A.y);
    await page.mouse.click(B.x, B.y);
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(4);
    const lines = await shapes();
    for (const l of lines) expect(l.type).toBe("line");
    // Envelope of all endpoints ≈ the requested rectangle (snap tolerance).
    const xs = lines.flatMap((l) => [l.x1, l.x2]);
    const ys = lines.flatMap((l) => [l.y1, l.y2]);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(2, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(1.5, 1);
  });

  test("draw a circle; sketch undo/redo behave", async () => {
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("circle"),
    );
    const C = toScreen(4, 0.75);
    const R = toScreen(4.5, 0.75); // radius 0.5 units = 5 mm
    await page.mouse.click(C.x, C.y);
    await page.mouse.click(R.x, R.y);
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(5);
    const circle = (await shapes()).find((s) => s.type === "circle");
    expect(circle).toBeTruthy();
    expect(circle.cx).toBeCloseTo(4, 1);
    expect(circle.cy).toBeCloseTo(0.75, 1);
    expect(circle.r).toBeCloseTo(0.5, 1);

    await page.evaluate(() => window.__store.getState().undoSketch(300));
    expect((await shapes()).length).toBe(4); // circle gone
    await page.evaluate(() => window.__store.getState().redoSketch(300));
    expect((await shapes()).length).toBe(5); // and back
  });

  test("extrude the drawn rectangle through the profile-pick flow", async () => {
    // Leave the drawing tool, then start the extrude profile pick.
    await page.evaluate(() => {
      window.__store.getState().setActiveSketchTool(null);
      window.__store.getState().setExtrudeSelectMode("profile");
    });
    await page.waitForTimeout(600); // region fills materialise
    // Click inside the rectangle region (its centre).
    const centre = toScreen(1, 0.75);
    await page.mouse.click(centre.x, centre.y);
    // The depth overlay appears once a profile is selected.
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // The bar holds two formula fields: start-offset first, DEPTH second
    // (autofocused).
    const depth = overlay.locator("input").nth(1);
    await depth.fill("8");
    await depth.press("Enter");

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const it = window.__store
              .getState()
              .items.find((i) => i.type === "extrude");
            return it ? { depth: it.depth } : null;
          }),
        { timeout: 30000 },
      )
      .toBeTruthy();
    const extrude = await page.evaluate(() => {
      const it = window.__store.getState().items.find(
        (i) => i.type === "extrude",
      );
      return {
        depth: it.depth,
        poly: it.profile?.polygon2D?.length ?? 0,
        // A single extrude commits via addItem (label "Added"); assert the
        // CREATE entry for this item exists rather than a specific label.
        created: window.__store
          .getState()
          .history.some(
            (h) =>
              h.instruction?.type === "create" &&
              h.instruction.item?.id === it.id,
          ),
      };
    });
    // Depth persists as a user-facing mm formula string ("8" = 8 mm — see
    // the variables/formulas convention in CLAUDE.md).
    expect(Number(extrude.depth)).toBeCloseTo(8, 3);
    expect(extrude.poly).toBeGreaterThanOrEqual(4);
    expect(extrude.created).toBe(true);
  });
});
