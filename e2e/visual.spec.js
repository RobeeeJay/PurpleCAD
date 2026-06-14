import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Visual regression on the WebGL viewport.  WebGL output varies by GPU/driver/
// OS, so the committed baseline is environment-specific: regenerate with
// `npm run test:e2e:run -- --update-snapshots` on the target machine (pin a
// fixed image in CI), and the generous maxDiffPixelRatio absorbs minor
// antialiasing differences.  Treat a failure here as "the render changed",
// then eyeball the diff Playwright writes to playwright-report/.
test("the viewport renders a created cube", async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [projectRoot], env });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();

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
