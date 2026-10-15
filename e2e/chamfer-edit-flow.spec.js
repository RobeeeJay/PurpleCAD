import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Chamfer edit lifecycle against the real app: create via the overlay, then
// the Timeline Edit button must reopen the SAME creation overlay — selection
// restored, distance seeded from the committed value — and Confirm must update
// the entry in place (no new timeline step).  The edge selection is seeded into
// the store the way the viewport's Ctrl+click would — picking a WebGL edge by
// raycast isn't addressable from the DOM.
//
// Serial: the edit test builds on the created chamfer.
test.describe.serial("chamfer edit lifecycle", () => {
  let app;
  let page;
  const CUBE_ID = 501;

  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("chamfer a cube's top edge via the overlay", async () => {
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        name: `Cube ${id}`,
        type: "cube",
        children: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      // A top edge of the bbox-centred cube, as a Ctrl+click would record it.
      s.setSelectedSubGeometry({
        itemId: id,
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      });
      s.setChamferSelectMode("chamfer");
    }, CUBE_ID);

    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Confirm — apply the chamfer").click();

    // 2 mm / MM_PER_UNIT(10) = 0.2 scene units.
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.__store.getState().items.find((i) => i.id === id)
              ?.regenerator?.amount ?? null,
          CUBE_ID,
        ),
      )
      .toBeCloseTo(0.2, 5);
  });

  test("Timeline Edit reopens the seeded overlay and updates in place", async () => {
    const entriesBefore = await page.evaluate(
      () => window.__store.getState().history.length,
    );

    await page
      .getByTitle("Edit chamfer — reopens the creation overlay", {
        exact: false,
      })
      .click();

    // The creation overlay opens, seeded with the committed distance, the
    // original edge selection restored and the edit target armed.
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator("input").first()).toHaveValue("2");
    const armed = await page.evaluate((id) => {
      const s = window.__store.getState();
      const entryIdx = s.history.findIndex(
        (h) => h.id === s.chamferEditTarget?.entryId,
      );
      return {
        edges: s.selectedSubGeometry?.edges?.length ?? 0,
        editArmed: !!s.chamferEditTarget,
        // The timeline must sit on the PREVIOUS step so the pre-chamfer body
        // is what the user re-picks against.
        viewingPrev:
          entryIdx > 0 && s.activeHistoryId === s.history[entryIdx - 1].id,
        itemType: s.items.find((i) => i.id === id)?.type,
      };
    }, CUBE_ID);
    expect(armed.edges).toBeGreaterThan(0);
    expect(armed.editArmed).toBe(true);
    expect(armed.viewingPrev).toBe(true);
    expect(armed.itemType).toBe("cube"); // pre-chamfer state on screen

    // Change the distance and confirm — the entry updates IN PLACE.
    await overlay.locator("input").first().fill("3");
    await page.getByTitle("Confirm — apply the chamfer").click();

    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.__store.getState().items.find((i) => i.id === id)
              ?.regenerator?.amount ?? null,
          CUBE_ID,
        ),
      )
      .toBeCloseTo(0.3, 5);
    const after = await page.evaluate(() => {
      const s = window.__store.getState();
      return {
        entries: s.history.length,
        editArmed: !!s.chamferEditTarget,
        // Confirm lands back on the edited entry — here the last step, so
        // active is null (restoreToHistory's at-the-tip convention).
        onEntry: s.activeHistoryId === null,
      };
    });
    expect(after.entries).toBe(entriesBefore);
    expect(after.editArmed).toBe(false);
    expect(after.onEntry).toBe(true);
  });

  // A distance too big to build used to fail silently: the live preview
  // swallowed the error and kept showing its last good result, and Confirm
  // re-ran the whole op before a 4-second toast -- on an extruded cog, 30 s
  // of nothing.  The reason must appear on the tool error line (where the
  // emboss / draft dialogs show theirs) as soon as the preview fails, and
  // Confirm on the same values must not run the op again.
  test("a distance too big to build says why on the error line, and Confirm doesn't retry", async ({}, testInfo) => {
    const OTHER = 502;
    const starts = [];
    page.on("console", (m) => {
      if (m.text().includes("[OCC] chamferOrFilletItem start"))
        starts.push(Date.now());
    });
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.setChamferSelectMode(null);
      s.addItem({
        id,
        name: `Cube ${id}`,
        type: "cube",
        children: [],
        position: { x: 6, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.setSelectedSubGeometry({
        itemId: id,
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      });
      s.setChamferSelectMode("chamfer");
    }, OTHER);
    const entriesBefore = await page.evaluate(
      () => window.__store.getState().history.length,
    );

    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    // The cube is 20 mm across: a 30 mm chamfer can't fit its faces.
    await overlay.locator("input").first().fill("30");
    const errorLine = page.locator(".tool-error-line");
    await expect(errorLine).toBeVisible({ timeout: 30000 });
    await expect(errorLine).toContainText("try a smaller distance");
    // The user-facing text, not Electron's IPC wrapper around it.
    await expect(errorLine).not.toContainText("invoking remote method");
    // Not crammed into the bar itself, not riding up over it, and not hidden
    // behind the status line that normally sits at the bottom.
    await expect(overlay.locator(".tool-error-line")).toHaveCount(0);
    const bar = await overlay.boundingBox();
    const line = await errorLine.boundingBox();
    expect(line.y, "error line overlaps the bar").toBeGreaterThanOrEqual(
      bar.y + bar.height - 0.5,
    );
    await expect(page.locator(".status-line")).toBeHidden();
    const shot = testInfo.outputPath("chamfer-error-line.png");
    await page.screenshot({ path: shot, timeout: 15_000 });
    await testInfo.attach("chamfer-error-line", {
      path: shot,
      contentType: "image/png",
    });

    const runsBefore = starts.length;
    await page.getByTitle("Confirm — apply the chamfer").click();
    await page.waitForTimeout(1500);
    expect(starts.length, "Confirm re-ran the failed op").toBe(runsBefore);
    await expect(errorLine).toContainText("try a smaller distance");
    expect(
      await page.evaluate(() => window.__store.getState().history.length),
    ).toBe(entriesBefore);

    // Changing the value clears the complaint.
    await overlay.locator("input").first().fill("2");
    await expect(errorLine).toBeHidden();
    await page.evaluate(() =>
      window.__store.getState().setChamferSelectMode(null),
    );
  });

  // Selecting the flat top of an extrude, the dialog says how big a bevel that
  // face could possibly take -- an upper bound from its outline: half the
  // narrower side of a 40 x 8 mm rectangle is 4 mm.
  test("the top of an extrude shows the largest bevel it could take", async ({}, testInfo) => {
    const SKETCH = 503;
    const res = await page.evaluate(async (id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        type: "sketch",
        name: "Bar sketch",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 6 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [
          { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
          { type: "line", x1: 4, y1: 0, x2: 4, y2: 0.8 },
          { type: "line", x1: 4, y1: 0.8, x2: 0, y2: 0.8 },
          { type: "line", x1: 0, y1: 0.8, x2: 0, y2: 0 },
        ],
        constraints: [0, 1, 2, 3].map((k) => ({
          type: "coincident",
          shapeAIdx: k,
          pointA: "end",
          shapeBIdx: (k + 1) % 4,
          pointB: "start",
        })),
      });
      return window.__api.call("feature.extrude", { sketchId: id, depth: 5 });
    }, SKETCH);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.setSelectedSubGeometry({
        itemId: id,
        edges: [],
        faces: [{ nx: 0, ny: 0, nz: 1 }],
      });
      s.setChamferSelectMode("fillet");
    }, res.result.id);
    const hint = page.locator(".sketch-placement-hint");
    await expect(hint).toContainText("This face takes at most 4.00 mm");
    const overlay = page.locator(".sketch-distance-input-overlay");
    await overlay.locator("input").first().fill("5");
    await expect(hint).toContainText(
      "5 mm won't fit this face — at most 4.00 mm",
    );
    const shot = testInfo.outputPath("chamfer-limit-hint.png");
    await page.screenshot({ path: shot, timeout: 15_000 });
    await testInfo.attach("chamfer-limit-hint", {
      path: shot,
      contentType: "image/png",
    });
    await page.evaluate(() =>
      window.__store.getState().setChamferSelectMode(null),
    );
  });
});
