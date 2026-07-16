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
  const app = await electron.launch({
    args: [projectRoot, `--db-path=${path.join(tmpDir, "cad.sqlite")}`],
    env,
  });
  return app;
}
