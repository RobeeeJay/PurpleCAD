// The stress view, end to end in the real app: a body, a held face, a load on
// another face, and a colour per vertex on the mesh.
//
// The numbers themselves are pinned against closed-form beam theory in the
// unit tests (src/three/fea/__tests__).  What this covers is the part those
// cannot: the worker, the store, and the field actually reaching the mesh.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;
let bodyId;

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 240000 });

// Triangles of the body whose corners all sit at one end along X, as the flat
// soup the solver takes -- the same shape the face-picking tools produce.
const endFaceSoup = (id, whichEnd) =>
  page.evaluate(
    ({ id, whichEnd }) => {
      const g = window.__store
        .getState()
        .items.find((i) => i.id === id).geometryData;
      const p = g.positions;
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      const want = whichEnd === "min" ? lo : hi;
      const soup = [];
      const tri = g.indices ? g.indices.length / 3 : p.length / 9;
      for (let t = 0; t < tri; t++) {
        const v = [0, 1, 2].map((c) =>
          g.indices ? g.indices[t * 3 + c] * 3 : (t * 3 + c) * 3,
        );
        if (!v.every((o) => Math.abs(p[o] - want) < 1e-6)) continue;
        for (const o of v) soup.push(p[o], p[o + 1], p[o + 2]);
      }
      return soup;
    },
    { id, whichEnd },
  );

test.describe.serial("stress view", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();

    // A baked mesh is what the solver reads, and primitives are analytic, so
    // the bar is built as a boolean: a long box with a smaller one fused
    // inside it, which leaves the outer shape untouched.
    await page.evaluate(() => {
      const s = window.__store.getState();
      const add = (id, name, dims, pos) =>
        s.addItem(
          {
            id,
            type: "cube",
            name,
            children: [],
            parentId: null,
            position: pos,
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            dimensions: dims,
          },
          "Added",
        );
      add(701, "Bar", { width: 6, height: 1, depth: 1 }, { x: 0, y: 0, z: 0 });
      add(
        702,
        "Core",
        { width: 1, height: 0.5, depth: 0.5 },
        { x: 0, y: 0, z: 0 },
      );
    });
    await settled();
    const before = await page.evaluate(() =>
      window.__store.getState().items.map((i) => i.id),
    );
    await page.evaluate(() => {
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [701, 702] });
    });
    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();
    await expect(bar.locator("button", { hasText: /2 objects/ })).toBeVisible();
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (seen) =>
              window.__store
                .getState()
                .items.find(
                  (i) =>
                    !seen.includes(i.id) &&
                    i.type === "csg" &&
                    i.geometryData?.positions?.length,
                )?.id ?? null,
            before,
          ),
        { timeout: 300000 },
      )
      .not.toBe(null);
    await settled();
    bodyId = await page.evaluate(
      (seen) =>
        window.__store
          .getState()
          .items.find((i) => !seen.includes(i.id) && i.type === "csg").id,
      before,
    );
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("solves a held-and-loaded bar and colours every vertex", async () => {
    test.setTimeout(300_000);
    const fixtures = await endFaceSoup(bodyId, "min");
    const loadFace = await endFaceSoup(bodyId, "max");
    expect(fixtures.length).toBeGreaterThan(0);
    expect(loadFace.length).toBeGreaterThan(0);

    const summary = await page.evaluate(
      async ({ id, fixtures, loadFace }) => {
        const r = await window.__store.getState().runStressAnalysis({
          itemId: id,
          fixtures,
          loads: [{ soup: loadFace, force: [0, -800, 0] }],
          materialName: "Steel",
          resolution: 32,
        });
        const g = window.__store
          .getState()
          .items.find((i) => i.id === id).geometryData;
        return r
          ? {
              verts: g.positions.length / 3,
              stressLen: r.vertexStress.length,
              displayVerts: r.display.positions.length / 3,
              colorLen: r.display.colors.length,
              ceiling: r.ceiling,
              robustPeak: r.robustPeak,
              max: r.max,
              iterations: r.iterations,
              yield: r.material.yield,
            }
          : { error: window.__store.getState().toolError };
      },
      { id: bodyId, fixtures, loadFace },
    );
    expect(summary.error).toBeUndefined();
    expect(summary.stressLen).toBe(summary.verts);
    expect(summary.colorLen).toBe(summary.displayVerts * 3);
    // The plot carries its OWN resolution: a fused box has a handful of
    // vertices, so drawing the field on them showed eight colours for the
    // whole part.
    expect(summary.displayVerts).toBeGreaterThan(summary.verts * 10);
    expect(summary.iterations).toBeGreaterThan(0);
    // The scale is the material's yield, so a colour reads as a fraction of
    // what the part can take -- and cannot be dragged around by the singular
    // element at the fixture.
    expect(summary.ceiling).toBe(summary.yield);
    // That singular peak is still REPORTED, well above the robust one.
    expect(summary.max).toBeGreaterThan(summary.robustPeak);
    // A steel bar this size under 800 N works a real fraction of its yield.
    expect(summary.robustPeak).toBeGreaterThan(20);
  });

  test("reads hottest where the bar is held", async () => {
    // Bending moment is largest at the fixed end and zero at the loaded tip,
    // so a field the other way round means the picks are wired backwards.
    const ends = await page.evaluate((id) => {
      const s = window.__store.getState();
      const g = s.items.find((i) => i.id === id).geometryData;
      const r = s.stressResult;
      const p = g.positions;
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      const span = hi - lo;
      let held = 0,
        free = 0;
      for (let v = 0; v < r.vertexStress.length; v++) {
        const x = p[v * 3];
        if (x < lo + span * 0.15) held = Math.max(held, r.vertexStress[v]);
        else if (x > hi - span * 0.15) free = Math.max(free, r.vertexStress[v]);
      }
      return { held, free };
    }, bodyId);
    expect(ends.held).toBeGreaterThan(ends.free * 2);
  });

  test("puts the colours on the body in the viewport", async ({}, testInfo) => {
    const painted = await page.evaluate(
      (id) =>
        window.__store.getState()._cameraControls.meshDisplayInfo?.(id) ?? null,
      bodyId,
    );
    expect(painted, "the viewport exposes no display info").not.toBeNull();
    expect(painted.hasVertexColors).toBe(true);
    expect(painted.colorCount).toBeGreaterThan(0);
    // Distinct colours mean a FIELD is being drawn, not one flat tint.
    expect(painted.distinctColors).toBeGreaterThan(8);

    // Deselect and look down the bending fibre before the still: the gizmo
    // sits over the plot, and the long side faces straddle the neutral axis,
    // so a three-quarter view of this bar shows a correct field that reads as
    // a flat one.
    await page.evaluate(() => {
      window.__store.getState().selectItem(null);
      window.__store.setState({ selectedIds: [], selectedId: null });
    });
    await page
      .locator("button.home-button")
      .click()
      .catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const cc = window.__store.getState()._cameraControls;
      cc.targetRotationX = 1.3;
      cc.targetRotationY = 0;
    });
    await page.waitForTimeout(2500);
    const shot = testInfo.outputPath("stress-view.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("stress-view", {
      path: shot,
      contentType: "image/png",
    });
  });

  test("takes the field off when the result is cleared", async () => {
    await page.evaluate(() => window.__store.getState().clearStressResult());
    await page.waitForTimeout(500);
    const painted = await page.evaluate(
      (id) => window.__store.getState()._cameraControls.meshDisplayInfo(id),
      bodyId,
    );
    expect(painted.hasVertexColors).toBe(false);
  });
});
