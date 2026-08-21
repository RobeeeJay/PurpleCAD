import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
// Visual regression on the WebGL viewport.  WebGL output varies by GPU/driver/
// OS, so the committed baseline is environment-specific: regenerate with
// `npm run test:e2e:run -- --update-snapshots` on the target machine (pin a
// fixed image in CI), and the generous maxDiffPixelRatio absorbs minor
// antialiasing differences.  Treat a failure here as "the render changed",
// then eyeball the diff Playwright writes to playwright-report/.
test("the viewport renders a created cube", async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();

    // A software rasteriser rasterises differently enough that it needs its
    // own baseline, and in the Linux container there is nowhere to keep one:
    // toHaveScreenshot writes the baseline next to the spec INSIDE the
    // container, which is discarded on exit, so the "writing actual" run never
    // persists anything and the test fails on every future run. Comparing GPU
    // output across renderers is not what this guards anyway.
    const software = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "";
      return /swiftshader|llvmpipe|software/i.test(name);
    });
    test.skip(software, "no persistable baseline for a software rasteriser");

    await page.evaluate(() => {
      window.__store.getState().addItem({
        id: 7,
        name: "Cube 7",
        type: "cube",
        children: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    });

    // Let the render loop draw the new mesh and settle.
    await page.waitForTimeout(750);

    await expect(page.locator(".viewport").first()).toHaveScreenshot(
      "viewport-cube.png",
      { maxDiffPixelRatio: 0.15 },
    );
  } finally {
    await app.close();
  }
});
