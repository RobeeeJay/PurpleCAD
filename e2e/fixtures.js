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
          await page.screenshot({ path: file });
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
