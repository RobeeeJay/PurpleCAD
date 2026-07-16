import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
// Full push/pull lifecycle against the real app: create → push/pull (overlay
// Confirm) → edit distance (Timeline + dialog) → retarget (Timeline + overlay).
// Geometry/IPC work is driven and asserted through window.__store; the UI
// surfaces (overlay, dialog, timeline buttons) are exercised as real DOM.  The
// face selection is seeded into the store the way the viewport's Alt+click
// would — picking a WebGL face by raycast isn't addressable from the DOM.
//
// Serial: each step builds on the previous one's committed result.
test.describe.serial("push/pull lifecycle", () => {
  let app;
  let page;
  const CUBE_ID = 4242;

  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("push/pull a cube's +Y face via the overlay", async () => {
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
      // The +Y face of the bbox-centred cube, as an Alt+click would record it.
      s.setSelectedSubGeometry({
        itemId: id,
        edges: [],
        faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }],
      });
      s.setPushPullSelectMode("pushpull");
    }, CUBE_ID);

    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("5");
    await page.getByTitle("Confirm — apply the push/pull").click();

    // The cube became a push/pull CSG, recorded as a "Pulled" timeline step.
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const it = window.__store.getState().items.find((i) => i.id === id);
          return it ? `${it.type}:${it.regenerator?.kind ?? ""}` : "missing";
        }, CUBE_ID),
      )
      .toBe("csg:pushpull");

    // 5 mm / MM_PER_UNIT(10) = 0.5 scene units.
    expect(
      await page.evaluate(
        (id) =>
          window.__store.getState().items.find((i) => i.id === id).regenerator
            .distance,
        CUBE_ID,
      ),
    ).toBeCloseTo(0.5, 5);
  });

  test("edit the push/pull distance from the Timeline", async () => {
    await page.getByTitle("Edit push/pull distance").click();
    const dialog = page.locator(".variables-dialog", {
      hasText: "Edit push/pull",
    });
    await expect(dialog).toBeVisible();
    await dialog.locator("input").first().fill("12");
    await dialog.getByRole("button", { name: "Save" }).click();

    // 12 mm → 1.2 scene units; updatePushPullParams writes it synchronously.
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.__store.getState().items.find((i) => i.id === id)
              ?.regenerator?.distance ?? null,
          CUBE_ID,
        ),
      )
      .toBe(1.2);
  });

  test("retarget the push/pull to a different face from the Timeline", async () => {
    const beforeLen = await page.evaluate(
      () => window.__store.getState().history.length,
    );

    await page.getByTitle(/^Retarget push\/pull/).click();
    // Overlay reopens with the prior face pre-selected; switch it to the +X
    // face (a unique normal, so no centroid is needed to match it).
    await page.evaluate((id) => {
      window.__store.getState().setSelectedSubGeometry({
        itemId: id,
        edges: [],
        faces: [{ nx: 1, ny: 0, nz: 0 }],
      });
    }, CUBE_ID);
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Confirm — apply the push/pull").click();

    // Updated in place (no new step) and now targets the +X face.
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.__store.getState().items.find((i) => i.id === id)
              ?.regenerator?.subGeo?.faces?.[0]?.nx ?? null,
          CUBE_ID,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(() => window.__store.getState().history.length),
    ).toBe(beforeLen);
  });
});
