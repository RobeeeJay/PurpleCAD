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
let toScreen; // (lx,ly) -> screen {x,y}, set by the first test's calibration

test.describe.serial("constraint-drifted sketch drags", () => {
  test.beforeAll(async () => {
    // Recording makes the app take far longer to start on a software renderer
    // -- past the 60s default, which fails the hook before the test it is meant
    // to be filming even begins.
    if (process.env.E2E_VIDEO) test.setTimeout(240_000);
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    const doc = JSON.parse(
      fs.readFileSync("test-files/undraggable-sketch-bug.pcad", "utf8"),
    );
    await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__store.getState().selectItem(1));
    // Wait for the fly-in to actually SETTLE, not a fixed 1800ms. Two races
    // to close: the tween advances per FRAME, so a wall-clock wait lands
    // mid-flight wherever the frame rate puts it; and selectItem only
    // SCHEDULES the tween, so polling "not animating" immediately succeeds
    // before it has even started. Require two consecutive samples that are
    // both idle and unmoved.
    let prev = null;
    let settled = false;
    for (let i = 0; i < 150 && !settled; i++) {
      const now = await page.evaluate(() => {
        const cc = window.__store.getState()._cameraControls;
        const t = cc.getViewTarget();
        return { anim: cc.isCameraAnimating(), t: [t.x, t.y, t.z] };
      });
      settled =
        !now.anim &&
        prev !== null &&
        !prev.anim &&
        prev.t.every((v, k) => Math.abs(v - now.t[k]) < 1e-9);
      prev = now;
      if (!settled) await page.waitForTimeout(100);
    }
    expect(settled, "camera never settled into sketch view").toBe(true);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("body-dragging a border line translates the sketch", async () => {
    // Calibrate screen↔local with a probe line.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    const shapesBefore = await page.evaluate(
      () =>
        window.__store.getState().items.find((i) => i.id === 1).shapes.length,
    );
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape");
    const probe = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 1)
        .shapes.at(-1),
    );
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    await page.evaluate(() => window.__store.getState().undoSketch(1));
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
    // Wait for the probe line to be GONE from the store and for the renderer to
    // have rebuilt the sketch overlay before dragging. The drag hit-tests
    // against that overlay's line meshes, so starting it while the rebuild is
    // still pending finds nothing under the pointer and the drag never begins
    // -- the sketch then sits exactly where it was, which is what a failure
    // here looks like.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.id === 1).shapes
              .length,
        ),
      )
      .toBe(shapesBefore);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );

    const before = await page.evaluate(
      () => window.__store.getState().items.find((i) => i.id === 1).shapes[0],
    );
    // Body-drag the top border up by ~3 units.
    const from = toScreen(0, before.y1);
    const to = toScreen(2, before.y1 + 3);
    // Move, let the app process the pointer, then move again before pressing.
    // This test passes ALONE and failed IN THE SUITE, and it passed in the
    // suite as soon as work landed between the move and the press: the app
    // resolves what is under the cursor from pointer motion, so a press in the
    // same tick as the only move can find nothing to grab. The drag then never
    // starts and the sketch sits exactly where it was.
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(150);
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(50);
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
      .toBeCloseTo(before.y1 + 3, 0)
      .catch(async (err) => {
        // Diagnostics AFTER the fact only: anything between the move and the
        // press changes the very timing this is trying to measure, and doing
        // that once already made the failure disappear.
        console.log(
          "DRAG FAILED",
          JSON.stringify({
            viewport: size,
            calib: { a, b, c, d },
            from,
            to,
            before: { x1: before.x1, y1: before.y1 },
            after: await page.evaluate(() => {
              const st = window.__store.getState();
              const sh = st.items.find((i) => i.id === 1).shapes[0];
              return {
                x1: sh.x1,
                y1: sh.y1,
                tool: st.activeSketchTool,
                shapes: st.items.find((i) => i.id === 1).shapes.length,
                sketchMode: !!st.sketchMode,
                selected: st.selectedId,
              };
            }),
          }),
        );
        throw err;
      });
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
    // The fillets rode along and kept their radius (derived, re-applied at the
    // destination) rather than stretching.
    const bevels = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 1)
        .shapes.filter((s) => s.kind === "bevel")
        .map((s) => s.r),
    );
    expect(bevels).toHaveLength(4);
    for (const r of bevels) expect(r).toBeCloseTo(0.3, 1);
  });

  test("a fillet corner is not directly selectable or draggable", async () => {
    // Click squarely on a bevel arc: it must NOT become the selection, and a
    // drag from it must not move the sketch.
    const bevel = await page.evaluate(() => {
      const it = window.__store.getState().items.find((i) => i.id === 1);
      return it.shapes.find((s) => s.kind === "bevel");
    });
    // A point on the arc.
    const mid = (bevel.startAngle + bevel.endAngle) / 2;
    const onArc = {
      x: bevel.cx + Math.cos(mid) * bevel.r,
      y: bevel.cy + Math.sin(mid) * bevel.r,
    };
    await page.evaluate(() => {
      window.__store.getState().setSelectedSketchElement(null);
      window.__store.getState().setSketchMultiSelectedIndices([]);
    });
    const before = await page.evaluate(() =>
      JSON.stringify(
        window.__store.getState().items.find((i) => i.id === 1).shapes,
      ),
    );
    const p = toScreen(onArc.x, onArc.y);
    await page.mouse.click(p.x, p.y);
    // Nothing got selected (the bridge is inert).
    expect(
      await page.evaluate(() => {
        const s = window.__store.getState();
        return (
          s.selectedSketchElement == null &&
          (s.sketchMultiSelectedIndices || []).length === 0
        );
      }),
    ).toBe(true);
    // Dragging from the arc leaves the geometry untouched.
    const q = toScreen(onArc.x + 2, onArc.y + 2);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 8 });
    await page.mouse.up();
    const afterShapes = await page.evaluate(() =>
      JSON.stringify(
        window.__store.getState().items.find((i) => i.id === 1).shapes,
      ),
    );
    expect(afterShapes).toBe(before);
  });
});
