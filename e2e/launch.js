// Shared Electron launcher for the e2e suite.  Every launch gets a brand-new
// SQLite database in a per-run temp directory (via --db-path) so tests start
// from a consistent empty state and never touch the user's real database.
import { _electron as electron } from "@playwright/test";
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
  const app = await electron.launch({ args, env });
  return app;
}
