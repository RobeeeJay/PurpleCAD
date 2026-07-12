import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import fs from "node:fs";

// Emboss edit lifecycle on a real document: the Timeline Edit button must
// restore the timeline to the PRE-emboss step (face re-picking has to happen
// against the source body, in its frame — not the relief-carrying result),
// seed the dialog from the committed recipe, and Confirm must update the
// entry in place and land back on it.  Mirrors chamfer-edit-flow.spec.js for
// the emboss variant of the same bug class.

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();

  const doc = JSON.parse(
    fs.readFileSync("test-files/failing-recalculate-scene.pcad", "utf8"),
  );
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  // Let the post-load recalculation start (it may debounce), then settle —
  // clicking Edit mid-recalc races the tool arming.
  await page.waitForTimeout(500);
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 60000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          return (
            s.pendingOperations === 0 &&
            (s.regenProgress == null || s.regenProgress.total === 0)
          );
        }),
      { timeout: 60000 },
    )
    .toBe(true);
});

test.afterAll(async () => {
  await app?.close();
});

test("Edit opens on the pre-emboss step; Confirm updates in place", async () => {
  const before = await page.evaluate(() => {
    const s = window.__store.getState();
    const entry = s.history.find(
      (h) => h.instruction?.patches?.regenerator?.kind === "emboss",
    );
    return {
      entryId: entry.id,
      steps: s.history.length,
      depth: entry.instruction.patches.regenerator.params?.depth ?? null,
    };
  });

  await page.getByTitle("Edit emboss", { exact: false }).click();

  // The tool armed as an editor and the timeline sits on the PREVIOUS step:
  // the on-screen body is the pre-emboss source (an extrude, not the csg).
  const armed = await page.evaluate((entryId) => {
    const s = window.__store.getState();
    const idx = s.history.findIndex((h) => h.id === entryId);
    const entry = s.history[idx];
    return {
      editEntryId: s.embossTool?.editEntryId ?? null,
      viewingPrev: s.activeHistoryId === s.history[idx - 1].id,
      itemType: s.items.find((i) => i.id === entry.itemId)?.type,
      faceArmed: !!s.embossTool?.face,
      profiles: s.embossTool?.profiles?.length ?? 0,
    };
  }, before.entryId);
  expect(armed.editEntryId).toBe(before.entryId);
  expect(armed.viewingPrev).toBe(true);
  expect(armed.itemType).toBe("extrude"); // pre-emboss state on screen
  expect(armed.faceArmed).toBe(true);
  expect(armed.profiles).toBeGreaterThan(0);

  // Confirm re-stamps with the (unchanged) recipe — the entry must update IN
  // PLACE and the view must land back on it.  Let the arming settle (the
  // dialog kicks off a debounced preview) before confirming.
  await page.waitForTimeout(500);
  await page.getByTitle("Stamp the relief").click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = window.__store.getState();
          return {
            toolOpen: !!s.embossTool,
            toolError: s.toolError ?? null,
            steps: s.history.length,
            busy: s.pendingOperations > 0,
          };
        }),
      { timeout: 120000 },
    )
    .toEqual({
      toolOpen: false,
      toolError: null,
      steps: before.steps,
      busy: false,
    });

  const after = await page.evaluate((entryId) => {
    const s = window.__store.getState();
    const idx = s.history.findIndex((h) => h.id === entryId);
    const entry = s.history[idx];
    const isTip = idx === s.history.length - 1;
    return {
      // Landed back on the entry (null = tip, restoreToHistory's convention).
      onEntry: isTip
        ? s.activeHistoryId === null || s.activeHistoryId === entryId
        : s.activeHistoryId === entryId,
      kind: entry.instruction.patches.regenerator.kind,
      itemType: s.items.find((i) => i.id === entry.itemId)?.type,
    };
  }, before.entryId);
  expect(after.onEntry).toBe(true);
  expect(after.kind).toBe("emboss");
  expect(after.itemType).toBe("csg"); // the embossed result is back on screen
});
