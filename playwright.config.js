import { defineConfig } from "@playwright/test";

// E2E config for the Electron app.  Tests launch the real packaged renderer
// (electron/main.cjs → app://./index.html from dist/) via Playwright's
// _electron API, so they exercise the genuine renderer ↔ main-process IPC and
// the native OCC addon — the surface node-only vitest can't reach.
//
// Run with `npm run test:e2e`, which first builds the addon and the renderer
// with the VITE_E2E hook (see package.json).  There is no `webServer` /
// browser project: each test boots its own Electron instance.
export default defineConfig({
  testDir: "./e2e",
  // Electron cold-starts + the first OCC call (native addon load) are slow;
  // give each test room without hanging CI forever.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Electron tests share one app instance per test file and aren't safe to run
  // concurrently against the same build artifacts — keep it serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
});
