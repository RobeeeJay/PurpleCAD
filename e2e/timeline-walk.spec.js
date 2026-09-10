import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { assertDocumentIntegrity } from "./integrity.js";
import fs from "node:fs";

// Load a real document and click every timeline step.  Each selection can
// trigger a JIT recalculation through the bridge; the invariant is that the
// recalculation ALWAYS settles — the "Recalculating…" indicator disappears
// and no unhandled rejection escapes (regression: the input-fallback sew of
// a dense emboss result threw uncaught and the regen dialog never closed).
// The document is the repro from that bug: extrude → emboss → two chamfers,
// with the chamfer steps saved dirty.

let app;
let page;
const pageErrors = [];

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

const regenSettled = async () => {
  // Recalc may start after a debounce — give it a moment to appear, then
  // require it gone.  A wedged dialog fails the "hidden" wait at 60s.
  await page.waitForTimeout(400);
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 240000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          return { busy: s.regenProgress != null && s.regenProgress.total > 0 };
        }),
      { timeout: 240000 },
    )
    .toEqual({ busy: false });
};

test("every step of a dirty document settles when selected", async () => {
  // This walk costs real OCC time and the suite-wide 60s budget is not enough
  // for it.  Measured per step on a Mac: every step settles in 0.4s except the
  // two chamfers on the embossed body, which take 28.1s and 19.9s -- 52.7s in
  // total, against a limit of 60. It passed at 36.0s in the container and then
  // failed at 59.6s, which was the machine varying rather than the invariant
  // breaking: the recalculation still settled, just not inside the budget.
  //
  // The invariant here is that a recalculation ALWAYS settles, so the timeout
  // has to be far enough clear of how long settling legitimately takes that it
  // only ever fires on a genuine wedge.
  test.setTimeout(300_000);
  const doc = JSON.parse(
    fs.readFileSync("test-files/failing-recalculate-scene.pcad", "utf8"),
  );
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  await regenSettled();

  const stepCount = await page.locator(".timeline-entry").count();
  expect(stepCount).toBeGreaterThan(3);

  // Walk forward through every step, then back to the first — both directions
  // move the JIT bound and can trigger recomputes.
  const order = [
    ...Array.from({ length: stepCount }, (_, i) => i),
    0,
    stepCount - 1,
  ];
  for (const i of order) {
    await page.locator(".timeline-entry").nth(i).click();
    await regenSettled();
    // Walking the timeline re-runs the regenerators, which is where a
    // structural mutation that renumbers a sketch's shapes without remapping
    // its constraints would show up.  Check after EVERY step so the failure
    // names the step that broke it, not just the end state.
    await assertDocumentIntegrity(page, `after step ${i}`);
  }

  // Every geometry step settled: nothing is left permanently dirty and the
  // final item carries geometry.
  const state = await page.evaluate(() => {
    const s = window.__store.getState();
    const item = s.items.find((it) => it.regenerator);
    return {
      hasGeometry: !!item?.geometryData?.positions?.length,
      regeneratedAt: item?.regenerator?.regeneratedAt ?? null,
    };
  });
  expect(state.hasGeometry).toBe(true);
  expect(state.regeneratedAt).not.toBe("dirty");
  expect(pageErrors).toEqual([]);
});
