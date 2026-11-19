import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

// "To…" in the extrude dialog: click a face and the distance is set so the
// extrusion reaches it.  Driven with real clicks, alongside "Start from…",
// which shares its face pick.
let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

const project = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) =>
      window.__store.getState()._cameraControls.worldToScreen(x, y, z),
    [x, y, z],
  );
// Where a world point is on screen once the camera has stopped moving (Reset
// view tweens it); a point projected mid-tween is where the face WAS.
const screen = async (x, y, z) => {
  let prev = await project(x, y, z);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100);
    const cur = await project(x, y, z);
    if (Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5)
      return cur;
    prev = cur;
  }
  throw new Error(`the camera never settled: ${JSON.stringify(prev)}`);
};

// Click a viewport point, first checking it is the 3D canvas under it: a
// click that lands off-screen, behind the camera, or on a panel does nothing,
// and the test would only time out later with no clue why.
const clickView = async (p, what) => {
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return {
      tag: el?.tagName ?? null,
      cls: el?.className?.baseVal ?? el?.className ?? null,
      mode: window.__store.getState().extrudeSelectMode,
      size: [window.innerWidth, window.innerHeight],
    };
  }, p);
  expect(
    under.tag,
    `${what} at ${JSON.stringify(p)}: ${JSON.stringify(under)}`,
  ).toBe("CANVAS");
  await page.mouse.click(p.x, p.y);
};

test("To… sets the distance so the extrusion reaches the clicked face", async () => {
  // A circle on the ground, and beside it a 20 mm cube standing 5 mm up:
  // its top face is 25 mm above the ground (y = 2.5 internally).
  await page.evaluate(() =>
    window.__api.call("document.new", { discardCurrent: true }),
  );
  const sketch = await page.evaluate(() =>
    window.__api.call("sketch.create", {
      plane: "XY",
      shapes: [{ type: "circle", cx: 0, cy: 0, r: 5 }],
    }),
  );
  expect(sketch.ok, JSON.stringify(sketch.error)).toBe(true);
  await page.evaluate(() => {
    window.__store.getState().addItem({
      id: 500,
      name: "Target",
      type: "cube",
      children: [],
      position: { x: 3, y: 1.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    window.__store.getState().selectItem(null);
  });
  // Frame the whole scene.  The new document's camera reset frames whatever
  // exists when it runs: on a slow machine that was the 10 mm circle alone,
  // close enough that the cube's top sat BEHIND the camera and the click on
  // it landed nowhere (found by clickView's check, on a full container run).
  await page.getByTitle("Reset view").click();
  await page.evaluate(() =>
    window.__store.getState().setExtrudeSelectMode("profile"),
  );
  await page.waitForTimeout(600); // region fills materialise
  let p = await screen(0, 0, 0);
  await clickView(p, "the circle");
  const overlay = page.locator(".sketch-distance-input-overlay");
  await expect(overlay).toBeVisible({ timeout: 5000 });
  const offset = page.locator("#extrude-offset");
  const distance = page.locator("#extrude-distance");

  // Start from the cube's top face: the offset reads 25 mm.
  await page.getByTitle("Start from…", { exact: false }).click();
  p = await screen(3, 2.5, 0);
  await clickView(p, "the cube's top (Start from)");
  await expect(offset).toHaveValue("25.00");

  // Reaching the face the extrude starts from is no distance at all.
  await page.getByTitle("To… — click a face", { exact: false }).click();
  await clickView(p, "the cube's top (To, on the start face)");
  await expect
    .poll(() => page.evaluate(() => window.__store.getState().notification))
    .toMatch(/where the extrude starts/);

  // A fresh extrude from the ground (Start from also fuses into the solid it
  // picked, which this check is not about): To… the cube's top face reads
  // exactly 25 mm.
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await page.evaluate(() =>
    window.__store.getState().setExtrudeSelectMode("profile"),
  );
  await page.waitForTimeout(600);
  const centre = await screen(0, 0, 0);
  await clickView(centre, "the circle again");
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await page.getByTitle("To… — click a face", { exact: false }).click();
  p = await screen(3, 2.5, 0);
  await clickView(p, "the cube's top (To)");
  await expect(distance).toHaveValue("25");

  await distance.press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.type === "extrude")
              ?.depth ?? null,
        ),
      { timeout: 30000 },
    )
    .not.toBeNull();
  const depth = await page.evaluate(
    () =>
      window.__store.getState().items.find((i) => i.type === "extrude").depth,
  );
  expect(Number(depth)).toBe(25);
});

// A sketch placed on a body keeps cutting into it after a cut has consumed
// that body.  Sketch 16 sits on the Pi 3 case's Lid; Cut 19 drilled two holes
// from it, which hid the Lid and made Cut 19 in its place.  A second cut from
// the sketch -- the counterbore ring round a hole, 1 mm deep -- found its host
// hidden and was folded away without a word.  It must cut into Cut 19.
test("a second cut from a sketch goes into the body the first cut made", async () => {
  test.setTimeout(240000);
  const doc = JSON.parse(
    fs.readFileSync("test-files/pi3-lid-counterbore.pcad", "utf8"),
  );
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  const idle = () =>
    page.evaluate(() => {
      const s = window.__store.getState();
      return s.pendingOperations === 0 && s.regenProgress == null;
    });
  await expect.poll(idle, { timeout: 120000 }).toBe(true);
  const volume = (id) =>
    page.evaluate((id) => {
      const g = window.__store
        .getState()
        .items.find((i) => i.id === id).geometryData;
      const Q = g.positions;
      const I = g.indices;
      let v = 0;
      for (let t = 0; t < I.length; t += 3) {
        const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
        v +=
          Q[a] * (Q[b + 1] * Q[c + 2] - Q[b + 2] * Q[c + 1]) -
          Q[a + 1] * (Q[b] * Q[c + 2] - Q[b + 2] * Q[c]) +
          Q[a + 2] * (Q[b] * Q[c + 1] - Q[b + 1] * Q[c]);
      }
      return (v / 6) * 1000;
    }, id);
  const before = await volume(19);
  await page.getByTitle("Reset view").click();
  await page.evaluate(() =>
    window.__store.getState().setExtrudeSelectMode("profile"),
  );
  await page.waitForTimeout(600);
  // The ring between the 1.5 and 3.3 mm circles round the first hole, on
  // Sketch 16: sketch (x, y) is world (pos.x + x, pos.y, pos.z - y).
  const ring = await page.evaluate(() => {
    const s = window.__store.getState().items.find((i) => i.id === 16);
    const c = s.shapes[10];
    return {
      x: s.position.x + c.cx + 0.24,
      y: s.position.y,
      z: s.position.z - c.cy,
    };
  });
  await clickView(await screen(ring.x, ring.y, ring.z), "the counterbore ring");
  await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible({
    timeout: 5000,
  });
  if (
    !(await page.evaluate(
      () => window.__store.getState().extrudeDepthInput?.cut,
    ))
  )
    await page
      .getByTitle(
        "Cut — subtract this solid from the target instead of adding it",
      )
      .click();
  await page.locator("#extrude-distance").fill("-1");
  await page
    .getByTitle("Confirm — create the extrude at this distance")
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          const i = s.history[s.history.length - 1].instruction;
          // The prism is the cut's other input.
          return i.type === "create"
            ? !!i.item.regenerator?.inputIds?.includes(19)
            : false;
        }),
      { timeout: 60000 },
    )
    .toBe(true);
  await expect.poll(idle, { timeout: 60000 }).toBe(true);
  const cut = await page.evaluate(() => {
    const s = window.__store.getState();
    return s.history[s.history.length - 1].instruction.item.id;
  });
  const after = await volume(cut);
  // One 1 mm deep ring: pi * (3.3^2 - 1.5^2) mm2 * 1 mm = 27 mm3.
  expect(
    before - after,
    `Cut 19 ${before.toFixed(1)} mm3 -> ${after.toFixed(1)} mm3`,
  ).toBeGreaterThan(20);
  expect(before - after).toBeLessThan(35);
});
