import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// REAL raycast picking on mesh bodies — the one seam every other tool spec
// sidesteps by seeding picks through the store.  Here the clicks are aimed
// with cameraControls.worldToScreen and go through the genuine mouse
// handlers: Ctrl+click an edge for chamfer, click faces for the texture
// tool's connected-face grow, then confirm each op end-to-end.

let app;
let page;

const screenPt = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) =>
      window.__store.getState()._cameraControls.worldToScreen(x, y, z),
    [x, y, z],
  );

test.describe.serial("real raycast picking", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      window.__store.getState().addItem({
        id: 400,
        name: "Cube 400",
        type: "cube",
        children: [],
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    });
    await page.waitForTimeout(800); // scene + camera settle
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("Ctrl+click picks a real edge; chamfer confirms end-to-end", async () => {
    await page
      .getByTitle("Chamfer — select faces/edges", { exact: false })
      .click();
    // Top-front edge of the cube (world): from (-1,2,1) to (1,2,1) → aim at
    // its midpoint.  The default camera looks from +X/+Y/+Z so it's visible.
    const mid = await screenPt(0, 2, 1);
    expect(mid.inFront).toBe(true);
    await page.keyboard.down("Control");
    await page.mouse.click(mid.x, mid.y);
    await page.keyboard.up("Control");

    const sel = await page.evaluate(
      () => window.__store.getState().selectedSubGeometry,
    );
    expect(sel?.itemId).toBe(400);
    expect(sel.edges.length).toBe(1);
    // The picked edge is the real top-front edge, in the mesh's local frame.
    const e = sel.edges[0];
    expect(Math.abs(e.ay - 1) + Math.abs(e.by - 1)).toBeLessThan(0.05);
    expect(Math.abs(e.az - 1) + Math.abs(e.bz - 1)).toBeLessThan(0.05);

    const overlay = page.locator(".sketch-distance-input-overlay");
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.id === 400)
              ?.regenerator?.kind ?? null,
        ),
      )
      .toBe("chamfer");
  });

  test("Alt-free face click feeds the texture tool's connected-face grow", async () => {
    // The cube is now a chamfered csg with a REAL tessellated mesh — clicking
    // its top face must run growConnectedFaceSet on genuine geometry.
    await page
      .getByTitle("Texture — displace faces with a black-and-white image", {
        exact: false,
      })
      .click();
    const top = await screenPt(0.3, 2, -0.2); // on the top face, off-centre
    await page.mouse.click(top.x, top.y);

    const tt = await page.evaluate(() => {
      const t = window.__store.getState().textureTool;
      return {
        itemId: t?.itemId ?? null,
        valid: !!t?.facesValid,
        tris: t?.faceTris?.length ?? 0,
        // The grown region's plane: a top-face pick reports an up normal.
        ny: t?.face?.ny ?? 0,
      };
    });
    expect(tt.itemId).toBe(400);
    expect(tt.valid).toBe(true);
    expect(tt.tris).toBeGreaterThan(0);
    expect(tt.ny).toBeGreaterThan(0.9);

    // Clicking the same face again toggles it back off (mesh-face picks
    // accumulate/toggle).
    await page.mouse.click(top.x, top.y);
    const cleared = await page.evaluate(
      () => window.__store.getState().textureTool?.facesValid ?? null,
    );
    expect(cleared).toBe(false);
    await page.keyboard.press("Escape");
  });
});
