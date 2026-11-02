import fs from "node:fs";
import { test, expect } from "./fixtures.js";
import { launchApp, saveTrace, discardTrace } from "./launch.js";

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
    // A trace that was started for a passing run is dropped rather than saved.
    await discardTrace(app);
    await app?.close();
  });

  test("body-dragging a border line translates the sketch", async ({}, testInfo) => {
    // Map sketch-local to screen with the app's OWN projection, rather than
    // inferring an affine fit from a probe line drawn at two screen points.
    //
    // The probe fit assumed the camera ends up square-on to the sketch. When it
    // settles at an angle instead the fit comes out anisotropic -- measured
    // 25.98 px per unit across and 111.98 down, a 4.3x difference -- and the
    // drag target computed from it landed at y = -136, off the top of the
    // window. The drag then went nowhere and the sketch sat exactly where it
    // was, which is what every one of this test's intermittent container
    // failures looked like.
    //
    // worldToScreen is what the app itself uses to place things, so it is right
    // at any camera angle.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    toScreen = (lx, ly) =>
      page.evaluate(
        ({ lx, ly }) => {
          const s = window.__store.getState();
          const sk = s.items.find((i) => i.id === 1);
          const r = sk.rotation || { x: 0, y: 0, z: 0 };
          // The sketch plane's own axes in world space (Euler XYZ, matching
          // the app's convention).
          const rot = (x, y, z) => {
            const cx = Math.cos(r.x || 0),
              sx = Math.sin(r.x || 0);
            const cy = Math.cos(r.y || 0),
              sy = Math.sin(r.y || 0);
            const cz = Math.cos(r.z || 0),
              sz = Math.sin(r.z || 0);
            let X = x,
              Y = y * cx - z * sx,
              Z = y * sx + z * cx;
            let X2 = X * cy + Z * sy,
              Y2 = Y,
              Z2 = -X * sy + Z * cy;
            return [X2 * cz - Y2 * sz, X2 * sz + Y2 * cz, Z2];
          };
          const [wx, wy, wz] = rot(lx, ly, 0);
          const p = sk.position || { x: 0, y: 0, z: 0 };
          return s._cameraControls.worldToScreen(p.x + wx, p.y + wy, p.z + wz);
        },
        { lx, ly },
      );

    const before = await page.evaluate(
      () => window.__store.getState().items.find((i) => i.id === 1).shapes[0],
    );
    // Body-drag the top border up by ~3 units.
    const from = await toScreen(0, before.y1);
    const to = await toScreen(2, before.y1 + 3);
    // Both ends of the drag have to be ON the canvas. When the view has not
    // settled square-on they are not, and a mouse move to a point outside the
    // window drags nothing at all -- the failure this test kept hitting.
    for (const [name, pt] of [
      ["start", from],
      ["end", to],
    ])
      expect(
        pt.x > 0 && pt.x < size.width && pt.y > 0 && pt.y < size.height,
        `drag ${name} ${JSON.stringify(pt)} is off-screen (${size.width}x${size.height})`,
      ).toBe(true);
    // A still of the sketch as the drag is about to start. Taken BEFORE the
    // pointer moves: anything between the move and the press changes the timing
    // this test is trying to measure. Video would be better, but the screencast
    // stops the app starting at all on the container's software renderer, and
    // the container is the only place this fails.
    const beforeShot = await page.screenshot();

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
        // The trace replays every action with its timing, which is the thing
        // stills cannot show: whether the press and the drag were dispatched at
        // all, and how long each step actually took.
        await saveTrace(app, testInfo, "drag-trace");
        await testInfo.attach("drag-before.png", {
          body: beforeShot,
          contentType: "image/png",
        });
        await testInfo.attach("drag-after.png", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
        console.log(
          "DRAG FAILED",
          JSON.stringify({
            viewport: size,
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
    const p = await toScreen(onArc.x, onArc.y);
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
    const q = await toScreen(onArc.x + 2, onArc.y + 2);
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
