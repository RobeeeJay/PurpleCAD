import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The field shown while drawing a line or circle: it takes focus, so a size is
// simply typed, and only a typed size adds a dimension.

let app;
let page;

const SKETCH = 710;
const size = () => page.viewportSize() || { width: 1400, height: 868 };
const at = (fx, fy) => ({ x: size().width * fx, y: size().height * fy });

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const field = () => page.locator(".sketch-draw-length-overlay input");
const lineLength = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

async function clearSketch() {
  await page.keyboard.press("Escape");
  await page.evaluate((id) => {
    const s = window.__store.getState();
    s.setActiveSketchTool(null);
    window.__store.setState({
      items: s.items.map((i) =>
        i.id === id ? { ...i, shapes: [], constraints: [] } : i,
      ),
    });
  }, SKETCH);
  await page.waitForTimeout(200);
}

async function startDrawing(tool, from) {
  await page.evaluate(
    (t) => window.__store.getState().setActiveSketchTool(t),
    tool,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.click(from.x, from.y);
  await expect(field()).toBeFocused();
}

test.describe.serial("sizing a shape while drawing it", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        type: "sketch",
        name: "DL",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(id);
    }, SKETCH);
    await page.waitForTimeout(1600);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test.afterEach(clearSketch);

  test("a line typed in the field gets that length and a dimension", async () => {
    await startDrawing("line", at(0.55, 0.4));
    const aim = at(0.7, 0.3);
    await page.mouse.move(aim.x, aim.y);
    // The field reports what the cursor measures without being edited.
    await expect
      .poll(async () => Number(await field().getAttribute("placeholder")))
      .toBeGreaterThan(0);

    await page.keyboard.type("40");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await sketch()).shapes.length).toBe(1);
    const it = await sketch();
    expect(lineLength(it.shapes[0])).toBeCloseTo(4, 6);
    expect(it.constraints).toContainEqual({
      type: "distance",
      shapeAIdx: 0,
      pointA: "start",
      shapeBIdx: 0,
      pointB: "end",
      distance: "40",
    });
    // The chain carries on, with an empty field ready for the next segment.
    await expect(field()).toBeFocused();
    await expect(field()).toHaveValue("");
  });

  test("a click takes the typed length, and only aims the line", async () => {
    await startDrawing("line", at(0.55, 0.4));
    await page.keyboard.type("25");
    const end = at(0.75, 0.55);
    await page.mouse.move(end.x, end.y);
    await page.mouse.click(end.x, end.y);

    await expect.poll(async () => (await sketch()).shapes.length).toBe(1);
    const it = await sketch();
    expect(lineLength(it.shapes[0])).toBeCloseTo(2.5, 6);
    expect(it.constraints.map((c) => c.type)).toContain("distance");
  });

  test("a line drawn without editing the field gets no dimension", async () => {
    await startDrawing("line", at(0.55, 0.4));
    const end = at(0.7, 0.55);
    await page.mouse.move(end.x, end.y);
    await page.mouse.click(end.x, end.y);

    await expect.poll(async () => (await sketch()).shapes.length).toBe(1);
    expect((await sketch()).constraints.map((c) => c.type)).not.toContain(
      "distance",
    );
  });

  test("a formula is kept, so the dimension follows the variable", async () => {
    await page.evaluate(() =>
      window.__store
        .getState()
        .setVariables([{ name: "DrawLen", formula: "35" }]),
    );
    await startDrawing("line", at(0.55, 0.4));
    await page.keyboard.type("DrawLen");
    await expect(field()).toHaveValue("DrawLen");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await sketch()).shapes.length).toBe(1);
    const it = await sketch();
    expect(lineLength(it.shapes[0])).toBeCloseTo(3.5, 6);
    expect(it.constraints.find((c) => c.type === "distance").distance).toBe(
      "DrawLen",
    );
  });

  test("a circle's field takes the diameter and ends the tool", async () => {
    await startDrawing("circle", at(0.6, 0.45));
    await expect(page.locator(".sketch-draw-length-overlay")).toContainText(
      "Diameter",
    );
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await sketch()).shapes.length).toBe(1);
    const it = await sketch();
    expect(it.shapes[0].r).toBeCloseTo(1.5, 6);
    expect(it.constraints).toContainEqual({
      type: "distance",
      shapeAIdx: 0,
      pointA: "center",
      shapeBIdx: 0,
      pointB: "edge",
      distance: "15",
    });
    await expect(field()).toHaveCount(0);
  });

  test("a size that isn't positive draws nothing and keeps the field open", async () => {
    await startDrawing("line", at(0.55, 0.4));
    await page.keyboard.type("0");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);

    expect((await sketch()).shapes.length).toBe(0);
    await expect(field()).toBeFocused();
    await expect(field()).toHaveValue("0");
  });

  test("Escape in the field cancels the shape being drawn", async () => {
    await startDrawing("line", at(0.55, 0.4));
    await page.keyboard.type("40");
    await page.keyboard.press("Escape");

    await expect(field()).toHaveCount(0);
    expect((await sketch()).shapes.length).toBe(0);
  });
});
