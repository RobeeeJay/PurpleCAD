import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

// Cooperative cancel is Electron-only by design (a SharedArrayBuffer flag the
// native addon polls; vitest has no worker to abort), so this is the only
// automated coverage it can get.  Force a full recalculation of a heavy
// document, cancel from the busy indicator, and require: the dialog dismisses
// promptly, the app survives (a worker terminated mid-op used to corrupt OCC
// globals and crash the process), and the next operation works normally.

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

// This test deliberately drives a SLOW pipeline: a dense emboss document, a
// forced full recalculation at 0.01 mm, then a second full pass at preview
// resolution.  That final pass alone measures ~30s on a quiet machine, and the
// poll below already allows 120s for it — but the suite-wide 60s test timeout
// capped the whole test well below that, so it died mid-poll whenever the
// machine was busy.  Give the test a budget that actually covers its own poll.
test.setTimeout(180_000);

test("cancelling a forced recalculation leaves the app healthy", async () => {
  const doc = JSON.parse(
    fs.readFileSync("test-files/failing-recalculate-scene.pcad", "utf8"),
  );
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 60000 });

  // Switch to high-quality print resolution: dirties every entry and makes
  // the rebuild slow enough (dense emboss at 0.01) that the cancel provably
  // lands while the native op is in flight.
  await page.evaluate(() => {
    window.__store.setState({ printPrecisionMm: 0.01 });
    window.__store.getState().toggleCurveResolution();
  });
  await page.locator(".timeline-recalc-btn").click();
  await expect(page.locator(".busy-indicator")).toBeVisible({
    timeout: 15000,
  });

  await page.locator(".busy-cancel").click();
  // The dialog must dismiss promptly — the epoch bump clears the counters
  // immediately, without waiting for the native op to notice the flag.
  await expect(page.locator(".busy-indicator")).toBeHidden({ timeout: 5000 });

  // The app survived the abort: the renderer is alive and a fresh OCC op
  // completes end-to-end (the worker and its shape store are intact).
  const next = await page.evaluate(async () => {
    const cube = {
      id: 51,
      type: "cube",
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const r = await window.electronAPI.invokeOcc("chamferOrFilletItem", {
      source: cube,
      subGeo: {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      amount: 0.2,
      segments: 1,
      allItems: [cube],
      printPrecision: 0.1,
    });
    return { tris: r.geometryData.positions.length / 9 };
  });
  expect(next.tris).toBeGreaterThan(0);

  // And a re-run recalculation completes (cancel didn't wedge the regen
  // loop).  Back at preview resolution so it finishes quickly; poll the
  // store rather than the indicator (which never appears for a fast pass).
  await page.evaluate(() => {
    window.__store.getState().toggleCurveResolution();
  });
  await page.locator(".timeline-recalc-btn").click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          const busy =
            (s.regenProgress != null && s.regenProgress.total > 0) ||
            s.pendingOperations > 0;
          const item = s.items.find((i) => i.regenerator);
          return {
            busy,
            // Settled at the normal resolution -- read from the settings, as
            // the default moved (0.1 mm, then 0.05).
            settled: item?.regenerator?.regeneratedAt === s.previewPrecisionMm,
          };
        }),
      { timeout: 120000 },
    )
    .toEqual({ busy: false, settled: true });
});
