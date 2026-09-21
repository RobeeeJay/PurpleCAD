import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// A circle's size constraint is STORED as its radius (centre to edge) but is
// shown and typed as its diameter.  The conversion is display-only: the
// constraint in the store -- and so in every saved or exported file -- keeps
// the radius, with no new fields.

let app;
let page;

const MM_PER_UNIT = 10;
const SKETCH = 830;

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const radiusMm = async () => (await sketch()).shapes[0].r * MM_PER_UNIT;
const marker = async () =>
  (
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.constraintMarkers(),
    )
  ).find((m) => m.type === "distance");
const overlay = () => page.locator(".sketch-distance-input-overlay");

// Re-open the committed dimension the way a user does: double-click its marker.
const reopen = async () => {
  const m = await marker();
  await page.mouse.dblclick(m.middle.x, m.middle.y);
  await expect(overlay()).toBeVisible();
};
const enter = async (value) => {
  const input = overlay().locator("input");
  await input.fill(value);
  await input.press("Enter");
  await expect(overlay()).toBeHidden();
};

const snap = async (testInfo, name) => {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 15_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
};

test.describe.serial("circle dimension shown as a diameter", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.setVariables([{ name: "Dia", formula: "24" }]);
      s.addItem({
        id,
        type: "sketch",
        name: "Diameter sketch",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [{ type: "circle", cx: 0, cy: 0, r: 0.5 }],
        constraints: [
          {
            type: "distance",
            shapeAIdx: 0,
            pointA: "center",
            shapeBIdx: 0,
            pointB: "edge",
            distance: "5",
          },
        ],
      });
      s.selectItem(id);
    }, SKETCH);
    await expect.poll(async () => (await marker())?.label?.text).toBeTruthy();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("a 5 mm radius is labelled as a 10 mm diameter", async ({}, testInfo) => {
    expect((await marker()).label.text).toBe("Ø 10.0mm");
    await snap(testInfo, "circle-diameter-label");
  });

  test("the field shows the diameter, and a typed diameter is stored as the radius", async () => {
    await reopen();
    await expect(overlay()).toContainText("Edit diameter (mm):");
    await expect(overlay().locator("input")).toHaveValue("10");
    await enter("30");
    // Stored exactly as a radius would be, with nothing added.
    expect((await sketch()).constraints[0]).toEqual({
      type: "distance",
      shapeAIdx: 0,
      pointA: "center",
      shapeBIdx: 0,
      pointB: "edge",
      distance: "15",
    });
    await expect.poll(radiusMm).toBeCloseTo(15, 6);
    await expect.poll(async () => (await marker()).label.text).toBe("Ø 30.0mm");
  });

  test("a diameter formula is stored as half of it and shown back unchanged", async () => {
    await reopen();
    await enter("Dia");
    expect((await sketch()).constraints[0].distance).toBe("Dia / 2");
    await expect.poll(radiusMm).toBeCloseTo(12, 6);
    await expect
      .poll(async () => (await marker()).label.text)
      .toBe("ƒ Ø 24.0mm");
    // Re-opening shows what was typed, not "2 * (Dia / 2)".
    await reopen();
    await expect(overlay().locator("input")).toHaveValue("Dia");
    await page.keyboard.press("Escape");
    await expect(overlay()).toBeHidden();
    expect((await sketch()).constraints[0].distance).toBe("Dia / 2");
  });

  test("a new circle dimension starts from the circle's diameter", async () => {
    // The distance tool's first click on a circle opens the field with the
    // circle's current radius in scene units.
    const r = (await sketch()).shapes[0].r;
    await page.evaluate(
      (radius) =>
        window.__store.getState().setSketchDistanceInput({
          shapeAIdx: 0,
          pointA: "center",
          shapeBIdx: 0,
          pointB: "edge",
          defaultDistance: radius,
        }),
      r,
    );
    await expect(overlay()).toContainText("Diameter (mm):");
    await expect(overlay().locator("input")).toHaveValue(
      (r * MM_PER_UNIT * 2).toFixed(2),
    );
    await page.keyboard.press("Escape");
    await expect(overlay()).toBeHidden();
  });

  test("a line's length is still shown and typed as itself", async () => {
    await page.evaluate(() =>
      window.__store.getState().setSketchDistanceInput({
        shapeAIdx: 0,
        pointA: "start",
        shapeBIdx: 0,
        pointB: "end",
        defaultDistance: 1.5,
      }),
    );
    await expect(overlay()).toContainText("Distance (mm):");
    await expect(overlay().locator("input")).toHaveValue("15.00");
    await page.keyboard.press("Escape");
    await expect(overlay()).toBeHidden();
  });
});
