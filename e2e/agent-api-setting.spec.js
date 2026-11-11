// The agent API is the user's to turn on: while it runs, any process of theirs
// can drive the model through its socket.  These launches leave it to the
// setting, as a real launch does (no --agent-api), and use Settings' switch.
import fs from "node:fs";
import { test, expect } from "./fixtures.js";
import { apiSocketFor, launchApp, makeDataDir } from "./launch.js";

const dataDir = makeDataDir();
const socketPath = apiSocketFor(dataDir);
let app;
let page;

async function open() {
  app = await launchApp(dataDir, { agentApi: false });
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible({ timeout: 30000 });
  await page.evaluate(() =>
    window.__store.getState().setSettingsDialogOpen(true),
  );
}

const status = () => page.evaluate(() => window.electronAPI.agentApiStatus());

test.describe.serial("agent API setting", () => {
  test.afterAll(async () => {
    await app?.close();
  });

  test("is off on a first launch, with no socket to connect to", async () => {
    await open();
    const toggle = page.locator(".agent-api-toggle");
    if (process.platform === "win32") {
      await expect(toggle).toBeDisabled();
      test.skip(true, "no agent API socket on Windows yet");
    }
    await expect(toggle).toHaveText("Off");
    expect(await status()).toMatchObject({ enabled: false, listening: false });
    expect(fs.existsSync(socketPath), socketPath).toBe(false);
  });

  test("turning it on opens the socket and offers the client setup", async () => {
    await page.locator(".agent-api-toggle").click();
    await expect(page.locator(".agent-api-toggle")).toHaveText("On");
    await expect(page.locator(".agent-api-state")).toContainText(
      `Listening on ${socketPath}`,
    );
    expect(fs.existsSync(socketPath), socketPath).toBe(true);
    await page
      .getByRole("button", { name: "Copy Claude Code command" })
      .click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    // What lands on the clipboard registers this app's own shim on this
    // launch's socket.
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toMatch(/^claude mcp add purplecad /);
    expect(copied).toContain(`PURPLECAD_API_SOCKET=${socketPath}`);
    expect(copied).toContain("mcp/purplecad-mcp.mjs");
  });

  test("turning it off closes the socket", async () => {
    await page.locator(".agent-api-toggle").click();
    await expect(page.locator(".agent-api-toggle")).toHaveText("Off");
    await expect.poll(() => fs.existsSync(socketPath)).toBe(false);
    expect(await status()).toMatchObject({ enabled: false, listening: false });
  });

  test("the choice is kept for the next launch", async () => {
    await page.locator(".agent-api-toggle").click();
    await expect(page.locator(".agent-api-toggle")).toHaveText("On");
    await app.close();
    await open();
    await expect(page.locator(".agent-api-toggle")).toHaveText("On");
    await expect.poll(() => fs.existsSync(socketPath)).toBe(true);
    expect(await status()).toMatchObject({ enabled: true, listening: true });
  });
});
