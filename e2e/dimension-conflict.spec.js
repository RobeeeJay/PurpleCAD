// A dimension driven by a variable, on a sketch that cannot take the new value.
//
// setVariables leaves such a sketch alone, so the label goes on reading the
// value the variable resolves to while the geometry stays where it was.  The
// annotation is drawn in red to say which dimension refused to move -- checked
// here through the app's own scene, since a label's text is baked into a canvas
// texture and never reaches the DOM.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

// One horizontal line carrying two length dimensions: a variable-driven one
// (constraint 1) and a fixed 40mm (constraint 2).  They agree only at W = 40.
const SKETCH = {
  id: 500,
  type: "sketch",
  name: "Conflict",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [{ type: "line", x1: -2, y1: 0, x2: 2, y2: 0 }],
  constraints: [
    { type: "horizontal", shapeIdx: 0 },
    {
      type: "distance",
      shapeAIdx: 0,
      pointA: "start",
      shapeBIdx: 0,
      pointB: "end",
      distance: "W",
    },
    {
      type: "distance",
      shapeAIdx: 0,
      pointA: "start",
      shapeBIdx: 0,
      pointB: "end",
      distance: "40",
    },
  ],
};

const setW = (mm) =>
  page.evaluate(
    (v) =>
      window.__store
        .getState()
        .setVariables([{ name: "W", formula: String(v) }]),
    mm,
  );

const colorsFor = (idx) =>
  page.evaluate(
    (i) =>
      window.__store.getState()._cameraControls.sketchAnnotationColors()[i] ??
      [],
    idx,
  );

// Red by channel dominance rather than an exact hex, so the check holds in
// either theme.
const isRed = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r > 140 && r > g * 2 && r > b * 2;
};
const anyRed = (list) => list.some(isRed);

const lineLengthMm = () =>
  page.evaluate(() => {
    const s = window.__store.getState().items.find((i) => i.id === 500)
      .shapes[0];
    return +(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 10).toFixed(2);
  });

test.describe.serial("a dimension the variable could not move", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((sk) => {
      const s = window.__store.getState();
      s.setVariables([{ name: "W", formula: "40" }]);
      s.addItem(sk, "Added");
      s.selectItem(sk.id);
    }, SKETCH);
    // The annotations only exist once the sketch overlay has been built.
    await expect.poll(() => colorsFor(1), { timeout: 30000 }).not.toEqual([]);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("starts out drawn like any other dimension", async () => {
    expect(await lineLengthMm()).toBeCloseTo(40, 1);
    expect(anyRed(await colorsFor(1))).toBe(false);
    expect(anyRed(await colorsFor(2))).toBe(false);
  });

  test("turns red when the sketch refuses the new value", async ({}, testInfo) => {
    await setW(60);
    await expect
      .poll(async () => anyRed(await colorsFor(1)), { timeout: 30000 })
      .toBe(true);
    // The geometry really did stay put -- this is the state being flagged.
    expect(await lineLengthMm()).toBeCloseTo(40, 1);
    // Only the variable-driven dimension is marked, not the fixed 40mm one it
    // fights: that one still reads true.
    expect(anyRed(await colorsFor(2))).toBe(false);
    expect(
      await page.evaluate(() => window.__store.getState().notification),
    ).toMatch(/red/);
    // Frame the sketch and let the toast clear (App.jsx drops it after 4s), so
    // the attached still actually SHOWS the highlighted dimension.
    await page.evaluate(() => window.__store.getState().clearNotification());
    await page
      .locator("button.home-button")
      .click()
      .catch(() => {});
    await page.waitForTimeout(2500);
    const shot = testInfo.outputPath("dimension-conflict.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("dimension-conflict", {
      path: shot,
      contentType: "image/png",
    });
  });

  test("goes back to normal once the value can be satisfied", async () => {
    await setW(40);
    await expect
      .poll(async () => anyRed(await colorsFor(1)), { timeout: 30000 })
      .toBe(false);
    expect(await lineLengthMm()).toBeCloseTo(40, 1);
  });

  test("a value the sketch CAN take is never marked", async () => {
    // Drop the fixed dimension: W is now the only thing setting the length.
    await page.evaluate(() =>
      window.__store.setState((s) => ({
        items: s.items.map((i) =>
          i.id === 500 ? { ...i, constraints: i.constraints.slice(0, 2) } : i,
        ),
      })),
    );
    await setW(60);
    await expect.poll(lineLengthMm, { timeout: 30000 }).toBeCloseTo(60, 1);
    expect(anyRed(await colorsFor(1))).toBe(false);
  });
});
