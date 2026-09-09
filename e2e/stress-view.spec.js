// The stress view, end to end in the real app: a body, a held face, a load on
// another face, and a colour per vertex on the mesh.
//
// The numbers themselves are pinned against closed-form beam theory in the
// unit tests (src/three/fea/__tests__).  What this covers is the part those
// cannot: the worker, the store, and the field actually reaching the mesh.
import fs from "node:fs";
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

  test("runs the same load case through the tool's own UI", async ({}, testInfo) => {
    test.setTimeout(300_000);
    // The store path is covered above; this is the part only the real UI can
    // show -- the toolbar button, the two pick phases, and Solve.
    await page.evaluate(() => {
      window.__store.getState().clearStressResult();
      window.__store.getState().selectItem(null);
    });
    const button = page.getByTitle(/^Stress —/);
    await expect(button).toBeVisible();
    // No body selected: there is nothing to analyse, and the tool says so
    // rather than opening onto an empty pick.
    await expect(button).toBeDisabled();

    await page.evaluate(
      (id) => window.__store.getState().selectItem(id),
      bodyId,
    );
    await expect(button).toBeEnabled();
    await button.click();

    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();
    const held = bar.getByTitle(/faces that are HELD/);
    const loaded = bar.getByTitle(/force is applied to/);
    await expect(held).toContainText("none");
    await expect(loaded).toContainText("none");

    // Picking is a real click on the body, so the faces are chosen the way a
    // user chooses them.  Held phase is the one the tool opens on.
    const faces = await page.evaluate((id) => {
      const s = window.__store.getState();
      const g = s.items.find((i) => i.id === id).geometryData;
      const p = g.positions;
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      const it = s.items.find((i) => i.id === id);
      const at = (x) =>
        s._cameraControls.worldToScreen(
          it.position.x + x,
          it.position.y,
          it.position.z,
        );
      return { min: at(lo + 0.001), max: at(hi - 0.001) };
    }, bodyId);

    await page.mouse.click(faces.min.x, faces.min.y);
    await expect(held).not.toContainText("none");
    await bar.getByTitle(/force is applied to/).click();
    await page.mouse.click(faces.max.x, faces.max.y);
    await expect(loaded).not.toContainText("none");

    // WHICH faces got picked, not merely that something did.  Aiming at the
    // far end's centre picks the long side face instead -- that end points
    // away from the default camera -- so this test was quietly solving a bar
    // held along its whole top rather than at its end, and every other
    // assertion still passed.  The load case here is the one the picks
    // actually make: hung from a side face, pulled down at one end.
    const planes = await page.evaluate(() => {
      const t = window.__store.getState().stressTool;
      const box = (soup) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < soup.length; i += 3)
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], soup[i + k] * 10);
            hi[k] = Math.max(hi[k], soup[i + k] * 10);
          }
        return { lo, hi };
      };
      return { held: box(t.fixtures), loaded: box(t.loadFaces) };
    });
    // The held face is flat in Z and runs the length of the bar.
    expect(planes.held.hi[2] - planes.held.lo[2]).toBeLessThan(0.01);
    expect(planes.held.hi[0] - planes.held.lo[0]).toBeCloseTo(60, 0);
    // The loaded face is the end cap: flat in X, at the far end.
    expect(planes.loaded.hi[0] - planes.loaded.lo[0]).toBeLessThan(0.01);
    expect(planes.loaded.lo[0]).toBeCloseTo(30, 0);

    // Reset clears BOTH picks and returns to the held phase, so a load case
    // that went wrong can be started over without losing the force or the
    // material already set.
    const reset = bar.getByTitle(/Clear both face picks/);
    await reset.click();
    await expect(held).toContainText("none");
    await expect(loaded).toContainText("none");
    await expect(reset).toBeDisabled();
    await expect(
      bar.getByTitle(/Total force over the loaded faces/).locator("input"),
    ).toHaveValue("500");
    // Pick them again to carry on.
    await page.mouse.click(faces.min.x, faces.min.y);
    await bar.getByTitle(/force is applied to/).click();
    await page.mouse.click(faces.max.x, faces.max.y);
    await expect(held).not.toContainText("none");
    await expect(loaded).not.toContainText("none");

    // The title sits on the label+field wrapper, so the input is inside it.
    await bar
      .getByTitle(/Total force over the loaded faces/)
      .locator("input")
      .fill("800");
    await page.getByTitle(/^Solve the load case/).click();
    await expect
      .poll(
        () => page.evaluate(() => !!window.__store.getState().stressResult),
        { timeout: 300000 },
      )
      .toBe(true);

    // The legend is what makes the colours mean anything: it must quote the
    // scale in real units, not just show a strip.
    const legend = page.getByText("Von Mises stress (MPa)");
    await expect(legend).toBeVisible();
    const panel = legend.locator("..");
    await expect(panel).toContainText("yield");
    // The tool opens on PETG, so that is what the legend must name -- the
    // yield the colours are scaled against comes from it.
    await expect(panel).toContainText("PETG");
    await expect(panel).toContainText(/Peak \d+ MPa/);

    const shot = testInfo.outputPath("stress-tool.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("stress-tool", {
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
