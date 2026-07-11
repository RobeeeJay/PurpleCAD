import { test, expect } from "@playwright/test";
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
    const armed = await page.evaluate(() => ({
      edges: window.__store.getState().selectedSubGeometry?.edges?.length ?? 0,
      editArmed: !!window.__store.getState().chamferEditTarget,
    }));
    expect(armed.edges).toBeGreaterThan(0);
    expect(armed.editArmed).toBe(true);

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
    const after = await page.evaluate(() => ({
      entries: window.__store.getState().history.length,
      editArmed: !!window.__store.getState().chamferEditTarget,
    }));
    expect(after.entries).toBe(entriesBefore);
    expect(after.editArmed).toBe(false);
  });
});
