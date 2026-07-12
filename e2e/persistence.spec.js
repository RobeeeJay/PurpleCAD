import { test, expect } from "@playwright/test";
import { launchApp, makeDataDir } from "./launch.js";

// Relaunch persistence: everything the user built must survive an app
// restart against the same SQLite database — items, timeline, the active
// step, and variables.  The load path has its own logic (backfillEmbossFrames,
// orphan flags, timeline replay) that only runs on a cold start.

test("a document survives an app relaunch", async () => {
  const dataDir = makeDataDir();

  let app = await launchApp(dataDir);
  let page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();

  await page.evaluate(() => {
    const s = window.__store.getState();
    s.addItem({
      id: 31,
      name: "Keeper",
      type: "cube",
      children: [],
      position: { x: 0.5, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    s.setVariables([{ name: "wall", value: "2.5" }]);
    s.setItemTransform(31, { x: 1, y: 1, z: 0 }, null, null);
    s.recordTransformHistory(31, "Moved");
  });
  const before = await page.evaluate(() => {
    const s = window.__store.getState();
    return {
      historyLabels: s.history.map((h) => h.label),
      position: s.items.find((i) => i.id === 31).position,
      variables: s.variables,
    };
  });
  expect(before.historyLabels).toContain("Moved");
  await app.close();

  // Same database, cold process: the store must rebuild the same state.
  app = await launchApp(dataDir);
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
  const after = await page.evaluate(() => {
    const s = window.__store.getState();
    const item = s.items.find((i) => i.id === 31);
    return {
      historyLabels: s.history.map((h) => h.label),
      name: item?.name,
      position: item?.position,
      variables: s.variables,
    };
  });
  await app.close();

  expect(after.name).toBe("Keeper");
  expect(after.historyLabels).toEqual(before.historyLabels);
  expect(after.position).toEqual(before.position);
  expect(after.variables).toEqual(before.variables);
});
