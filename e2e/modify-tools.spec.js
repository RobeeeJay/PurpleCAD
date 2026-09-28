import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The remaining modify tools driven end-to-end through their REAL dialogs:
// Boolean (union via BooleanDialog), Shell, Hole, Draft, and Split.  Picks
// are seeded through the store (raycast picking isn't DOM-addressable), but
// the dialog UI, Confirm wiring, OCC round-trip, and timeline entry are all
// the real thing.

let app;
let page;

const addCube = (id, x = 0) =>
  page.evaluate(
    ({ id, x }) => {
      window.__store.getState().addItem({
        id,
        name: `Cube ${id}`,
        type: "cube",
        children: [],
        position: { x, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    },
    { id, x },
  );

const item = (id) =>
  page.evaluate((id) => {
    const it = window.__store.getState().items.find((i) => i.id === id);
    return it
      ? {
          type: it.type,
          kind: it.regenerator?.kind ?? null,
          tris: it.geometryData ? it.geometryData.indices.length / 3 : 0,
        }
      : null;
  }, id);

test.describe.serial("modify tools through their dialogs", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("boolean union fuses two cubes via the dialog", async () => {
    await addCube(1, 0);
    await addCube(2, 1.5);
    const entriesBefore = await page.evaluate(
      () => window.__store.getState().history.length,
    );
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startBooleanTool("union");
      window.__store.setState({ selectedIds: [1, 2] });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Apply Union").click();
    // The union consumes both inputs into a NEW csg item.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .items.find((i) => i.regenerator?.kind === "boolean")?.id ??
              null,
          ),
        { timeout: 30000 },
      )
      .not.toBe(null);
    const after = await page.evaluate(() => {
      const s = window.__store.getState();
      return {
        solids: s.items.filter((i) => i.type === "csg").length,
        entries: s.history.length,
        toolOpen: !!s.booleanTool,
      };
    });
    expect(after.solids).toBe(1); // inputs consumed into one body
    expect(after.entries).toBeGreaterThan(entriesBefore);
    expect(after.toolOpen).toBe(false);
  });

  test("shell hollows a cube via the dialog", async () => {
    await addCube(11);
    await page.evaluate(() =>
      window.__store.getState().setShellTarget({ itemId: 11 }),
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Apply the shell").click();
    await expect.poll(() => item(11).then((i) => i.kind)).toBe("shell");
    expect((await item(11)).tris).toBeGreaterThan(12);
  });

  test("hole cuts a plain bore via the dialog", async () => {
    await addCube(12, 5);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startHoleTool();
      // Picks are recorded in the ITEM-LOCAL frame (the cube spans ±1
      // locally regardless of its world position).
      s.setHoleFace(12, {
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 0, y: 1, z: 0 },
      });
      s.setHolePoint({ x: 0, y: 1, z: 0 });
      s.updateHoleParams({ threaded: false, lengthMm: 12, diameterMm: 6 });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Cut the hole").click();
    await expect
      .poll(() => item(12).then((i) => i.kind), { timeout: 30000 })
      .toBe("hole");
    expect((await item(12)).tris).toBeGreaterThan(20); // bore wall added
  });

  test("draft tapers a face via the dialog", async () => {
    await addCube(13, -5);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startDraftTool();
      s.setDraftNeutral({ nx: 0, ny: 1, nz: 0, cx: -5, cy: 2, cz: 0 }, 13);
      s.toggleDraftFace({ nx: 1, ny: 0, nz: 0, cx: -4, cy: 1, cz: 0 });
    });
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await page.getByTitle("Apply the draft").click();
    await expect
      .poll(() => item(13).then((i) => i.kind), { timeout: 30000 })
      .toBe("draft");
  });

  test("material dialog applies a colour to the selected body", async () => {
    await addCube(15, -10);
    await page.evaluate(() => window.__store.getState().selectItem(15));
    await page
      .getByTitle("Material — edit the material for", { exact: false })
      .click();
    const dialog = page.locator(".variables-dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("input[type='color']").first().fill("#00ff00");
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.id === 15)?.material
              ?.color ?? null,
        ),
      )
      .toBe("#00ff00");
    await page.evaluate(() => window.__store.getState().selectItem(null));
  });

  test("split cuts a cube into two bodies via the dialog", async () => {
    await addCube(14, 10);
    const countBefore = await page.evaluate(
      () => window.__store.getState().items.length,
    );
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.startSplit3d({ objectId: 14, objectName: "Cube 14" });
      s.updateSplit3d({
        cutFrame: {
          position: { x: 10, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        cutLabel: "plane",
      });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Split the object").click();
    // The cut yields two csg halves carrying the source's name.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .items.filter(
                  (i) => i.type === "csg" && /Cube 14/.test(i.name || ""),
                ).length,
          ),
        { timeout: 30000 },
      )
      .toBe(2);
    const halves = await page.evaluate(() =>
      window.__store
        .getState()
        .items.filter((i) => i.type === "csg" && /Cube 14/.test(i.name || ""))
        .map((i) => i.geometryData.indices.length / 3),
    );
    for (const tris of halves) expect(tris).toBeGreaterThan(4);
    expect(
      await page.evaluate(() => window.__store.getState().items.length),
    ).toBeGreaterThan(countBefore);
    // Recorded as ONE Split step.  It used to add each half as its own "Added"
    // step and hide the cube with no step at all, so nothing said it was split.
    // (The old path ended on "Added" for the second half.)  The step holds both
    // halves and names the cube it came from.
    const last = await page.evaluate(() => {
      const h = window.__store.getState().history.at(-1);
      return {
        label: h.label,
        pieces: h.instruction.items?.length,
        splitFrom: h.instruction.splitFrom,
      };
    });
    expect(last).toEqual({ label: "Split", pieces: 2, splitFrom: 14 });
  });

  // The test above sets the cut directly, which is how a face-pick problem went
  // unseen: the cut phase stayed locked to whole objects, so the widget greyed
  // out faces and hover lit whole bodies, and clicking the body's own face --
  // the natural first try -- "worked" but cut nothing and returned a copy.
  // Everything here is picked with real clicks.
  test("split takes its cut from a face picked in the view", async ({}, testInfo) => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument();
      const box = (id, name, x, y, sy) => ({
        id,
        name,
        type: "cube",
        children: [],
        parentId: null,
        position: { x, y, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: sy, z: 1 },
      });
      s.addItem(box(40, "Block", 0, 1, 1)); // spans y 0..2
      s.addItem(box(41, "Step", 3, 0.5, 0.5)); // spans y 0..1: top face is y = 1
      s.selectItem(null);
    });
    await page.waitForTimeout(800);
    const at = (x, y, z) =>
      page.evaluate(
        ([x, y, z]) =>
          window.__store.getState()._cameraControls.worldToScreen(x, y, z),
        [x, y, z],
      );
    const tool = () =>
      page.evaluate(() => {
        const s = window.__store.getState();
        return {
          pick: s.splitPick,
          cut: s.splitTool?.cutLabel ?? null,
          error: s.toolError,
        };
      });
    const widgetOn = (title) =>
      page
        .locator(`.selection-widget-btn[title^="${title}"]`)
        .evaluate((b) => b.classList.contains("active"));

    await page.getByTitle(/^Split object/).click();
    expect(await widgetOn("Select objects")).toBe(true);
    let p = await at(0, 1, 1);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await tool()).pick).toBe("cut");

    // Picking the cut: the widget now offers faces, not whole objects.
    expect(await widgetOn("Select faces")).toBe(true);
    expect(await widgetOn("Select objects")).toBe(false);

    // The block's own top face lies on its surface and cuts nothing: refused,
    // with the reason on the tool's error line, and the pick stays live.
    p = await at(0.3, 2, 0.3);
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(async () => (await tool()).error)
      .toMatch(/doesn't pass through Block/);
    expect((await tool()).cut).toBeNull();
    await expect(page.locator(".tool-error-line")).toContainText(
      "doesn't pass through Block",
    );
    const file = testInfo.outputPath("split-refused.png");
    await page.screenshot({ path: file, timeout: 15_000 });
    await testInfo.attach("split-refused", {
      path: file,
      contentType: "image/png",
    });

    // The step's top face runs through the block's middle: accepted.
    p = await at(3, 1, 0);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await tool()).cut).toBe("face of Step");
    expect((await tool()).error).toBeNull();

    await page.getByTitle("Split the object").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => window.__store.getState().history.at(-1).label),
        { timeout: 30000 },
      )
      .toBe("Split");
    // Named by the body it cut -- it used to read "Split 2 extrusions".
    await expect(page.getByText("Split Block", { exact: true })).toBeVisible();
    // Cut at y = 1: one half above, one below.
    const halves = await page.evaluate(() =>
      window.__store
        .getState()
        .items.filter((i) => /^Block \(/.test(i.name))
        .map((i) => i.position.y)
        .sort(),
    );
    expect(halves).toHaveLength(2);
    expect(halves[0]).toBeCloseTo(0.5, 2);
    expect(halves[1]).toBeCloseTo(1.5, 2);
  });
});
