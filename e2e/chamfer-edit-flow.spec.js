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
  // of nothing.  The dialog must say why as soon as the preview fails, and
  // Confirm on the same values must report it at once, committing nothing.
  test("a distance too big to build says why in the dialog, and Confirm reports it at once", async () => {
    const OTHER = 502;
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
    const notes = [];
    await page.exposeFunction("__chamferNote", (n) => notes.push(n));
    await page.evaluate(() =>
      window.__store.subscribe((st, prev) => {
        if (st.notification && st.notification !== prev.notification)
          window.__chamferNote(st.notification);
      }),
    );

    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    // The cube is 20 mm across: a 30 mm chamfer can't fit its faces.
    await overlay.locator("input").first().fill("30");
    const inline = overlay.locator(".chamfer-preview-error");
    await expect(inline).toBeVisible({ timeout: 30000 });
    await expect(inline).toContainText("Try a smaller distance");
    // The user-facing text, not Electron's IPC wrapper around it.
    await expect(inline).not.toContainText("invoking remote method");

    const t0 = Date.now();
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect.poll(() => notes.length).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(2000); // no second OCC run
    expect(notes[0]).toContain("Try a smaller distance");
    expect(
      await page.evaluate(() => window.__store.getState().history.length),
    ).toBe(entriesBefore);

    // Changing the value clears the complaint.
    await overlay.locator("input").first().fill("2");
    await expect(inline).toBeHidden();
    await page.evaluate(() =>
      window.__store.getState().setChamferSelectMode(null),
    );
  });
});
