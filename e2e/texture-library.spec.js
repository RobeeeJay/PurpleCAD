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
    await page
      .getByTitle("Choose a bump map from the texture library", {
        exact: false,
      })
      .click();
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

  test("every default map tiles seamlessly (wrap without distortion)", async () => {
    // Compare opposite edges of each generated bitmap: for a seamless tile
    // the left/right columns and top/bottom rows must (nearly) match — a
    // visible wrap seam shows up as a large mean edge difference.
    // The dialog is open from the previous test — read each rendered
    // thumbnail's dataURL straight from the DOM (the built app doesn't serve
    // source modules).
    await page
      .getByTitle("Choose a bump map from the texture library", {
        exact: false,
      })
      .click();
    await expect(page.locator(".texture-library-dialog")).toBeVisible();
    const seams = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll(".texture-card")];
      const entries = cards.map((el) => ({
        name: el.querySelector(".project-name")?.textContent ?? "?",
        dataURL: el.querySelector("img")?.src,
      }));
      const out = [];
      for (const entry of entries) {
        const img = new Image();
        await new Promise((res) => {
          img.onload = res;
          img.src = entry.dataURL;
        });
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const px = (x, y) => d[(y * c.width + x) * 4];
        // The wrap joint (last column → first column) is one pixel step in
        // pattern space, the same as any interior adjacent-column step.  A
        // real seam makes the joint difference far LARGER than the typical
        // interior step, so measure the ratio, not the absolute difference.
        const colDiff = (x1, x2) => {
          let sum = 0;
          for (let y = 0; y < c.height; y++)
            sum += Math.abs(px(x1, y) - px(x2, y));
          return sum / c.height;
        };
        const rowDiff = (y1, y2) => {
          let sum = 0;
          for (let x = 0; x < c.width; x++)
            sum += Math.abs(px(x, y1) - px(x, y2));
          return sum / c.width;
        };
        let adjX = 0,
          adjY = 0;
        const samples = 16;
        for (let k = 1; k <= samples; k++) {
          const x = Math.floor((c.width - 2) * (k / (samples + 1)));
          const y = Math.floor((c.height - 2) * (k / (samples + 1)));
          adjX += colDiff(x, x + 1);
          adjY += rowDiff(y, y + 1);
        }
        adjX /= samples;
        adjY /= samples;
        out.push({
          name: entry.name,
          lr: colDiff(c.width - 1, 0),
          tb: rowDiff(0, c.height - 1),
          adjX,
          adjY,
        });
      }
      return out;
    });
    expect(seams.length).toBe(10);
    for (const s of seams) {
      expect(s.lr, `${s.name} left/right seam (adj ${s.adjX})`).toBeLessThan(
        Math.max(8, 2.5 * s.adjX),
      );
      expect(s.tb, `${s.name} top/bottom seam (adj ${s.adjY})`).toBeLessThan(
        Math.max(8, 2.5 * s.adjY),
      );
    }
    await page.locator(".projects-close").click();
  });

  test("import guards size, lands in rename, persists; delete warns", async () => {
    await page
      .getByTitle("Choose a bump map from the texture library", {
        exact: false,
      })
      .click();
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
    await dialog.locator('input[type="file"]').setInputFiles({
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
    await expect(dialog.getByText("Rock face", { exact: true })).toBeHidden();
    const after = await page.evaluate(() =>
      JSON.parse(window.electronAPI.settingGet("texture_library") || "[]"),
    );
    expect(after).toEqual([]);
  });
});
