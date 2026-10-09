// Touch and Apple Pencil on the viewport (touchInput.js): the iPad's input.
// Real fingers can't reach a desktop run, so these dispatch the pointer events
// an iPad sends (pointerType "touch" / "pen") at the canvas, which exercises
// the real wiring -- the listeners, the gesture rules and the mouse and wheel
// handlers they drive.  What they can't show is WebKit's side: that a real
// tap sends no second, compatibility click.  That is checked on an iPad.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;
let box;
// The visible area's centre: the canvas spans the window under the 250 px
// left panel, and the camera frames the part right of it (CLAUDE.md).
const LEFT_PANEL_PX = 250;
const centre = () => ({
  x: box.x + LEFT_PANEL_PX + (box.width - LEFT_PANEL_PX) / 2,
  y: box.y + box.height / 2,
});

// One pointer event at the canvas, as an iPad delivers it.
const pointer = (type, id, x, y, pointerType = "touch") =>
  page.evaluate(
    ([type, id, x, y, pointerType]) => {
      const el = document.querySelector(".viewport canvas");
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType,
          isPrimary: id === 1,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [type, id, x, y, pointerType],
  );

// A finger from a to b in steps.
async function drag(id, a, b, steps = 8) {
  await pointer("pointerdown", id, a.x, a.y);
  for (let i = 1; i <= steps; i++)
    await pointer(
      "pointermove",
      id,
      a.x + ((b.x - a.x) * i) / steps,
      a.y + ((b.y - a.y) * i) / steps,
    );
  await pointer("pointerup", id, b.x, b.y);
}

async function tap(p) {
  await pointer("pointerdown", 1, p.x, p.y);
  await pointer("pointerup", 1, p.x, p.y);
}

const state = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    const cc = s._cameraControls;
    const cam = cc.getCameraPosition();
    const tgt = cc.getViewTarget();
    return {
      ry: cc.targetRotationY,
      rx: cc.targetRotationX,
      target: [tgt.x, tgt.y, tgt.z],
      dist: cam.distanceTo(tgt),
      selected: s.selectedId,
    };
  });

// Not serial: each test starts from no selection, so a failure in one doesn't
// hide whether the others hold.
test.describe("touch input", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument?.();
      s.addItem(
        {
          id: 301,
          type: "cube",
          name: "Box",
          children: [],
          parentId: null,
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { width: 2, height: 2, depth: 2 },
        },
        "Added",
      );
      s.selectItem(null);
    });
    await page.waitForTimeout(600);
    box = await page.locator(".viewport canvas").first().boundingBox();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test.beforeEach(async () => {
    await page.evaluate(() => window.__store.getState().selectItem(null));
  });

  test("a tap on the part selects it", async () => {
    await tap(centre());
    await expect.poll(async () => (await state()).selected).toBe(301);
  });

  test("a tap on empty space clears the selection", async () => {
    await page.evaluate(() => window.__store.getState().selectItem(301));
    await tap({ x: box.x + box.width - 40, y: box.y + 60 });
    await expect.poll(async () => (await state()).selected).toBeNull();
  });

  test("one finger dragged orbits, and selects nothing", async () => {
    const before = await state();
    const c = centre();
    await drag(1, c, { x: c.x + 120, y: c.y + 60 });
    const after = await state();
    // 120 px at the Shift+wheel orbit's 0.004 rad/px is ~0.48 rad.
    expect(
      Math.abs(after.ry - before.ry),
      `rotation ${before.ry} -> ${after.ry}`,
    ).toBeGreaterThan(0.3);
    expect(Math.abs(after.rx - before.rx)).toBeGreaterThan(0.1);
    expect(after.selected, "a drag is not a tap").toBeNull();
  });

  test("a finger that moves only within the slop is still a tap", async () => {
    const c = centre();
    await pointer("pointerdown", 1, c.x, c.y);
    await pointer("pointermove", 1, c.x + 4, c.y + 3);
    await pointer("pointerup", 1, c.x + 4, c.y + 3);
    await expect.poll(async () => (await state()).selected).toBe(301);
  });

  test("two fingers spreading zoom in, without orbiting", async () => {
    const before = await state();
    const c = centre();
    await pointer("pointerdown", 1, c.x - 40, c.y);
    await pointer("pointerdown", 2, c.x + 40, c.y);
    for (let i = 1; i <= 8; i++) {
      await pointer("pointermove", 1, c.x - 40 - i * 10, c.y);
      await pointer("pointermove", 2, c.x + 40 + i * 10, c.y);
    }
    await pointer("pointerup", 1, c.x - 120, c.y);
    await pointer("pointerup", 2, c.x + 120, c.y);
    const after = await state();
    // Fingers 80 px apart spread to 240: three times closer.
    expect(after.dist, `distance ${before.dist} -> ${after.dist}`).toBeLessThan(
      before.dist / 2,
    );
    expect(after.ry).toBeCloseTo(before.ry, 6);
  });

  test("two fingers moving together pan", async () => {
    const before = await state();
    const c = centre();
    await pointer("pointerdown", 1, c.x - 40, c.y);
    await pointer("pointerdown", 2, c.x + 40, c.y);
    for (let i = 1; i <= 8; i++) {
      await pointer("pointermove", 1, c.x - 40 + i * 10, c.y);
      await pointer("pointermove", 2, c.x + 40 + i * 10, c.y);
    }
    await pointer("pointerup", 1, c.x + 40, c.y);
    await pointer("pointerup", 2, c.x + 120, c.y);
    const after = await state();
    const moved = Math.hypot(
      ...after.target.map((v, i) => v - before.target[i]),
    );
    expect(moved, "the view target moved").toBeGreaterThan(0.1);
    expect(after.ry).toBeCloseTo(before.ry, 6);
  });

  test("a double tap on empty space frames the part again", async () => {
    // Home, settled, is where the double tap must bring the view back to --
    // not merely "somewhere else": a camera tween still running from an
    // earlier step moves the target too, and passed this without any touch
    // wiring at all.
    const settle = () =>
      expect
        .poll(() =>
          page.evaluate(() =>
            window.__store.getState()._cameraControls.isCameraAnimating(),
          ),
        )
        .toBe(false);
    await page.evaluate(() => window.__store.getState()._cameraControls.home());
    await page.waitForTimeout(100);
    await settle();
    const home = (await state()).target;
    const away = (s) => Math.hypot(...s.target.map((v, i) => v - home[i]));

    const c = centre();
    await pointer("pointerdown", 1, c.x - 40, c.y);
    await pointer("pointerdown", 2, c.x + 40, c.y);
    for (let i = 1; i <= 8; i++) {
      await pointer("pointermove", 1, c.x - 40 + i * 30, c.y);
      await pointer("pointermove", 2, c.x + 40 + i * 30, c.y);
    }
    await pointer("pointerup", 1, c.x + 200, c.y);
    await pointer("pointerup", 2, c.x + 280, c.y);
    expect(away(await state()), "the pan left Home").toBeGreaterThan(0.5);

    // Home frames the part to fill the view, and the pan carried it right, so
    // the empty side is the left edge of the visible area.  (The bottom-right
    // corner was covered by the part: the double tap clicked it, twice.)
    const empty = { x: box.x + LEFT_PANEL_PX + 30, y: box.y + box.height / 2 };
    await tap(empty);
    await tap(empty);
    await page.waitForTimeout(100);
    await settle();
    expect(away(await state()), "back at Home").toBeLessThan(1e-3);
  });

  test("the Pencil is the mouse: a tap selects, a drag does not orbit", async () => {
    // Back to the part first: the tests before may have panned it away.
    await page.evaluate(() => window.__store.getState()._cameraControls.home());
    await page.waitForTimeout(800);
    const c = centre();
    await pointer("pointerdown", 9, c.x, c.y, "pen");
    await pointer("pointerup", 9, c.x, c.y, "pen");
    await expect.poll(async () => (await state()).selected).toBe(301);
    const view = await state();
    await pointer("pointerdown", 9, c.x, c.y, "pen");
    await pointer("pointermove", 9, c.x + 100, c.y + 20, "pen");
    await pointer("pointerup", 9, c.x + 100, c.y + 20, "pen");
    // A left drag in the 3D view orbits nothing with the mouse either.
    const after = await state();
    expect(after.ry).toBeCloseTo(view.ry, 6);
    expect(after.target).toEqual(view.target);
  });
});
