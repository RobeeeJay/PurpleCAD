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

  // A Split's halves used to be stored as finished meshes, so a resolution
  // change left them as blocky as when they were cut while the rest of the
  // model went fine.  They now carry a recipe the recalculation re-cuts.
  test("split halves follow a change of resolution", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument();
      s.addItem({
        id: 60,
        name: "Post",
        type: "cylinder",
        children: [],
        parentId: null,
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.startSplit3d({ objectId: 60, objectName: "Post" });
      // Across the post's middle: normal +y.
      s.updateSplit3d({
        cutFrame: {
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        },
        cutLabel: "plane",
      });
    });
    await page.getByTitle("Split the object").click();
    const halves = () =>
      page.evaluate(() =>
        window.__store
          .getState()
          .items.filter((i) => /^Post \(/.test(i.name))
          .map((i) => ({
            kind: i.regenerator?.kind ?? null,
            tris: i.geometryData.indices.length / 3,
          })),
      );
    await expect.poll(async () => (await halves()).length).toBe(2);
    const before = await halves();
    expect(before.map((h) => h.kind)).toEqual(["split", "split"]);

    await page.evaluate(() => {
      window.__store.getState().setResolutionMm(0.01);
    });
    await page.locator(".timeline-recalc-btn").click();
    // How many times over the half that grew least has its triangles.
    const growth = async () => {
      const after = await halves();
      return Math.min(...after.map((h, k) => h.tris / before[k].tris));
    };
    await expect
      .poll(growth, {
        timeout: 60000,
        message: `halves had ${before.map((h) => h.tris)} triangles`,
      })
      .toBeGreaterThan(2);
    await page.evaluate(() => window.__store.getState().setResolutionMm(0.05));
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

  test("simplify reduces a mesh body, and its timeline Edit re-runs it", async () => {
    // A dense closed sphere standing in for an imported STL, selected, in a
    // new document: the split test before this one uses ids 40 and 41.
    await page.evaluate(() => {
      window.__store.getState().newDocument();
      const seg = 48;
      const positions = [0, 1, 0];
      for (let i = 1; i < seg; i++)
        for (let j = 0; j < seg; j++) {
          const v = (i / seg) * Math.PI;
          const u = (j / seg) * 2 * Math.PI;
          positions.push(
            Math.sin(v) * Math.cos(u),
            Math.cos(v),
            Math.sin(v) * Math.sin(u),
          );
        }
      positions.push(0, -1, 0);
      const south = positions.length / 3 - 1;
      const at = (i, j) =>
        i === 0 ? 0 : i === seg ? south : 1 + (i - 1) * seg + (j % seg);
      const indices = [];
      for (let i = 0; i < seg; i++)
        for (let j = 0; j < seg; j++) {
          if (i !== 0) indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
          if (i !== seg - 1)
            indices.push(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
        }
      const s = window.__store.getState();
      s.addItem({
        id: 60,
        name: "Ball (STL)",
        type: "csg",
        children: [],
        position: { x: 0, y: 1, z: -6 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: { positions, indices, normals: null, flat: true },
      });
      window.__store.setState({ selectedId: 60, selectedIds: [60] });
    });
    const tris = () =>
      page.evaluate(() => {
        const it = window.__store.getState().items.find((i) => i.id === 60);
        return it.geometryData ? it.geometryData.indices.length / 3 : null;
      });
    const before = await tris();

    await page
      .getByTitle("Simplify — fewer triangles", { exact: false })
      .click();
    await page.locator("#simplify-tolerance").fill("0.2");
    // The preview runs the op through IPC and reports what it would do.
    await expect(page.locator(".sketch-placement-hint")).toContainText(
      "triangles, within",
      { timeout: 30000 },
    );
    await page.getByTitle("Apply the simplify").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => window.__store.getState().history.at(-1).label),
        { timeout: 30000 },
      )
      .toBe("Simplified");
    const first = await tris();
    expect(first, `${before} triangles before`).toBeLessThan(before / 2);

    // Edit re-opens the same dialog on the step, and saving re-runs it.
    const steps = await page.evaluate(
      () => window.__store.getState().history.length,
    );
    await page
      .getByTitle("Edit simplify — deviation or triangle count")
      .click();
    await page
      .getByRole("button", { name: "Triangle count", exact: true })
      .click();
    await page.locator("#simplify-triangles").fill("300");
    await page.getByTitle("Apply the simplify").click();
    await expect.poll(tris, { timeout: 60000 }).toBeLessThanOrEqual(300);
    expect(
      await page.evaluate(() => window.__store.getState().history.length),
    ).toBe(steps);

    // The simplified body still booleans: the app's OCC bridge sews its mesh.
    // A cube over half the ball, so the union keeps the other half's surface.
    await page.evaluate(() => {
      window.__store.getState().addItem({
        id: 61,
        name: "Cube 61",
        type: "cube",
        children: [],
        position: { x: 1, y: 1, z: -6 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [60, 61] });
    });
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const r = window.__store
              .getState()
              .items.find(
                (i) =>
                  i.regenerator?.kind === "boolean" &&
                  i.regenerator.inputIds?.includes(60),
              );
            return r?.geometryData ? r.geometryData.indices.length / 3 : 0;
          }),
        { timeout: 30000 },
      )
      // Far more than a cube's 12: the ball's half is in it.
      .toBeGreaterThan(60);
  });

  test("convert to surfaces rebuilds a mesh body as exact faces, and its Edit re-runs it", async () => {
    // A sixteen-sided cylinder standing in for an imported STL, selected, in a
    // new document.
    await page.evaluate(() => {
      window.__store.getState().newDocument();
      const SIDES = 16;
      const positions = [0, -1, 0, 0, 1, 0];
      for (let i = 0; i < SIDES; i++) {
        const a = (i / SIDES) * 2 * Math.PI;
        positions.push(
          Math.cos(a),
          -1,
          Math.sin(a),
          Math.cos(a),
          1,
          Math.sin(a),
        );
      }
      const lo = (i) => 2 + 2 * (i % SIDES),
        hi = (i) => 3 + 2 * (i % SIDES);
      const indices = [];
      for (let i = 0; i < SIDES; i++) {
        indices.push(0, lo(i), lo(i + 1), 1, hi(i + 1), hi(i));
        indices.push(lo(i), hi(i), hi(i + 1), lo(i), hi(i + 1), lo(i + 1));
      }
      window.__store.getState().addItem({
        id: 70,
        name: "Rod (STL)",
        type: "csg",
        children: [],
        position: { x: 0, y: 1, z: -6 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: { positions, indices, normals: null, flat: true },
      });
      window.__store.setState({ selectedId: 70, selectedIds: [70] });
    });
    const recipe = () =>
      page.evaluate(() => {
        const r = window.__store
          .getState()
          .items.find((i) => i.id === 70)?.regenerator;
        return r
          ? {
              kind: r.kind,
              tol: r.toleranceMm,
              faceTypes: r.stats?.faceTypes ?? null,
              brep: !!r.brep,
            }
          : null;
      });

    await page
      .getByTitle("Convert to Surfaces — rebuild", { exact: false })
      .click();
    await page.locator("#convert-tolerance").fill("0.01");
    // The preview recognises the surfaces through IPC and says what it found.
    await expect(page.locator(".sketch-placement-hint")).toContainText(
      "3 faces: 2 planes, 1 cylinder",
      { timeout: 30000 },
    );
    await page.getByTitle("Rebuild the body as exact faces").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => window.__store.getState().history.at(-1).label),
        { timeout: 30000 },
      )
      .toBe("Converted to surfaces");
    const first = await recipe();
    expect(first.kind).toBe("meshToSurfaces");
    expect(first.brep, "the exact shape kept as the recipe").toBe(true);
    expect(first.faceTypes).toMatchObject({
      plane: 2,
      cylinder: 1,
      triangle: 0,
    });

    // Edit re-opens the same dialog on the step, and saving re-runs it in
    // place.
    const steps = await page.evaluate(
      () => window.__store.getState().history.length,
    );
    await page.getByTitle("Edit convert to surfaces — tolerance").click();
    await page.locator("#convert-tolerance").fill("0.02");
    await page.getByTitle("Rebuild the body as exact faces").click();
    await expect
      .poll(async () => (await recipe())?.tol, { timeout: 60000 })
      .toBe(0.02);
    await expect
      .poll(async () => (await recipe())?.faceTypes?.cylinder, {
        timeout: 60000,
      })
      .toBe(1);
    expect(
      await page.evaluate(() => window.__store.getState().history.length),
    ).toBe(steps);

    // The converted body booleans from its BREP through the app's OCC bridge.
    await page.evaluate(() => {
      window.__store.getState().addItem({
        id: 71,
        name: "Cube 71",
        type: "cube",
        children: [],
        position: { x: 1, y: 1, z: -6 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [70, 71] });
    });
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const r = window.__store
              .getState()
              .items.find(
                (i) =>
                  i.regenerator?.kind === "boolean" &&
                  i.regenerator.inputIds?.includes(70),
              );
            return r?.geometryData ? r.geometryData.indices.length / 3 : 0;
          }),
        { timeout: 30000 },
      )
      // Far more than a cube's 12: the rod's exact wall is in it.
      .toBeGreaterThan(60);
  });

  test("a too-detailed refusal offers to simplify the mesh to fit", async () => {
    // The refusal names the mesh by its triangle count; the offer opens
    // Simplify on that body, set a tenth under the boolean limit.
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument();
      // A closed tetrahedron is enough: only its count is matched.
      s.addItem({
        id: 62,
        name: "Dense part (STL)",
        type: "csg",
        children: [],
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
          indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
          normals: null,
          flat: true,
        },
      });
      s.selectItem(null);
      s.showNotification(
        "The extrusion couldn't be merged with the body it starts on, so it was added as a separate body. Imported mesh is too detailed (4 triangles) to use in a boolean. Simplify or decimate it first.",
      );
    });
    await page.getByRole("button", { name: "Simplify to fit" }).click();
    await expect(page.locator("#simplify-triangles")).toHaveValue("45000");
    expect(
      await page.evaluate(() => {
        const s = window.__store.getState();
        return {
          target: s.simplifyTarget?.itemId,
          selected: s.selectedId,
          note: s.notification,
        };
      }),
    ).toEqual({ target: 62, selected: 62, note: null });
    await page.getByTitle("Cancel").click();
  });
});
