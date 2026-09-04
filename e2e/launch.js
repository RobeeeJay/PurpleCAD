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
  return app;
}
