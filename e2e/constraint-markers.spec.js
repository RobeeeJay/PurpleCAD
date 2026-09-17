import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Sketch constraints are marked with the toolbar's own icons, a fixed number of
// screen pixels beside what they constrain: coincident up-right of its point,
// horizontal above a line's middle, vertical to its right, distance up-right of
// the middle of what it measures.  Checked in the running app: where each
// marker is drawn and how big, that it keeps both at another scale, and that
// hover, click and double-click still find it where it is drawn.

let app;
let page;

// The offset and size constants in src/three/sceneObjects/constraintIconSprites.js.
const OFFSET_PX = 10;
const SIZE_PX = 22;
const REACH = OFFSET_PX + SIZE_PX / 2; // anchor to the marker's middle

const LINES = [
  { type: "line", x1: -2, y1: -2, x2: 2, y2: -2 },
  { type: "line", x1: 2, y1: -2, x2: 2, y2: 2 },
  { type: "line", x1: 2, y1: 2, x2: -2, y2: 2 },
  { type: "line", x1: -2, y1: 2, x2: -2, y2: -2 },
];
const CONSTRAINTS = [
  ...[0, 1, 2, 3].map((k) => ({
    type: "coincident",
    shapeAIdx: k,
    pointA: "end",
    shapeBIdx: (k + 1) % 4,
    pointB: "start",
  })),
  { type: "horizontal", shapeIdx: 0 },
  { type: "vertical", shapeIdx: 1 },
  { type: "horizontal", shapeIdx: 2 },
  { type: "vertical", shapeIdx: 3 },
  ...[0, 1].map((i) => ({
    type: "distance",
    shapeAIdx: i,
    pointA: "start",
    shapeBIdx: i,
    pointB: "end",
    distance: "40",
  })),
];

// Which way each marker sits from its anchor, in client pixels (y down).  A
// distance marker sits beside its value label instead (checked separately).
const EXPECTED_OFFSET = {
  coincident: { x: REACH, y: -REACH },
  horizontal: { x: 0, y: -REACH },
  vertical: { x: REACH, y: 0 },
};
// ...except where a line's own dimension is drawn on the marker's usual side:
// the bottom edge (constraint #4) runs left to right, so its 40 mm dimension
// is drawn ABOVE it, inside the square -- its horizontal marker goes below.
// The right edge's dimension is drawn to its LEFT, so its vertical marker
// (#5) keeps its usual side.
const MOVED_OFFSET = { 4: { x: 0, y: REACH } };

const markers = () =>
  page.evaluate(() =>
    window.__store.getState()._cameraControls.constraintMarkers(),
  );

const expectPlacedAndSized = (list) => {
  for (const m of list) {
    expect(Math.abs(m.sizePx - SIZE_PX), `${m.type} size`).toBeLessThan(0.5);
    if (m.type === "distance") {
      // Beside the label's TEXT, OFFSET pixels clear of it, level with it.
      expect(m.label, "distance marker has its label").toBeTruthy();
      const gap =
        m.middle.x > m.label.x
          ? m.middle.x - SIZE_PX / 2 - (m.label.x + m.label.halfWidthPx)
          : m.label.x - m.label.halfWidthPx - (m.middle.x + SIZE_PX / 2);
      expect(gap, "gap to label").toBeCloseTo(OFFSET_PX, 0);
      expect(m.middle.y, "level with label").toBeCloseTo(m.label.y, 0);
      continue;
    }
    const want = MOVED_OFFSET[m.constraintIdx] ?? EXPECTED_OFFSET[m.type];
    expect(want, `unexpected marker type ${m.type}`).toBeTruthy();
    expect(m.middle.x - m.anchor.x, `${m.type} x offset`).toBeCloseTo(
      want.x,
      0,
    );
    expect(m.middle.y - m.anchor.y, `${m.type} y offset`).toBeCloseTo(
      want.y,
      0,
    );
  }
};

// No marker may hide another: their on-screen squares must not overlap.
const expectNoMarkerOverlaps = (list) => {
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].middle;
      const b = list[j].middle;
      const apart =
        Math.abs(a.x - b.x) >= SIZE_PX - 0.5 ||
        Math.abs(a.y - b.y) >= SIZE_PX - 0.5;
      expect(
        apart,
        `${list[i].type} #${list[i].constraintIdx} overlaps ${list[j].type} #${list[j].constraintIdx}`,
      ).toBe(true);
    }
};

// No marker may cover a dimension's value label.
const expectNoMarkerOverLabels = (list) => {
  const labels = list.filter((m) => m.label).map((m) => m.label);
  for (const m of list) {
    for (const l of labels) {
      const clear =
        Math.abs(m.middle.x - l.x) >= SIZE_PX / 2 + l.halfWidthPx - 0.5 ||
        Math.abs(m.middle.y - l.y) >= SIZE_PX / 2 + l.halfHeightPx - 0.5;
      expect(
        clear,
        `${m.type} #${m.constraintIdx} covers the label at ${Math.round(l.x)},${Math.round(l.y)}`,
      ).toBe(true);
    }
  }
};

const snap = async (testInfo, name) => {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 15_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
};

test.describe.serial("sketch constraint markers", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(
      ({ shapes, constraints }) => {
        const s = window.__store.getState();
        s.addItem({
          id: 820,
          type: "sketch",
          name: "Marker sketch",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints,
        });
        s.selectItem(820);
      },
      { shapes: LINES, constraints: CONSTRAINTS },
    );
    await page.waitForTimeout(1800);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("every constraint shows its toolbar icon, offset from what it constrains", async ({}, testInfo) => {
    await expect.poll(async () => (await markers()).length).toBe(10);
    const list = await markers();
    const count = (t) => list.filter((m) => m.type === t).length;
    expect([
      count("coincident"),
      count("horizontal"),
      count("vertical"),
      count("distance"),
    ]).toEqual([4, 2, 2, 2]);
    expectPlacedAndSized(list);
    expectNoMarkerOverlaps(list);
    expectNoMarkerOverLabels(list);
    // The artwork sits on a transparent background.
    expect(list.map((m) => m.backgroundAlpha)).toEqual(list.map(() => 0));
    await snap(testInfo, "constraint-markers");
  });

  test("markers keep their pixel size and offset at another scale", async () => {
    const [w, h] = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [width, height] = win.getSize();
      win.setSize(width, Math.round(height * 0.65));
      return [width, height];
    });
    const heightBefore = h;
    await expect
      .poll(() => page.evaluate(() => window.innerHeight))
      .toBeLessThan(heightBefore);
    await page.waitForTimeout(400);
    expectPlacedAndSized(await markers());
    await app.evaluate(
      async ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]),
      [w, h],
    );
    await page.waitForTimeout(400);
    expectPlacedAndSized(await markers());
  });

  test("hovering a marker where it is DRAWN names its constraint", async () => {
    const vertical = (await markers()).find((m) => m.type === "vertical");
    await page.mouse.move(vertical.middle.x, vertical.middle.y);
    await expect(page.locator(".sketch-dim-overlay")).toHaveText("Vertical");
    // The anchor itself (on the line) is no longer the marker.
    await page.mouse.move(vertical.anchor.x - 40, vertical.anchor.y - 40);
    await expect(page.locator(".sketch-dim-overlay")).toBeHidden();
  });

  test("clicking a marker selects its constraint and shows it selected", async ({}, testInfo) => {
    const horizontal = (await markers()).find((m) => m.type === "horizontal");
    await page.mouse.click(horizontal.middle.x, horizontal.middle.y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().selectedSketchConstraintIdx,
        ),
      )
      .toBe(horizontal.constraintIdx);
    const now = await markers();
    expect(now.filter((m) => m.selected).map((m) => m.constraintIdx)).toEqual([
      horizontal.constraintIdx,
    ]);
    // Selected shows as an outline; the background stays clear.
    expect(
      now.find((m) => m.constraintIdx === horizontal.constraintIdx)
        .backgroundAlpha,
    ).toBe(0);
    await snap(testInfo, "constraint-marker-selected");
    // Clicking it again -- after a pause, or it is a double-click -- clears
    // the selection.
    await page.waitForTimeout(400);
    await page.mouse.click(horizontal.middle.x, horizontal.middle.y);
    await expect
      .poll(async () => (await markers()).some((m) => m.selected))
      .toBe(false);
  });

  test("double-clicking a distance marker opens its value to edit", async () => {
    const distance = (await markers()).find((m) => m.type === "distance");
    await page.mouse.dblclick(distance.middle.x, distance.middle.y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().sketchDistanceInput?.constraintIdx,
        ),
      )
      .toBe(distance.constraintIdx);
    await page.keyboard.press("Escape");
  });
});
