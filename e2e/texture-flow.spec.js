import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// Texture tool lifecycle against the real app: start the tool from the
// toolbar, feed it a real PNG (decoded by the renderer's Image+canvas path)
// and a store-seeded face pick, Confirm through the dialog, then drive the
// timeline Edit flow (pre-texture step view, in-place update).

// 2×2 PNG: left column black, right column white.
const PNG_2x2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/AwMDhAIAHfoE/mYCn2AAAAAASUVORK5CYII=";

let app;
let page;
const CUBE_ID = 61;

test.describe.serial("texture lifecycle", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("apply a texture to a cube's top face via the dialog", async () => {
    await page
      .getByTitle("Texture — displace faces with a black-and-white image", {
        exact: false,
      })
      .click();
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();

    // Seed the cube + face pick the way the viewport click would record it,
    // and inject the PNG (the file input needs a native picker).
    await page.evaluate(
      ({ id, png }) => {
        const s = window.__store.getState();
        s.addItem({
          id,
          name: `Cube ${id}`,
          type: "cube",
          children: [],
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        });
        s.setTextureFaceSelection({
          itemId: id,
          face: { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 },
          faceSet: null,
          faceTris: [
            -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, -1, 1, -1,
          ],
          faceCount: 1,
          valid: true,
          keepPicking: false,
        });
        s.updateTextureParams({ png, pngName: "e2e.png", sizeMm: 30 });
      },
      { id: CUBE_ID, png: PNG_2x2 },
    );

    await page.getByTitle("Confirm — apply the texture").click();

    await expect
      .poll(() =>
        page.evaluate((id) => {
          const s = window.__store.getState();
          const it = s.items.find((i) => i.id === id);
          return {
            kind: it?.regenerator?.kind ?? null,
            hasGeom: !!it?.geometryData?.positions?.length,
            toolOpen: !!s.textureTool,
          };
        }, CUBE_ID),
      )
      .toEqual({ kind: "texture", hasGeom: true, toolOpen: false });

    // The displaced top rises above the original cube: local height > 2.
    const height = await page.evaluate((id) => {
      const p = window.__store
        .getState()
        .items.find((i) => i.id === id).geometryData.positions;
      let min = Infinity,
        max = -Infinity;
      for (let i = 1; i < p.length; i += 3) {
        min = Math.min(min, p[i]);
        max = Math.max(max, p[i]);
      }
      return max - min;
    }, CUBE_ID);
    expect(height).toBeGreaterThan(2.005);
  });

  test("Timeline Edit views the pre-texture step and updates in place", async () => {
    const before = await page.evaluate(() => {
      const s = window.__store.getState();
      return { steps: s.history.length };
    });

    await page
      .getByTitle("Edit texture — reopens the tool on the pre-texture step")
      .click();

    const armed = await page.evaluate((id) => {
      const s = window.__store.getState();
      const idx = s.history.findIndex(
        (h) => h.id === s.textureTool?.editEntryId,
      );
      return {
        armed: !!s.textureTool?.editEntryId,
        viewingPrev:
          idx > 0 && s.activeHistoryId === s.history[idx - 1].id,
        itemType: s.items.find((i) => i.id === id)?.type,
      };
    }, CUBE_ID);
    expect(armed.armed).toBe(true);
    expect(armed.viewingPrev).toBe(true);
    expect(armed.itemType).toBe("cube"); // pre-texture body on screen

    // Deepen the displacement and confirm — entry updates IN PLACE.
    await page.evaluate(() =>
      window.__store.getState().updateTextureParams({ depthMm: 3 }),
    );
    await page.waitForTimeout(400); // let the debounced preview settle
    await page.getByTitle("Confirm — apply the texture").click();

    await expect
      .poll(() =>
        page.evaluate(
          ({ steps }) => {
            const s = window.__store.getState();
            const entry = s.history.find(
              (h) => h.instruction?.patches?.regenerator?.kind === "texture",
            );
            return {
              steps: s.history.length,
              depth:
                entry?.instruction.patches.regenerator.params.depthMm ?? null,
              toolOpen: !!s.textureTool,
              backOnEntry: s.activeHistoryId === null, // entry is the tip
            };
          },
          { steps: before.steps },
        ),
      )
      .toEqual({
        steps: before.steps,
        depth: 3,
        toolOpen: false,
        backOnEntry: true,
      });
  });

  test("heavy displacement shows the busy dialog, keeps the UI live, and cancels", async () => {
    await page.evaluate((png) => {
      const s = window.__store.getState();
      s.addItem({
        id: 62,
        name: "sphere",
        type: "sphere",
        children: [],
        position: { x: 5, y: 1.5, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.startTextureTool();
      s.setTextureFaceSelection({
        itemId: 62,
        face: { nx: 1, ny: 0, nz: 0, cx: 1.5, cy: 0, cz: 0 },
        faceSet: { sphere: { cx: 0, cy: 0, cz: 0, radius: 1.5 } },
        faceTris: null,
        faceCount: 1,
        valid: true,
        keepPicking: false,
      });
      // Punishing resolution: the displacement runs long enough that the
      // busy indicator must appear and Cancel must land mid-run.
      s.updateTextureParams({
        png,
        pngName: "e2e.png",
        wrap: true,
        projection: "conform",
        resolutionMm: 0.08,
        depthMm: 0.5,
      });
    }, PNG_2x2);
    await page.waitForTimeout(1500); // clamped preview settles

    await page.getByTitle("Confirm — apply the texture").click();
    await expect(page.locator(".busy-indicator")).toBeVisible({
      timeout: 10000,
    });
    // The worker owns the grind — a DOM interaction completes immediately.
    const t0 = Date.now();
    await page.locator(".timeline-header").click();
    expect(Date.now() - t0).toBeLessThan(1500);

    await page.locator(".busy-cancel").click();
    await expect(page.locator(".busy-indicator")).toBeHidden({
      timeout: 5000,
    });
    const after = await page.evaluate(() => {
      const s = window.__store.getState();
      return {
        committed:
          s.items.find((i) => i.id === 62)?.regenerator?.kind === "texture",
        toolOpen: !!s.textureTool,
        pending: s.pendingOperations,
      };
    });
    expect(after).toEqual({ committed: false, toolOpen: true, pending: 0 });

    // The abort left the app healthy: a sane resolution commits fine.
    await page.evaluate(() =>
      window.__store.getState().updateTextureParams({ resolutionMm: 1.5 }),
    );
    await page.waitForTimeout(700);
    await page.getByTitle("Confirm — apply the texture").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store.getState().items.find((i) => i.id === 62)
                ?.regenerator?.kind ?? null,
          ),
        { timeout: 60000 },
      )
      .toBe("texture");
  });
});
