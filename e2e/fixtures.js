// The suite's `test`, with one addition: when a test fails, photograph whatever
// app windows are still open and attach the shots to the report.
//
// Playwright's built-in `screenshot: "only-on-failure"` cannot do this. It
// applies to pages the browser fixtures create, and every spec here drives an
// Electron window it launched itself, so a failing run left nothing to look at
// beyond the assertion message.
//
// The app is closed in afterAll, which runs after this, so the window is still
// there to be photographed.
import { test as base, expect } from "@playwright/test";
import { liveApps } from "./launch.js";

export const test = base.extend({
  shootOnFailure: [
    async ({}, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      let n = 0;
      for (const app of liveApps) {
        try {
          const page = await app.firstWindow();
          // Written to a FILE, not attached as a buffer: a buffer attachment
          // shows up in the HTML report but leaves nothing on disk, and the
          // container mounts test-results to get artefacts back to the host.
          const file = testInfo.outputPath(`failed-state-${++n}.png`);
          // With a TIMEOUT, because photographing a wedged app hangs forever.
          // A test that fails because a recalculation never settles leaves the
          // renderer busy in a native call, and page.screenshot() then never
          // returns -- which does not merely lose the picture, it hangs the
          // whole RUN: one container sat for six and a half hours on this,
          // long after the 60s test timeout had fired.
          await page.screenshot({ path: file, timeout: 15_000 });
          await testInfo.attach(`failed-state-${n}`, {
            path: file,
            contentType: "image/png",
          });
        } catch (err) {
          console.log("could not photograph the failed state:", err.message);
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
