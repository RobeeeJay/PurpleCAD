import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The angle constraint through the real toolbar, field and marker: vitest
// renders no components and has no sketch view to double-click on.

let app;
let page;
const SKETCH = 720;

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const angleOf = (a, b, sense) =>
  (Math.atan2(
    Math.abs((a.x2 - a.x1) * (b.y2 - b.y1) - (a.y2 - a.y1) * (b.x2 - b.x1)),
    ((a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1)) * sense,
  ) *
    180) /
  Math.PI;
const field = () => page.locator(".sketch-distance-input-overlay input");

test.describe.serial("angle constraint", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        type: "sketch",
        name: "Ang",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(id);
      s.addSketchShapes(
        id,
        [
          { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
          { type: "line", x1: 0, y1: 0, x2: 3, y2: 3 },
        ],
        [
          {
            type: "coincident",
            shapeAIdx: 0,
            pointA: "start",
            shapeBIdx: 1,
            pointB: "start",
          },
        ],
      );
    }, SKETCH);
    await page.waitForTimeout(1600);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the button waits for two lines to be selected", async () => {
    await expect(page.getByTitle(/^Angle/)).toBeDisabled();
  });

  test("two selected lines take an angle typed into its field", async () => {
    await page.evaluate(() =>
      window.__store.getState().setSketchMultiSelectedIndices([0, 1]),
    );
    await page.getByTitle(/^Angle/).click();
    await expect(field()).toBeFocused();
    await expect(field()).toHaveValue("45.00");
    await field().fill("60");
    await field().press("Enter");

    await expect
      .poll(async () => {
        const it = await sketch();
        return angleOf(it.shapes[0], it.shapes[1], 1);
      })
      .toBeCloseTo(60, 2);
    await expect(field()).toHaveCount(0);
    const it = await sketch();
    expect(it.constraints.at(-1)).toMatchObject({
      type: "angleDimension",
      shapeAIdx: 0,
      shapeBIdx: 1,
      angle: "60",
    });
  });

  test("the sketch draws the dimension, and its marker re-opens the field", async () => {
    const marker = await page.evaluate(() =>
      window.__store
        .getState()
        ._cameraControls.constraintMarkers()
        .find((m) => m.type === "angleDimension"),
    );
    expect(marker, "the dimension has a marker").toBeTruthy();
    expect(marker.label, "the marker sits beside its value").toBeTruthy();
    await page.mouse.dblclick(marker.middle.x, marker.middle.y);
    await expect(field()).toHaveValue("60");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().sketchAngleInput?.constraintIdx,
        ),
      )
      .toBe(marker.constraintIdx);
    await field().press("Escape");
    await expect(field()).toHaveCount(0);
  });

  test("an edit updates the same dimension and moves the line", async () => {
    const idx = (await sketch()).constraints.length - 1;
    await page.evaluate(
      ({ idx }) =>
        window.__store.getState().setSketchAngleInput({
          shapeAIdx: 0,
          shapeBIdx: 1,
          defaultAngle: "60",
          constraintIdx: idx,
        }),
      { idx },
    );
    await field().fill("35");
    await field().press("Enter");
    await expect
      .poll(async () => {
        const it = await sketch();
        return angleOf(it.shapes[0], it.shapes[1], 1);
      })
      .toBeCloseTo(35, 2);
    expect((await sketch()).constraints).toHaveLength(idx + 1);
  });

  test("the angle holds while a line is nudged", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.setSketchMultiSelectedIndices([]);
      s.setSelectedSketchElement({ type: "line", shapeIdx: 1 });
    });
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    const it = await sketch();
    expect(angleOf(it.shapes[0], it.shapes[1], 1)).toBeCloseTo(35, 2);
  });
});
