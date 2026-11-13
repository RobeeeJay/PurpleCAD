// The launch-time update check: main asks GitHub (stood in for here -- an e2e
// run must not reach the network, and the renderer never checks by itself in
// an e2e build), the renderer offers the release, and the user can download
// it, skip that version, or turn the check off in Settings.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible({ timeout: 30000 });
});

test.afterAll(async () => {
  await app?.close();
});

const release = {
  tag_name: "v99.0.0",
  html_url: "https://github.com/RobeeeJay/PurpleCAD/releases/tag/v99.0.0",
  draft: false,
  prerelease: false,
};

test("main reports a newer GitHub release over IPC", async () => {
  // Stand in for GitHub: main.cjs calls electron.net.fetch through the module
  // each time, so replacing it here is what the handler uses.
  await app.evaluate(({ net }, body) => {
    globalThis.__asked = [];
    net.fetch = async (url, init) => {
      globalThis.__asked.push({ url, ua: init.headers["User-Agent"] });
      return { ok: true, json: async () => body };
    };
  }, release);
  const found = await page.evaluate(() => window.electronAPI.checkForUpdate());
  expect(found).toEqual({ version: "99.0.0", url: release.html_url });
  const asked = await app.evaluate(() => globalThis.__asked);
  expect(asked[0].url).toMatch(/api\.github\.com\/repos\/.*\/releases\/latest/);
  expect(asked[0].ua).toMatch(/^PurpleCAD\/\d/);
});

test("the notice offers the release; Skip remembers the version", async () => {
  // Nothing shows by itself: an e2e build never checks at launch.
  await expect(page.locator(".update-notice")).toHaveCount(0);
  await page.evaluate(
    (r) =>
      window.__store
        .getState()
        .setAvailableUpdate({ version: "99.0.0", url: r.html_url }),
    release,
  );
  const notice = page.getByRole("status", { name: "Update available" });
  await expect(notice).toContainText("PurpleCAD 99.0.0 is available");
  await notice.getByRole("button", { name: "Skip this version" }).click();
  await expect(notice).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.electronAPI.dbCall("db:settingGet", "skippedUpdate"),
      ),
    )
    .toBe("99.0.0");
});

test("Download opens the release page in the system browser", async () => {
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => {
      globalThis.__opened.push(url);
    };
  });
  await page.evaluate(
    (r) =>
      window.__store
        .getState()
        .setAvailableUpdate({ version: "99.0.0", url: r.html_url }),
    release,
  );
  const notice = page.getByRole("status", { name: "Update available" });
  await notice.getByRole("button", { name: "Download" }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.__opened))
    .toEqual([release.html_url]);
  await expect(notice).toBeHidden();
});

test("Settings has a Check for updates box, on by default, that is saved", async () => {
  await page.evaluate(() =>
    window.__store.getState().setSettingsDialogOpen(true),
  );
  const box = page.getByLabel("Check for updates");
  await expect(box).toBeChecked();
  // It sits on the same right edge as the column of buttons above it.
  const edges = await page.evaluate(() => {
    const right = (el) => Math.round(el.getBoundingClientRect().right);
    const d = document.querySelector(".variables-dialog");
    return {
      box: right(d.querySelector("#settings-check-updates")),
      button: right(d.querySelector(".wheel-device")),
    };
  });
  expect(edges.box, JSON.stringify(edges)).toBe(edges.button);
  const stored = () =>
    page.evaluate(
      async () =>
        JSON.parse(await window.electronAPI.dbCall("db:settingGet", "snap"))
          .checkForUpdates,
    );
  await box.uncheck();
  await expect.poll(stored).toBe(false);
  await box.check();
  await expect.poll(stored).toBe(true);
  await page.evaluate(() =>
    window.__store.getState().setSettingsDialogOpen(false),
  );
});
