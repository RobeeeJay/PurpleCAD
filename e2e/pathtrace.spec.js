// Path-traced render smoke: the embossed/chamfered ring scene must produce a
// visible (non-black) traced image — the tracer runs its own RAF loop and
// blits through the denoise pass, both of which have silently broken before
// (stale raster left on the canvas / black object).
import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

let app;
let page;

test.beforeAll(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [projectRoot], env });
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

test("path tracing renders a non-black object", async () => {
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

  // Read back the canvas pixels: centre region should NOT be black (the red
  // box under studio lighting), background should be the dark blue-grey.
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

  await page.screenshot({ path: "/tmp/pathtrace.png" });
  expect(state.active).toBe(true);
  const [r, g, b] = px.centre;
  expect(r + g + b).toBeGreaterThan(30); // not black
});
