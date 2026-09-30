import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// After a Split, new objects must still get ids nothing has used.  The
// MultiSystem2 sequence, with real clicks: split a body, delete one piece,
// place a sketch on the other, and extrude a region that merges into it.
// Counters that skipped the Split's pieces gave the sketch the deleted
// piece's id and the merged extrude the surviving piece's id: two objects
// with one id, a doubled entry in the object list, and an extrude Edit that
// opened on the piece instead of the extrude.
let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

const project = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) =>
      window.__store.getState()._cameraControls.worldToScreen(x, y, z),
    [x, y, z],
  );
const screen = async (x, y, z) => {
  let prev = await project(x, y, z);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(100);
    const cur = await project(x, y, z);
    if (Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5)
      return cur;
    prev = cur;
  }
  throw new Error(`the camera never settled: ${JSON.stringify(prev)}`);
};
const clickView = async (p, what) => {
  const tag = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? null,
    p,
  );
  expect(tag, `${what} at ${JSON.stringify(p)}`).toBe("CANVAS");
  await page.mouse.click(p.x, p.y);
};

test("objects made after a Split get ids of their own", async () => {
  // A body split into two cube pieces, ids 2 and 3; piece 2 then deleted.
  await page.evaluate(() => {
    const cube = (id, name, x) => ({
      id,
      name,
      type: "cube",
      children: [],
      parentId: null,
      position: { x, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    const entry = (id, label, instruction, hiddenIds = []) => ({
      id,
      label,
      itemId: instruction.item?.id ?? instruction.itemId ?? null,
      instruction,
      hiddenIds,
    });
    window.__store.getState().loadDocument({
      version: 1,
      activeHistoryId: null,
      variables: [],
      history: [
        entry(0, "Scene created", { type: "scene_created" }),
        entry(1, "Added", { type: "create", item: cube(1, "Body", 0) }),
        entry(
          2,
          "Split",
          {
            type: "createGroup",
            splitFrom: 1,
            items: [cube(2, "Body (1)", -2), cube(3, "Body (2)", 2)],
          },
          [1],
        ),
        entry(3, "Deleted", { type: "delete", itemId: 2 }, [1]),
      ],
    });
  });
  await page.getByTitle("Reset view").click();

  // A sketch placed on the top of piece 3 by clicking it.
  await page.evaluate(() =>
    window.__store.getState().setSketchPlacementMode(true),
  );
  await clickView(await screen(2, 2, 0), "the top of piece 3");
  const sketch = await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__store
          .getState()
          .items.find((i) => i.type === "sketch");
        return s ? { id: s.id, name: s.name } : null;
      }),
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(() => {
        const s = window.__store
          .getState()
          .items.find((i) => i.type === "sketch");
        return { id: s.id, name: s.name, position: s.position };
      }),
    );
  // Ids 1-3 are the body and its two pieces, deleted or not.
  expect(sketch.id).toBe(4);
  expect(sketch.name).toBe("Sketch 4");

  // A circle on it, then out of the sketch and extrude it: it merges into
  // piece 3, the body it sits on.
  await page.evaluate((id) => {
    const s = window.__store.getState();
    s.addSketchShapes(id, [{ type: "circle", cx: 0, cy: 0, r: 0.3 }]);
    s.selectItem(null);
  }, sketch.id);
  await page.waitForTimeout(1600); // fly-out tween
  await page.getByTitle("Reset view").click();
  await page.evaluate(() =>
    window.__store.getState().setExtrudeSelectMode("profile"),
  );
  await page.waitForTimeout(600); // region fills materialise
  const { x, y, z } = sketch.position;
  await clickView(await screen(x, y, z), "the circle");
  const overlay = page.locator(".sketch-distance-input-overlay");
  await expect(overlay).toBeVisible({ timeout: 5000 });
  const distance = overlay.locator("input").nth(1);
  await distance.fill("5");
  await distance.press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__store
              .getState()
              .items.find((i) => i.regenerator?.kind === "extrudeUnion")?.id ??
            null,
        ),
      { timeout: 30000 },
    )
    .not.toBeNull();

  const state = await page.evaluate(() => {
    const s = window.__store.getState();
    const union = s.items.find((i) => i.regenerator?.kind === "extrudeUnion");
    const ids = s.items.map((i) => i.id);
    return {
      unionId: union.id,
      inputs: union.regenerator.inputIds,
      duplicates: ids.filter((id, k) => ids.indexOf(id) !== k),
    };
  });
  // A fresh id, merged INTO piece 3 -- not sharing its id.
  expect(state.duplicates, "item ids used twice").toEqual([]);
  expect(state.unionId).toBeGreaterThan(4);
  expect(state.inputs).toEqual([3]);

  // Editing the extrude opens on the extrude: its 5 mm, not the piece.
  await page
    .getByTitle("Edit extrusion — change the profile and length", {
      exact: false,
    })
    .click();
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await expect(overlay.locator("input").nth(1)).toHaveValue("5.00");
});
