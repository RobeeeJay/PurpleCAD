import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The sketch Centre constraint through its real UI: the toolbar button, the
// Shape A / Shape B dialog, hover preview, real clicks on the geometry, offsets
// (a number and a variable), Confirm, re-opening the constraint from its icon,
// and the constraint holding when Shape B is dragged or a variable changes.

let app;
let page;

const SKETCH = 610;
const A = [0, 1, 2, 3];
const B = [4, 5, 6, 7];

// A square of joined lines, sides kept H/V and dimensioned -- how a user would
// draw one.  Scene units (1 = 10 mm); dimensions are mm formulas.
const square = (x0, y0, size, base) => ({
  shapes: [
    { type: "line", x1: x0, y1: y0, x2: x0 + size, y2: y0 },
    { type: "line", x1: x0 + size, y1: y0, x2: x0 + size, y2: y0 + size },
    { type: "line", x1: x0 + size, y1: y0 + size, x2: x0, y2: y0 + size },
    { type: "line", x1: x0, y1: y0 + size, x2: x0, y2: y0 },
  ],
  constraints: [
    ...[0, 1, 2, 3].map((k) => ({
      type: "coincident",
      shapeAIdx: base + k,
      pointA: "end",
      shapeBIdx: base + ((k + 1) % 4),
      pointB: "start",
    })),
    { type: "horizontal", shapeIdx: base },
    { type: "vertical", shapeIdx: base + 1 },
    { type: "horizontal", shapeIdx: base + 2 },
    { type: "vertical", shapeIdx: base + 3 },
    ...[base, base + 1].map((i) => ({
      type: "distance",
      shapeAIdx: i,
      pointA: "start",
      shapeBIdx: i,
      pointB: "end",
      distance: String(size * 10),
    })),
  ],
});

const sketch = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id),
    SKETCH,
  );
const tool = () =>
  page.evaluate(() => window.__store.getState().sketchCentreState);

// Centre of a set of lines (they are all axis-aligned here).
const centreOf = (shapes, idxs) => {
  const xs = idxs.flatMap((i) => [shapes[i].x1, shapes[i].x2]);
  const ys = idxs.flatMap((i) => [shapes[i].y1, shapes[i].y2]);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};
const side = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

// Sketch-local point -> screen.  The sketch lies on the ground (rotation
// x = -90deg, at the origin), so local (x, y) is world (x, 0, -y).
const toScreen = (x, y) =>
  page.evaluate(
    ([lx, ly]) =>
      window.__store.getState()._cameraControls.worldToScreen(lx, 0, -ly),
    [x, y],
  );
// A point on a line's body, a quarter of the way along (clear of the corners
// and of any icon at the middle).
// Written to a file and attached, so the drawn preview can be LOOKED at --
// the assertions check what was picked, not what was drawn.
const snap = async (testInfo, name) => {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 15_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
};
const onLine = (s) =>
  toScreen(s.x1 + (s.x2 - s.x1) * 0.25, s.y1 + (s.y2 - s.y1) * 0.25);

test.describe.serial("sketch Centre constraint", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    const a = square(-6, -1, 2, 0);
    const b = square(1, -2, 4, 4);
    await page.evaluate(
      ({ id, shapes, constraints }) => {
        const s = window.__store.getState();
        s.setVariables([{ name: "Lift", formula: "5" }]);
        s.addItem({
          id,
          type: "sketch",
          name: "Centre sketch",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints,
        });
        s.selectItem(id);
      },
      {
        id: SKETCH,
        shapes: [...a.shapes, ...b.shapes],
        constraints: [...a.constraints, ...b.constraints],
      },
    );
    await page.waitForTimeout(1800); // sketch-mode fly-in settles
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the Centre button opens the dialog with Shape A live", async () => {
    await page
      .getByTitle("Centre — put the centre of one shape", { exact: false })
      .click();
    const dialog = page.locator(".sketch-centre-overlay");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Shape A" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Shape B" })).toBeVisible();
    await expect(page.locator(".sketch-placement-hint")).toContainText(
      "Shape A",
    );
    expect((await tool()).picking).toBe("A");
    // Nothing picked yet, so there is nothing to confirm.
    await expect(
      dialog.getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
  });

  test("hovering a shape previews it, and a click picks the whole connected shape", async ({}, testInfo) => {
    const shapes = (await sketch()).shapes;
    const overA = await onLine(shapes[0]);
    await page.mouse.move(overA.x, overA.y);
    // The cursor says a click here would pick something.
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("canvas").style.cursor),
      )
      .toBe("pointer");
    await snap(testInfo, "hover-shape-a");

    await page.mouse.click(overA.x, overA.y);
    await expect.poll(async () => (await tool()).shapesA).toEqual(A);
    // Picking A moves straight on to B.
    expect((await tool()).picking).toBe("B");
    await expect(page.locator(".sketch-placement-hint")).toContainText(
      "Shape B",
    );

    // Empty canvas offers nothing to pick.
    const empty = await toScreen(-2, 6);
    await page.mouse.move(empty.x, empty.y);
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("canvas").style.cursor),
      )
      .toBe("");

    const overB = await onLine(shapes[5]);
    await page.mouse.click(overB.x, overB.y);
    await expect.poll(async () => (await tool()).shapesB).toEqual(B);
    expect((await tool()).picking).toBe(null);
    const dialog = page.locator(".sketch-centre-overlay");
    await expect(
      dialog.getByRole("button", { name: "Shape A ✓" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Shape B ✓" }),
    ).toBeVisible();
    await snap(testInfo, "both-picked-ghost");
  });

  test("Confirm centres A on B with the offsets, and A keeps its size", async ({}, testInfo) => {
    const before = (await sketch()).shapes;
    const dialog = page.locator(".sketch-centre-overlay");
    await dialog.getByLabel("Offset X (mm)").fill("10");
    // A variable works as well as a number.
    await dialog.getByLabel("Offset Y (mm)").fill("Lift");
    await dialog.getByRole("button", { name: "Confirm" }).click();

    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    await snap(testInfo, "centred-with-offset");
    const { shapes, constraints } = await sketch();
    const a = centreOf(shapes, A);
    const b = centreOf(shapes, B);
    expect(a.x - b.x).toBeCloseTo(1, 2); // 10 mm
    expect(a.y - b.y).toBeCloseTo(0.5, 2); // Lift = 5 mm
    for (const i of A) expect(side(shapes[i])).toBeCloseTo(2, 3);
    for (const i of B) expect(shapes[i]).toEqual(before[i]);
    expect(constraints.at(-1)).toEqual({
      type: "centre",
      shapesA: A,
      shapesB: B,
      offsetX: "10",
      offsetY: "Lift",
    });
  });

  test("double-clicking the constraint's icon re-opens it and edits it in place", async () => {
    const { shapes, constraints } = await sketch();
    const count = constraints.length;
    // The constraint's marker sits beside A's centre; aim at where it is drawn.
    const icon = (
      await page.evaluate(() =>
        window.__store.getState()._cameraControls.constraintMarkers(),
      )
    ).find((m) => m.type === "centre").middle;
    await page.mouse.dblclick(icon.x, icon.y);
    const dialog = page.locator(".sketch-centre-overlay");
    await expect(dialog).toBeVisible();
    expect(await tool()).toMatchObject({
      editIdx: count - 1,
      shapesA: A,
      shapesB: B,
      offsetX: "10",
      offsetY: "Lift",
    });
    await expect(dialog.getByLabel("Offset X (mm)")).toHaveValue("10");
    await expect(dialog.getByLabel("Offset Y (mm)")).toHaveValue("Lift");

    await dialog.getByLabel("Offset X (mm)").fill("0");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toBeHidden();

    const after = await sketch();
    expect(after.constraints.length).toBe(count);
    expect(after.constraints[count - 1].offsetX).toBe("0");
    expect(centreOf(after.shapes, A).x).toBeCloseTo(
      centreOf(after.shapes, B).x,
      2,
    );
  });

  test("changing the variable moves A to the new offset", async () => {
    await page.evaluate(() =>
      window.__store.getState().setVariables([{ name: "Lift", formula: "15" }]),
    );
    await expect
      .poll(async () => {
        const { shapes } = await sketch();
        return centreOf(shapes, A).y - centreOf(shapes, B).y;
      })
      .toBeCloseTo(1.5, 2);
  });

  test("dragging Shape B carries Shape A with it", async () => {
    const { shapes } = await sketch();
    const grab = await onLine(shapes[4]); // B's bottom edge
    const to = await toScreen(
      shapes[4].x1 + (shapes[4].x2 - shapes[4].x1) * 0.25 + 1.5,
      shapes[4].y1,
    );
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const s = (await sketch()).shapes;
        return centreOf(s, B).x - centreOf(shapes, B).x;
      })
      .toBeGreaterThan(0.5); // B really moved
    const after = (await sketch()).shapes;
    const a = centreOf(after, A);
    const b = centreOf(after, B);
    expect(a.x - b.x).toBeCloseTo(0, 2);
    expect(a.y - b.y).toBeCloseTo(1.5, 2);
    for (const i of A) expect(side(after[i])).toBeCloseTo(2, 2);
  });
});
