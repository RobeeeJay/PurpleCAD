import { test, expect } from "./fixtures.js";
import fs from "node:fs";
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

// A sketch edit's recalc waits until the sketch is closed.  Quitting with the
// sketch still open saved the edit but not the fact that the cut built on it
// was out of date, and the relaunched app showed the old cut for good.
test("a cut follows a sketch edit made just before the app closed", async () => {
  const dataDir = makeDataDir();
  const doc = JSON.parse(
    fs.readFileSync("test-files/bad-cut-extrude.pcad", "utf8"),
  );
  // Wait for a recalc to settle Cut 4 at the current resolution: the file
  // carries a mesh made at another, which the app rebuilds on load.
  const settledCut = (page) =>
    expect
      .poll(
        () =>
          page.evaluate(() => {
            const s = window.__store.getState();
            const cut = s.items.find((i) => i.id === 4);
            if (cut?.regenerator?.regeneratedAt !== s.resolutionMm) return null;
            const p = cut.geometryData.positions;
            const ix = cut.geometryData.indices;
            let v = 0;
            for (let t = 0; t < ix.length; t += 3) {
              const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
              v +=
                p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
                p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
                p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
            }
            return v / 6;
          }),
        { timeout: 60000 },
      )
      .not.toBeNull();
  const cutVolume = (page) =>
    page.evaluate(() => {
      const g = window.__store.getState().items.find((i) => i.id === 4)
        .geometryData;
      const p = g.positions;
      const ix = g.indices;
      let v = 0;
      for (let t = 0; t < ix.length; t += 3) {
        const [a, b, c] = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3];
        v +=
          p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
      }
      return v / 6;
    });

  let app = await launchApp(dataDir);
  let page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
  await page.evaluate((d) => window.__store.getState().loadDocument(d), doc);
  await settledCut(page);
  const before = await cutVolume(page);

  // Open Sketch 1 and grow the four corner holes Cut 4 drills, then quit
  // with the sketch still open, so its recalc never runs.
  await page.evaluate(() => {
    const s = window.__store.getState();
    s.selectItem(1);
    for (const idx of [4, 11, 12, 13]) {
      const shape = window.__store.getState().items.find((i) => i.id === 1)
        .shapes[idx];
      s.updateSketchShape(1, idx, { ...shape, r: shape.r * 1.5 });
    }
  });
  expect(await cutVolume(page), "the cut waits for the sketch to close").toBe(
    before,
  );
  await app.close();

  app = await launchApp(dataDir);
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
  await settledCut(page);
  const after = await cutVolume(page);
  await app.close();
  // Wider holes take material away: 1.40 units^3 of it, measured in vitest
  // (pendingRecalcReload.test.js) on the same document and edit.
  expect(before - after, `cut volume ${before} -> ${after}`).toBeCloseTo(
    1.402,
    2,
  );
});
