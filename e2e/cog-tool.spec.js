import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

// The sketch Cog tool, driven the way a person uses it: the Draw section's
// last button opens the dialog with its Centre button live, a click places the
// centre (snapping to an existing point), Confirm adds an editable cog, and a
// double-click on its marker re-opens it.  "Break into vectors" leaves plain
// lines instead.  Extruding the cog proves the outline is a profile OCC takes,
// hole and all.

let app;
let page;

const MM_PER_UNIT = 10;
const SKETCH = 840;
// An existing point for the centre to snap to (sketch units).
const ANCHOR = { x: 3, y: 2 };

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const tool = () =>
  page.evaluate(() => window.__store.getState().sketchCogState);
const dialog = () => page.locator(".sketch-cog-overlay");
const field = (label) => dialog().getByLabel(label, { exact: true });

// Sketch-local point -> screen.  The sketch lies on the ground (rotation
// x = -90deg, at the origin), so local (x, y) is world (x, 0, -y).
const toScreen = (x, y) =>
  page.evaluate(
    ([lx, ly]) =>
      window.__store.getState()._cameraControls.worldToScreen(lx, 0, -ly),
    [x, y],
  );
const cogMarker = async () =>
  (
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.constraintMarkers(),
    )
  ).find((m) => m.type === "cog");

const setField = async (label, value, key, expected) => {
  await field(label).fill(String(value));
  await expect
    .poll(async () => (await tool()).params[key])
    .toBe(expected ?? value);
};

const snap = async (testInfo, name) => {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 15_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
};

// Area of a closed polygon (shoelace), absolute.
const area = (pts) =>
  Math.abs(
    pts.reduce((s, a, i) => {
      const b = pts[(i + 1) % pts.length];
      return s + a.x * b.y - b.x * a.y;
    }, 0) / 2,
  );

test.describe.serial("sketch Cog tool", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(
      ({ id, anchor }) => {
        const s = window.__store.getState();
        s.addItem({
          id,
          type: "sketch",
          name: "Cog sketch",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [{ type: "point", x: anchor.x, y: anchor.y }],
          constraints: [],
        });
        s.selectItem(id);
      },
      { id: SKETCH, anchor: ANCHOR },
    );
    await page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the Draw section's last button opens the dialog with Centre live", async () => {
    const draw = page.locator(".toolbar-section", { hasText: "Draw" });
    const last = draw.locator("button.toolbar-btn").last();
    await expect(last).toHaveAttribute("title", /^Cog/);
    await last.click();
    await expect(dialog()).toBeVisible();
    expect(await tool()).toMatchObject({ picking: true, centre: null });
    // Nothing to confirm until there is a centre.
    await expect(
      dialog().getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
  });

  test("a click near an existing point puts the centre exactly on it", async () => {
    const at = await toScreen(ANCHOR.x, ANCHOR.y);
    // A few pixels off: the point snaps.
    await page.mouse.move(at.x + 4, at.y - 3);
    await page.mouse.click(at.x + 4, at.y - 3);
    await expect.poll(async () => (await tool()).picking).toBe(false);
    expect((await tool()).centre).toEqual(ANCHOR);
    await expect(
      dialog().getByRole("button", { name: "Centre ✓" }),
    ).toBeVisible();
  });

  test("impossible values are explained and block Confirm", async () => {
    await setField("Teeth", 3, "teeth");
    await expect(dialog().locator(".sketch-cog-problem")).toContainText(
      "at least 6",
    );
    await expect(
      dialog().getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
    await setField("Teeth", 24, "teeth");
    await expect(dialog().locator(".sketch-cog-problem")).toBeHidden();
  });

  test("Confirm adds an editable cog, marked on its centre", async ({}, testInfo) => {
    await setField("Pitch Ø (mm)", 48, "pitchDiameter");
    // Big enough that the marker (up-right of the centre) sits well inside
    // the hole rather than on its edge, where line hover would win.
    await setField("Hole Ø (mm)", 20, "holeDiameter");
    await setField("Backlash (mm)", 0.1, "backlash");
    await setField("Root fillet (mm)", 0.4, "rootFillet");
    await snap(testInfo, "cog-preview");
    await dialog().getByRole("button", { name: "Confirm" }).click();
    await expect(dialog()).toBeHidden();

    const { shapes, constraints } = await sketch();
    const cog = shapes.find((s) => s.type === "cog");
    expect(cog).toMatchObject({ x: ANCHOR.x, y: ANCHOR.y, teeth: 24 });
    expect(cog.pitchDiameter * MM_PER_UNIT).toBeCloseTo(48, 9);
    expect(cog.holeDiameter * MM_PER_UNIT).toBeCloseTo(20, 9);
    expect(cog.backlash * MM_PER_UNIT).toBeCloseTo(0.1, 9);
    expect(cog.rootFillet * MM_PER_UNIT).toBeCloseTo(0.4, 9);
    expect(constraints).toContainEqual({
      type: "cog",
      shapeIdx: shapes.indexOf(cog),
    });

    await expect.poll(async () => !!(await cogMarker())).toBe(true);
    const m = await cogMarker();
    // Up and to the right of the centre point, like any point's marker (the
    // offset + half the marker size, in screen pixels; y is down).
    const REACH = 5 + 22 / 2;
    expect(m.middle.x - m.anchor.x).toBeCloseTo(REACH, 0);
    expect(m.middle.y - m.anchor.y).toBeCloseTo(-REACH, 0);
    const at = await toScreen(ANCHOR.x, ANCHOR.y);
    expect(Math.hypot(m.anchor.x - at.x, m.anchor.y - at.y)).toBeLessThan(1);
    await snap(testInfo, "cog-committed");
  });

  test("double-clicking its marker re-opens it, and Update changes it in place", async () => {
    const m = await cogMarker();
    await page.mouse.move(m.middle.x, m.middle.y);
    await expect(page.locator(".sketch-dim-overlay")).toHaveText(
      "Cog (double-click to edit)",
    );
    await page.waitForTimeout(400);
    await page.mouse.dblclick(m.middle.x, m.middle.y);
    await expect(dialog()).toBeVisible();
    await expect(field("Teeth")).toHaveValue("24");
    await expect(field("Pitch Ø (mm)")).toHaveValue("48");
    await setField("Teeth", 30, "teeth");
    await dialog().getByRole("button", { name: "Update" }).click();
    await expect(dialog()).toBeHidden();
    const { shapes, constraints } = await sketch();
    expect(shapes.filter((s) => s.type === "cog")).toHaveLength(1);
    expect(shapes.find((s) => s.type === "cog").teeth).toBe(30);
    expect(constraints.filter((c) => c.type === "cog")).toHaveLength(1);
  });

  test("extruding it gives a gear with the hole through it", async () => {
    const cog = (await sketch()).shapes.find((s) => s.type === "cog");
    const [outline, hole] = cog.contours;
    const mm2 = MM_PER_UNIT * MM_PER_UNIT;
    const expected = (area(outline) - area(hole)) * mm2 * 5;
    const res = await page.evaluate(
      (id) => window.__api.call("feature.extrude", { sketchId: id, depth: 5 }),
      SKETCH,
    );
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    // The outline's own area, less the hole, times the depth.
    expect(res.result.volumeMm3 / expected).toBeCloseTo(1, 2);
    // Tip diameter = pitch + 2 modules = 48 + 2 * 48 / 30.
    const tip = 48 + (2 * 48) / 30;
    // bboxMm.size is [x, y, z] in the user's Z-up frame; the sketch lies flat,
    // so the gear spans x and y.
    const [dx, dy] = res.result.bboxMm.size;
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(tip + 0.01);
    expect(Math.max(dx, dy)).toBeGreaterThan(tip - 1);
  });

  test("with Break into vectors, a new cog is plain lines instead", async () => {
    await page.evaluate(
      (id) => window.__store.getState().selectItem(id),
      SKETCH,
    );
    await page.waitForTimeout(600);
    const before = await sketch();
    const draw = page.locator(".toolbar-section", { hasText: "Draw" });
    await draw.locator("button.toolbar-btn").last().click();
    await expect(dialog()).toBeVisible();
    const at = await toScreen(-6, -6);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await tool()).picking).toBe(false);
    await dialog().getByLabel("Break into vectors").check();
    await dialog().getByRole("button", { name: "Confirm" }).click();
    await expect(dialog()).toBeHidden();
    const after = await sketch();
    const added = after.shapes.slice(before.shapes.length);
    expect(added.length).toBeGreaterThan(100);
    expect(added.every((s) => s.type === "line")).toBe(true);
    // Still exactly one cog: the earlier one.
    expect(after.shapes.filter((s) => s.type === "cog")).toHaveLength(1);
    expect(after.constraints.filter((c) => c.type === "cog")).toHaveLength(1);
  });

  // Regression, from a saved document: an extrude is matched back to its
  // sketch loop through the point that was CLICKED when it was made, and an
  // edit had left that point on bare sketch space.  Drawing a second cog over
  // that spot handed the first cog's extrude to the new cog -- the body on
  // screen jumped from one gear to the other, while the timeline's Edit still
  // highlighted the right one.  This is the RENDERED body, so only e2e sees it.
  test("a second cog in the sketch leaves the first cog's extrude on the first cog", async ({}, testInfo) => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/extrude-jump.pcad", "utf8"),
    );
    await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
    // loadDocument starts the recalculation asynchronously, so give it a moment
    // to appear before waiting for it to go -- checking straight away passed
    // while the rebuild had not begun, and measured a half-built scene.
    await page.waitForTimeout(1000);
    await expect(page.getByText(/Recalculating/)).toBeHidden({
      timeout: 60000,
    });
    await page.waitForTimeout(500);

    const cogs = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.type === "sketch")
        .shapes.filter((s) => s.type === "cog")
        .map((s) => ({
          x: s.x,
          y: s.y,
          pitch: s.pitchDiameter,
          teeth: s.teeth,
        })),
    );
    expect(cogs).toHaveLength(2);

    // The extruded body's world bounding box, in scene units.
    const box = await page.evaluate(() => {
      const d = window.__store.getState()._cameraControls.meshWorldData(2);
      const m = d.matrix;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.positions.length; i += 3) {
        const [x, y, z] = [
          d.positions[i],
          d.positions[i + 1],
          d.positions[i + 2],
        ];
        const w = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], w[k]);
          hi[k] = Math.max(hi[k], w[k]);
        }
      }
      return { lo, hi };
    });
    const centre = box.lo.map((v, k) => (v + box.hi[k]) / 2);
    const span = Math.max(box.hi[0] - box.lo[0], box.hi[2] - box.lo[2]);

    // Tip diameter = pitch + 2 modules.  A cog SHAPE holds its pitch diameter
    // in scene units (the dialog's field is the mm one).
    const tip = (c) => c.pitch + (2 * c.pitch) / c.teeth;
    expect(span, "spans cog 1, not cog 2").toBeCloseTo(tip(cogs[0]), 1);
    expect(Math.abs(span - tip(cogs[1]))).toBeGreaterThan(0.5);

    // The sketch lies on the ground, so local (x, y) is world (x, 0, -y),
    // offset by the sketch's own position.
    const sketchPos = await page.evaluate(
      () =>
        window.__store.getState().items.find((i) => i.type === "sketch")
          .position,
    );
    const worldOf = (c) => [sketchPos.x + c.x, sketchPos.z - c.y];
    const [wx1, wz1] = worldOf(cogs[0]);
    const [wx2, wz2] = worldOf(cogs[1]);
    const near = (x, z) => Math.hypot(centre[0] - x, centre[2] - z);
    expect(near(wx1, wz1), "sits over cog 1").toBeLessThan(0.3);
    expect(near(wx2, wz2), "nowhere near cog 2").toBeGreaterThan(1);
    await snap(testInfo, "two-cogs-one-extrude");
  });
});
