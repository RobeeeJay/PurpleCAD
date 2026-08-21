// Path-traced render smoke: the embossed/chamfered ring scene must start the
// tracer and produce a visible (non-black) image — the tracer runs its own RAF
// loop and blits through the denoise pass, both of which have silently broken
// before (stale raster left on the canvas / black object).
//
// Split in two on purpose.  Starting + ticking is cheap and is the more likely
// regression, so it runs everywhere.  Reading back lit pixels needs sustained
// GPU throughput: under a software rasteriser (SwiftShader/llvmpipe in the
// Linux container) the tracer manages a fraction of one sample before the
// Vulkan device gives up, and CONTEXT_LOST_WEBGL blanks the whole canvas —
// background included.  That is a hardware limit, not a defect, so the pixel
// assertion skips there rather than reporting a failure every run.
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import fs from "node:fs";
let app;
let page;

// Software rasterisers report themselves; detect from the driver string rather
// than an env var so this is right however the suite happens to be launched.
// Sampled in beforeAll BEFORE the trace starts: once a software renderer loses
// the context, a fresh probe context comes back empty and the check silently
// reports "not software", so the skip never fires.
let softwareRenderer = false;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning")
      console.log(`[renderer ${t}] ${msg.text()}`);
  });
  await expect(page.locator(".toolbar")).toBeVisible();

  softwareRenderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "";
    return /swiftshader|llvmpipe|software/i.test(name);
  });
  console.log("software renderer:", softwareRenderer);

  // Load the user's embossed/chamfered ring scene, then trace it.
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
});

test.afterAll(async () => {
  await app?.close();
});

test("the path tracer starts and its RAF loop accumulates samples", async () => {
  const state = await page.evaluate(() => {
    const s = window.__store.getState();
    return {
      active: s.pathTracerActive,
      progress: s.pathTraceProgress,
      view: s.pathTraceView,
    };
  });
  console.log("tracer state:", JSON.stringify(state));
  expect(state.view).toBe(true);
  expect(state.active).toBe(true);
  // Any progress at all proves the RAF loop is running; a stalled tracer
  // sits at exactly 0. Software rendering reaches a fraction of a sample,
  // a real GPU reaches dozens — both are non-zero.
  expect(state.progress?.samples).toBeGreaterThan(0);
});

test("path tracing renders a non-black object", async ({}, testInfo) => {
  test.skip(
    softwareRenderer,
    "needs a real GPU: a software rasteriser loses the WebGL context mid-trace",
  );

  // Read back the canvas pixels: the scene is a chamfered, embossed cylinder
  // filling the middle of the view, so the centre sample lands on its lit grey
  // body and the lower-left corner on the dark background.
  const px = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
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

  const [r, g, b] = px.centre;
  expect(r + g + b).toBeGreaterThan(30); // not black
});
