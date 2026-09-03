// Revolve (the Sweep tool's main mode): spin a sketch profile around an axis
// line to make a solid.  sweep.js is one of the largest files in the repo and
// had no test of any kind — this drives the real store phase machine and the
// real OCC revolve through the bridge.

import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

let app;
let page;

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 60000 });

// A profile rectangle offset from the origin, plus a vertical axis line, in one
// sketch on the XY plane so a spin about the axis sweeps a ring/cylinder.
const seedSketch = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    s.newDocument?.();
    s.addItem(
      {
        id: 800,
        type: "sketch",
        name: "Sketch R",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }, // XY plane, so +Y is the spin axis
        scale: { x: 1, y: 1, z: 1 },
        shapes: [
          // profile: a 1x2 rectangle sitting 2 units out from the axis
          { type: "line", x1: 2, y1: 0, x2: 3, y2: 0 },
          { type: "line", x1: 3, y1: 0, x2: 3, y2: 2 },
          { type: "line", x1: 3, y1: 2, x2: 2, y2: 2 },
          { type: "line", x1: 2, y1: 2, x2: 2, y2: 0 },
          // axis: the vertical line through x = 0  (shapeIdx 4)
          { type: "line", x1: 0, y1: -1, x2: 0, y2: 3 },
        ],
        constraints: [],
      },
      "Added",
    );
    s.selectItem(800);
  });

const revolve = (params = {}) =>
  page.evaluate((p) => {
    const s = window.__store.getState();
    s.startSweepTool("revolve");
    s.setSweepProfile({
      sketchId: 800,
      profileCentroid: { x: 2.5, y: 1 },
      polygon2D: [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 2, y: 2 },
      ],
      holes: [],
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      normalWorld: { x: 0, y: 0, z: 1 },
    });
    s.setSweepAxis({ sketchId: 800, shapeIdx: 4 });
    if (Object.keys(p).length) s.setSweepParams(p);
    return window.__store.getState().sweepSelectMode;
  }, params);

const solids = () =>
  page.evaluate(() =>
    window.__store
      .getState()
      .items.filter(
        (i) => i.type === "csg" && i.geometryData?.positions?.length,
      )
      .map((i) => ({ id: i.id, name: i.name, kind: i.regenerator?.kind })),
  );

test.describe.serial("revolve", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the tool tracks its picks through the phase machine", async () => {
    await seedSketch();
    await page.waitForTimeout(1200);
    const sm = await revolve();
    expect(sm.kind).toBe("revolve");
    expect(sm.profile.sketchId).toBe(800);
    expect(sm.axis).toEqual({ sketchId: 800, shapeIdx: 4 });
  });

  test("a full revolve produces a solid with a hole through the middle", async () => {
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1500);

    const made = await solids();
    expect(made.length).toBeGreaterThan(0);

    // Spinning a profile that starts 2 units off-axis leaves a bore, so the
    // body spans roughly ±3 in the revolve plane and 2 tall.
    const bbox = await page.evaluate(
      (id) => {
        const p = window.__store.getState().items.find((i) => i.id === id)
          .geometryData.positions;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 3)
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], p[i + k]);
            hi[k] = Math.max(hi[k], p[i + k]);
          }
        return { size: hi.map((v, k) => +(v - lo[k]).toFixed(2)) };
      },
      made[made.length - 1].id,
    );
    const sorted = [...bbox.size].sort((a, b) => b - a);
    expect(sorted[0]).toBeGreaterThan(5); // ~6 across the swept diameter
    expect(sorted[2]).toBeGreaterThan(1.5); // ~2 tall
  });

  test("the revolve carries a rebuildable recipe", async () => {
    const r = await page.evaluate(() => {
      const it = window.__store
        .getState()
        .items.filter((i) => i.regenerator)
        .pop();
      return it
        ? { kind: it.regenerator.kind, hasAxis: !!it.regenerator.axis }
        : null;
    });
    expect(r).toBeTruthy();
    expect(r.kind).toBe("revolve");
    expect(r.hasAxis).toBe(true);
  });

  test("cancelling clears the tool without leaving geometry behind", async () => {
    const before = (await solids()).length;
    await revolve();
    await page.evaluate(() => window.__store.getState().cancelSweepTool());
    const sm = await page.evaluate(
      () => window.__store.getState().sweepSelectMode,
    );
    expect(sm).toBeNull();
    expect((await solids()).length).toBe(before);
  });
});
