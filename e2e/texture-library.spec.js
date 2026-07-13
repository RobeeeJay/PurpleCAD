import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// Texture library: defaults render, picking one arms the tool, imports are
// size-guarded / renamable / deletable-with-warning, and imports persist.

let app;
let page;

test.describe.serial("texture library", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page
      .getByTitle("Texture — displace faces with a black-and-white image", {
        exact: false,
      })
      .click();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("defaults render in three categories; picking one arms the tool", async () => {
    await page.getByTitle("Choose a bump map from the texture library", {
      exact: false,
    }).click();
    const dialog = page.locator(".texture-library-dialog");
    await expect(dialog).toBeVisible();
    for (const cat of ["Animal scales", "Fabric", "Industrial", "Imported"])
      await expect(dialog.getByText(cat, { exact: true })).toBeVisible();
    // Every default card renders a real thumbnail.
    expect(await dialog.locator(".texture-thumb img").count()).toBe(10);

    await dialog.getByTitle('Use "Knurled grip"').click();
    await expect(dialog).toBeHidden();
    const armed = await page.evaluate(() => {
      const p = window.__store.getState().textureTool?.params;
      return { name: p?.pngName, hasPng: !!p?.png };
    });
    expect(armed).toEqual({ name: "Knurled grip", hasPng: true });
  });

  test("import guards size, lands in rename, persists; delete warns", async () => {
    await page.getByTitle("Choose a bump map from the texture library", {
      exact: false,
    }).click();
    const dialog = page.locator(".texture-library-dialog");

    // Stub confirm to capture the messages (size warning + delete warning).
    await page.evaluate(() => {
      window.__confirms = [];
      window.confirm = (msg) => {
        window.__confirms.push(msg);
        return true;
      };
    });

    // A 2048×2048 PNG trips the size warning.  Build it in-page and feed it
    // to the file input as a DataTransfer file.
    const bigPng = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2048;
      c.height = 2048;
      const ctx = c.getContext("2d");
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = i % 2 ? "#fff" : "#000";
        ctx.fillRect((i * 97) % 2048, (i * 53) % 2048, 160, 160);
      }
      return c.toDataURL("image/png").split(",")[1];
    });
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({
        name: "big-noise.png",
        mimeType: "image/png",
        buffer: Buffer.from(bigPng, "base64"),
      });

    // Size warning fired; import proceeded (confirm returned true) and the
    // card dropped straight into rename.
    await expect(dialog.locator(".project-rename")).toBeVisible();
    const warned = await page.evaluate(() => window.__confirms);
    expect(warned.some((m) => /large/i.test(m))).toBe(true);

    await dialog.locator(".project-rename").fill("Rock face");
    await dialog.locator(".project-rename").press("Enter");
    await expect(dialog.getByText("Rock face", { exact: true })).toBeVisible();

    // Persisted app-wide (settings table), not just component state.
    const stored = await page.evaluate(() => {
      const raw = window.electronAPI.settingGet("texture_library");
      return JSON.parse(raw).map((t) => t.name);
    });
    expect(stored).toEqual(["Rock face"]);

    // Delete warns, then removes and persists.
    await dialog.getByTitle("Delete texture").click();
    const confirms = await page.evaluate(() => window.__confirms);
    expect(confirms.some((m) => /Delete "Rock face"/.test(m))).toBe(true);
    await expect(
      dialog.getByText("Rock face", { exact: true }),
    ).toBeHidden();
    const after = await page.evaluate(() =>
      JSON.parse(window.electronAPI.settingGet("texture_library") || "[]"),
    );
    expect(after).toEqual([]);
  });
});
