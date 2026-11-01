import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// A selection highlight is a standalone scene object, not part of the sketch
// group React rebuilds, so anything that moves the geometry can leave it behind
// at the old place.  Each test selects something through the real input, moves
// it through a real path, and compares where the highlight is drawn with where
// the geometry went.  They aren't serial: one stale highlight shouldn't hide the
// next case.

let app;
let page;
const SKETCH = 730;
const TOL = 0.02;

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const highlights = () =>
  page.evaluate(() =>
    window.__store.getState()._cameraControls.selectionHighlights(),
  );

// Sketch-local to screen with the app's own projection.  The sketch sits on the
// plane its rotation of -90 degrees about X makes: local (x, y) is world (x, 0, -y).
const screenAt = (x, y) =>
  page.evaluate(
    ({ x, y }) =>
      window.__store.getState()._cameraControls.worldToScreen(x, 0, -y),
    { x, y },
  );
const clickAt = async (x, y) => {
  const p = await screenAt(x, y);
  await page.mouse.click(p.x, p.y);
};
const shiftClickAt = async (x, y) => {
  await page.keyboard.down("Shift");
  await clickAt(x, y);
  await page.keyboard.up("Shift");
};

async function place(shapes, constraints = []) {
  await page.evaluate(
    ({ id, shapes, constraints }) => {
      const s = window.__store.getState();
      s.setSketchConstraintMode(null);
      s.setSketchDistanceInput(null);
      s.setSketchAngleInput(null);
      s.setVariables([]);
      window.__store.setState({
        items: window.__store
          .getState()
          .items.map((i) => (i.id === id ? { ...i, shapes, constraints } : i)),
      });
    },
    { id: SKETCH, shapes, constraints },
  );
  await page.waitForTimeout(300);
}

// A wide margin on every side of the highlight's box, against a line's box.
const expectOnLine = (h, line, what) => {
  const msg = `${what}: highlight ${JSON.stringify(h)} against ${JSON.stringify(line)}`;
  expect(Math.abs(h.minX - Math.min(line.x1, line.x2)), msg).toBeLessThan(TOL);
  expect(Math.abs(h.maxX - Math.max(line.x1, line.x2)), msg).toBeLessThan(TOL);
  expect(Math.abs(h.minY - Math.min(line.y1, line.y2)), msg).toBeLessThan(TOL);
  expect(Math.abs(h.maxY - Math.max(line.y1, line.y2)), msg).toBeLessThan(TOL);
};
const expectRingAt = (h, p, what) => {
  const msg = `${what}: ring ${JSON.stringify(h)} against ${JSON.stringify(p)}`;
  expect(Math.abs((h.minX + h.maxX) / 2 - p.x), msg).toBeLessThan(TOL);
  expect(Math.abs((h.minY + h.maxY) / 2 - p.y), msg).toBeLessThan(TOL);
};

test.describe("sketch selection highlights follow the geometry", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        type: "sketch",
        name: "HL",
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

  test.afterEach(async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("a selected line follows a horizontal constraint", async () => {
    await place([L(-3, 0, 3, 2)]);
    await clickAt(0, 1);
    expect((await highlights()).map((h) => h.kind)).toEqual(["single"]);
    await page.getByTitle(/^Horizontal/).click();
    const line = (await sketch()).shapes[0];
    expect(line.y1, "the line moved").toBeCloseTo(line.y2, 3);
    expectOnLine((await highlights())[0], line, "horizontal");
  });

  test("a selected line follows an edited dimension", async () => {
    await place(
      [L(-3, 0, 3, 0)],
      [
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "60",
        },
      ],
    );
    await clickAt(0, 0);
    await page.evaluate(() =>
      window.__store.getState().setSketchDistanceInput({
        shapeAIdx: 0,
        pointA: "start",
        shapeBIdx: 0,
        pointB: "end",
        defaultDistance: "60",
        constraintIdx: 0,
      }),
    );
    const field = page.locator(".sketch-distance-input-overlay input");
    await field.fill("30");
    await field.press("Enter");
    const line = (await sketch()).shapes[0];
    expect(Math.abs(line.x2 - line.x1), "the line moved").toBeCloseTo(3, 2);
    expectOnLine((await highlights())[0], line, "edited dimension");
  });

  test("a selected line follows a variable its dimension is written in", async () => {
    await place(
      [L(-3, 0, 3, 0)],
      [
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "HLen",
        },
      ],
    );
    await page.evaluate(() =>
      window.__store.getState().setVariables([{ name: "HLen", formula: "60" }]),
    );
    await clickAt(0, 0);
    await page.evaluate(() =>
      window.__store.getState().setVariables([{ name: "HLen", formula: "30" }]),
    );
    await expect
      .poll(async () => {
        const l = (await sketch()).shapes[0];
        return Math.abs(l.x2 - l.x1);
      })
      .toBeCloseTo(3, 2);
    await page.waitForTimeout(200);
    expectOnLine(
      (await highlights())[0],
      (await sketch()).shapes[0],
      "variable",
    );
  });

  test("a selected endpoint's ring follows a variable", async () => {
    await place(
      [L(-3, 0, 3, 0)],
      [
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "HLen",
        },
      ],
    );
    await page.evaluate(() =>
      window.__store.getState().setVariables([{ name: "HLen", formula: "60" }]),
    );
    await clickAt(3, 0);
    const sel = await page.evaluate(
      () => window.__store.getState().selectedSketchElement,
    );
    expect(sel).toMatchObject({ type: "point", pointKey: "end" });
    await page.evaluate(() =>
      window.__store.getState().setVariables([{ name: "HLen", formula: "30" }]),
    );
    await expect
      .poll(async () => {
        const l = (await sketch()).shapes[0];
        return Math.abs(l.x2 - l.x1);
      })
      .toBeCloseTo(3, 2);
    await page.waitForTimeout(200);
    const l = (await sketch()).shapes[0];
    expectRingAt((await highlights())[0], { x: l.x2, y: l.y2 }, "endpoint");
  });

  test("two selected lines follow a parallel constraint", async () => {
    await place([L(-3, 0, 3, 0), L(-3, 3, 3, 5)]);
    await clickAt(0, 0);
    await shiftClickAt(0, 4);
    expect((await highlights()).map((h) => h.shapeIdx)).toEqual([0, 1]);
    await page.getByTitle(/^Parallel/).click();
    const it = await sketch();
    const dir = (s) => (s.y2 - s.y1) / (s.x2 - s.x1);
    expect(dir(it.shapes[0]), "the lines moved").toBeCloseTo(
      dir(it.shapes[1]),
      3,
    );
    const hs = await highlights();
    expectOnLine(hs[0], it.shapes[0], "first line");
    expectOnLine(hs[1], it.shapes[1], "second line");
  });

  test("two selected lines follow an angle", async () => {
    await place([L(0, 0, 4, 0), L(0, 0, 3, 3)]);
    await clickAt(2, 0);
    await shiftClickAt(1.5, 1.5);
    await page.getByTitle(/^Angle/).click();
    const field = page.locator(".sketch-distance-input-overlay input");
    await field.fill("70");
    await field.press("Enter");
    await expect(field).toHaveCount(0);
    const it = await sketch();
    const hs = await highlights();
    expectOnLine(hs[0], it.shapes[0], "first line");
    expectOnLine(hs[1], it.shapes[1], "second line");
  });

  test("a selected point's ring follows a midpoint constraint", async () => {
    // The ring is what the midpoint moves: it pins the point to the line.
    await place([L(-3, 0, 3, 0), { type: "point", x: 2, y: 4 }]);
    await clickAt(2, 4);
    await shiftClickAt(-1, 0);
    expect((await highlights()).length).toBe(2);
    await page.getByTitle(/^Midpoint/).click();
    const it = await sketch();
    const pt = it.shapes[1];
    const line = it.shapes[0];
    expect(pt.x, "the point moved").toBeCloseTo((line.x1 + line.x2) / 2, 2);
    expect(pt.y, "the point moved").toBeCloseTo((line.y1 + line.y2) / 2, 2);
    const hs = await highlights();
    expectRingAt(hs[0], pt, "point ring");
    expectOnLine(hs[1], line, "line");
  });

  test("a coincident constraint leaves no highlight behind", async () => {
    await place([L(-3, 0, 0, 0), L(3, 3, 6, 3)]);
    await clickAt(0, 0);
    expect((await highlights()).map((h) => h.kind)).toEqual(["single"]);
    await page.getByTitle(/^Coincident/).click();
    await clickAt(0, 0);
    await clickAt(3, 3);
    const it = await sketch();
    expect(it.constraints.map((c) => c.type)).toContain("coincident");
    expect(
      Math.hypot(
        it.shapes[0].x2 - it.shapes[1].x1,
        it.shapes[0].y2 - it.shapes[1].y1,
      ),
      "the ends met",
    ).toBeLessThan(0.01);
    // The tool takes over the selection, so nothing is left at the old place.
    await expect.poll(highlights).toEqual([]);
  });

  test("Escape in the distance field drops the line it had picked", async () => {
    await place([L(-3, 0, 3, 0)]);
    await page.keyboard.press("d");
    await clickAt(0, 0);
    const field = page.locator(".sketch-distance-input-overlay input");
    await expect(field).toBeFocused();
    expect((await highlights()).map((h) => h.kind)).toContain("pick");
    await field.press("Escape");
    await expect
      .poll(async () => (await highlights()).filter((h) => h.kind === "pick"))
      .toEqual([]);
  });

  test("leaving the distance tool from the toolbar drops the line it had picked", async () => {
    await place([L(-3, 0, 3, 0)]);
    await page.locator('button[title^="Distance"]').click();
    await clickAt(0, 0);
    expect((await highlights()).map((h) => h.kind)).toContain("pick");
    await page.locator('button[title^="Distance"]').click();
    await expect
      .poll(async () => (await highlights()).filter((h) => h.kind === "pick"))
      .toEqual([]);
  });
});
