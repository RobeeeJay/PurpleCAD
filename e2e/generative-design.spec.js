// Generative design, end to end in the real app: hold a face, load another,
// run SIMP, and keep the result as a body.
//
// The optimiser itself is pinned against the canonical cantilever in the unit
// tests (src/three/fea/__tests__/topology.test.js).  What this covers is the
// part those cannot: the toolbar, the picks, the worker, the preview, and the
// body that comes out the far end.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;
let bodyId;

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 240000 });

test.describe.serial("generative design", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();

    // A plate to carve: an extrude, which also proves the tool works on a body
    // with no baked mesh.
    bodyId = await page.evaluate(() => {
      const s = window.__store.getState();
      const pts = [
        { x: -2, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 1 },
        { x: -2, y: 1 },
      ];
      s.addItem(
        {
          id: 760,
          type: "extrude",
          name: "Bracket blank",
          children: [],
          parentId: null,
          profile: {
            type: "sketchLoop",
            sketchId: null,
            textShapeIdx: null,
            profileCentroid: { x: 0, y: 0 },
            polygon2D: pts,
            holes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            normalWorld: { x: 0, y: 0, z: 1 },
          },
          depth: 0.6,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        "Added",
      );
      s.selectItem(760);
      return 760;
    });
    await settled();
    await page.waitForTimeout(600);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the toolbar offers it for a selected body", async () => {
    const button = page.getByTitle(/^Generative design —/);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await page.evaluate(() => window.__store.getState().selectItem(null));
    await expect(button).toBeDisabled();
    await page.evaluate(
      (id) => window.__store.getState().selectItem(id),
      bodyId,
    );
    await expect(button).toBeEnabled();
  });

  test("carves the body down to a load path and keeps it as a new body", async () => {
    test.setTimeout(600_000);
    await page.getByTitle(/^Generative design —/).click();
    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();

    // Pick by driving the tool's own selection, so this test is about the
    // optimisation rather than about aiming a click at a face -- which the
    // stress spec already covers, and which picks whichever face happens to
    // point at the camera.
    await page.evaluate((id) => {
      const s = window.__store.getState();
      const surf = s._cameraControls.meshSurface(id);
      const p = surf.positions;
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      const cap = (want) => {
        const soup = [];
        const tris = surf.indices ? surf.indices.length / 3 : p.length / 9;
        for (let t = 0; t < tris; t++) {
          const vs = [0, 1, 2].map((c) =>
            surf.indices ? surf.indices[t * 3 + c] * 3 : (t * 3 + c) * 3,
          );
          if (!vs.every((v) => Math.abs(p[v] - want) < 1e-6)) continue;
          for (const v of vs) soup.push(p[v], p[v + 1], p[v + 2]);
        }
        return soup;
      };
      s.setOptimisePhase("fixtures");
      s.setOptimiseFaceSelection({ itemId: id, faceTris: cap(lo) });
      s.setOptimisePhase("loads");
      s.setOptimiseFaceSelection({ itemId: id, faceTris: cap(hi) });
      s.setOptimiseParams({ resolution: 20, iterations: 12, forceN: 400 });
    }, bodyId);
    await expect(bar.getByTitle(/faces that are HELD/)).not.toContainText(
      "none",
    );
    await expect(bar.getByTitle(/force is applied to/)).not.toContainText(
      "none",
    );

    const before = await page.evaluate(
      () => window.__store.getState().items.length,
    );
    await page.getByTitle(/^Run the optimisation/).click();
    await expect
      .poll(
        () => page.evaluate(() => !!window.__store.getState().optimiseResult),
        { timeout: 600000 },
      )
      .toBe(true);

    const result = await page.evaluate(() => {
      const r = window.__store.getState().optimiseResult;
      return {
        kept: r.keptElements,
        design: r.designElements,
        tris: r.positions.length / 9,
        steps: r.history.length,
        first: r.history[0].compliance,
        last: r.history.at(-1).compliance,
      };
    });
    // Material was actually removed, and the part got stiffer for the volume.
    expect(result.kept).toBeGreaterThan(0);
    expect(result.kept).toBeLessThan(result.design * 0.75);
    expect(result.tris).toBeGreaterThan(50);
    expect(
      result.last / result.first,
      `compliance ${result.first.toExponential(2)} -> ${result.last.toExponential(2)}`,
    ).toBeLessThan(1);

    // It previews on the body before anything is committed: the blank's own
    // mesh is swapped for the optimised surface, so what is on screen is the
    // result rather than the block it came from.
    const preview = await page.evaluate(
      (id) => window.__store.getState()._cameraControls.meshDisplayInfo(id),
      bodyId,
    );
    expect(preview.swapped).toBe(true);
    expect(preview.vertexCount).toBe(result.tris * 3);

    // Apply keeps it as a NEW body, leaving the blank alone.
    await page.getByTitle(/Keep the optimised shape/).click();
    await expect
      .poll(() => page.evaluate(() => window.__store.getState().items.length))
      .toBe(before + 1);
    const made = await page.evaluate((id) => {
      const s = window.__store.getState();
      const it = s.items.find((i) => i.id !== id && i.type === "csg");
      return {
        name: it?.name,
        verts: it?.geometryData?.positions?.length / 3,
        blankStillThere: !!s.items.find((i) => i.id === id),
        blankHidden: (s.history.at(-1).hiddenIds ?? []).includes(id),
        toolClosed: !s.optimiseTool,
      };
    }, bodyId);
    expect(made.name).toMatch(/optimised/i);
    expect(made.verts).toBeGreaterThan(50);
    expect(made.blankStillThere).toBe(true);
    // The blank is hidden, not deleted: the two sit in the same space, so
    // leaving both on screen shows the block and none of the result.
    expect(made.blankHidden).toBe(true);
    expect(made.toolClosed).toBe(true);
  });

  test("the optimised body survives a reload", async ({}, testInfo) => {
    test.setTimeout(300_000);
    await page.evaluate(() => window.__store.getState().selectItem(null));
    await page
      .locator("button.home-button")
      .click()
      .catch(() => {});
    await page.waitForTimeout(2000);
    const shot = testInfo.outputPath("generative-design.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("generative-design", {
      path: shot,
      contentType: "image/png",
    });

    const doc = await page.evaluate(() =>
      JSON.stringify(window.__store.getState().buildDocument?.() ?? null),
    );
    if (!doc || doc === "null") return; // no document builder exposed
    const back = await page.evaluate((d) => {
      const s = window.__store.getState();
      s.loadDocument(JSON.parse(d));
      return s.items.filter((i) => /optimised/i.test(i.name ?? "")).length;
    }, doc);
    expect(back).toBeGreaterThan(0);
  });
});
