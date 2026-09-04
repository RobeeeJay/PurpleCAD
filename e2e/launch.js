// Shared Electron launcher for the e2e suite.  Every launch gets a brand-new
// SQLite database in a per-run temp directory (via --db-path) so tests start
// from a consistent empty state and never touch the user's real database.
import { _electron as electron, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// A fresh per-run data dir; pass the same one to a second launchApp to test
// relaunch persistence against the same database.
export const makeDataDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "purple-cad-e2e-"));

// E2E_VIDEO records the app window into test-results/videos, one directory per
// spec (Playwright names the files after a hash, and a whole run makes dozens).
// test-results is mounted by the container, so a failure that only happens in
// there can be watched on the host afterwards.
//
// Its value is a spec-name filter, because recording EVERYTHING is not viable
// in the container: the screencast on a software renderer slowed app startup
// past the 60s beforeAll timeout and took the suite from 9 minutes to 47, with
// nearly every spec failing before it began. E2E_VIDEO=undraggable-sketch
// records that spec alone and leaves the rest at full speed; E2E_VIDEO=all
// records everything, which is only sensible on a machine with a real GPU.
const currentSpec = () => {
  try {
    return path.basename(test.info().file || "").replace(/\.[^.]+$/, "");
  } catch {
    return ""; // outside a test, or a version that won't hand it over here
  }
};

const videoOptions = () => {
  const want = process.env.E2E_VIDEO;
  if (!want) return null;
  const spec = currentSpec();
  if (want !== "all" && want !== "1" && !spec.includes(want)) return null;
  return {
    recordVideo: {
      dir: path.join(projectRoot, "test-results", "videos", spec || "unknown"),
      // Smaller than the window on purpose: the encode is the expensive part,
      // and this is for watching what happened, not for pixel comparison.
      size: { width: 1000, height: 640 },
    },
  };
};

// E2E_TRACE takes the same spec-name filter and records a Playwright trace: the
// action timeline with a DOM snapshot (and, unless told otherwise, a screenshot)
// per step, which the trace viewer replays. Cheaper than video, which cannot run
// in the container at all -- the screencast stops the app starting.
//
// E2E_TRACE_NO_SHOTS=1 drops the screenshots, leaving snapshots and timings.
// Trace screenshots also come from a screencast, so that is the fallback if
// tracing turns out to cost as much as video does.
const tracing = new WeakSet();

export async function startTrace(app) {
  const want = process.env.E2E_TRACE;
  if (!want) return;
  const spec = currentSpec();
  if (want !== "all" && want !== "1" && !spec.includes(want)) return;
  await app.context().tracing.start({
    screenshots: !process.env.E2E_TRACE_NO_SHOTS,
    snapshots: true,
    sources: true,
  });
  tracing.add(app);
}

// Stop tracing and attach the zip to the report. Must run BEFORE the app is
// closed. Safe to call when nothing is being traced.
export async function saveTrace(app, testInfo, name = "trace") {
  if (!app || !tracing.has(app)) return null;
  tracing.delete(app);
  const file = testInfo.outputPath(`${name}.zip`);
  await app.context().tracing.stop({ path: file });
  await testInfo.attach(name, { path: file, contentType: "application/zip" });
  return file;
}

// Drop a trace that was started but is not wanted (a passing test), so closing
// the app does not leave one running.
export async function discardTrace(app) {
  if (!app || !tracing.has(app)) return;
  tracing.delete(app);
  await app.context().tracing.stop();
}

export async function launchApp(dataDir) {
  const tmpDir = dataDir || makeDataDir();
  // Strip ELECTRON_RUN_AS_NODE (the test runner's node sets it, which would
  // make Electron run as a plain node process instead of opening a window);
  // leave ELECTRON_START_URL unset so it loads the built renderer from dist/.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // The Linux e2e image sets E2E_CONTAINER; macOS runs without it and keeps
  // the sandbox and its real GPU.  In the container we need both:
  //   --no-sandbox              rootless podman can't use the SUID sandbox
  //   --use-angle=swiftshader   there is no GPU, and ANGLE-on-Mesa/llvmpipe
  //   --enable-unsafe-swiftshader   fails to create a WebGL context without
  //                             these, so three.js throws on startup and the
  //                             app never renders (every test fails on a
  //                             missing .toolbar rather than anything real).
  const args = [projectRoot, `--db-path=${path.join(tmpDir, "cad.sqlite")}`];
  if (process.env.E2E_CONTAINER)
    args.unshift(
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    );
  const app = await electron.launch({
    args,
    env,
    ...videoOptions(),
  });
  await startTrace(app);
  return app;
}
