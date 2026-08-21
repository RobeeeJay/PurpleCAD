// Path-traced render smoke: the embossed/chamfered ring scene must produce a
// visible (non-black) traced image — the tracer runs its own RAF loop and
// blits through the denoise pass, both of which have silently broken before
// (stale raster left on the canvas / black object).
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning")
      console.log(`[renderer ${t}] ${msg.text()}`);
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("path tracing renders a non-black object", async ({}, testInfo) => {
  await expect(page.locator(".toolbar")).toBeVisible();

  // Load the user's embossed/chamfered ring scene, then trace it.
  const fs = await import("node:fs");
  const doc = JSON.parse(
    fs.readFileSync("test-files/reorder-timeline-before.pcad", "utf8"),
  );
  await page.evaluate((d) => {
    window.__store.getState().loadDocument(d);
  }, doc);
  await page.waitForTimeout(3000); // recalc + scene build

  await page.evaluate(() => {
    window.__store.setState({ pathTraceView: true });
  });
  // Let the tracer start + accumulate.
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => {
    const s = window.__store.getState();
    return {
      active: s.pathTracerActive,
      progress: s.pathTraceProgress,
      view: s.pathTraceView,
    };
  });
  console.log("tracer state:", JSON.stringify(state));

  // Read back the canvas pixels: the scene is a chamfered, embossed cylinder
  // filling the middle of the view, so the centre sample lands on its lit
  // grey body and the lower-left corner on the dark background.  Only
  // "centre is not black" is asserted -- this is a smoke test for the
  // tracer's RAF loop and denoise blit, not a visual comparison.
  const px = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl =
      canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { error: "no gl context" };
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    const buf = new Uint8Array(4);
    const read = (x, y) => {
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return [buf[0], buf[1], buf[2]];
    };
    return {
      centre: read(Math.floor(w / 2), Math.floor(h / 2)),
      corner: read(Math.floor(w * 0.05), Math.floor(h * 0.9)),
      w,
      h,
    };
  });
  console.log("pixels:", JSON.stringify(px));

  // Into the test's own output dir (and attached to the report) rather than
  // /tmp: a hardcoded path is not collected as a Playwright artifact, so a
  // failing run left no image to look at.
  const shot = testInfo.outputPath("pathtrace.png");
  await page.screenshot({ path: shot });
  await testInfo.attach("pathtrace", { path: shot, contentType: "image/png" });
  expect(state.active).toBe(true);
  const [r, g, b] = px.centre;
  expect(r + g + b).toBeGreaterThan(30); // not black
});
