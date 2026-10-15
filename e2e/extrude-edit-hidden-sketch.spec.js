// Editing an extrude whose sketch was hidden when it was made
// (test-files/recalc-overload.pcad's last Extrude).  The edit shows the scene
// as of the extrude's own step, the sketch is hidden there, and region fills
// came from visible sketches only -- so the edit opened its bar with nothing
// highlighted and a Confirm that did nothing.  The edited extrude's own
// sketch is now offered even while hidden.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await expect(page.locator(".toolbar")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

const call = async (name, args) => {
  const r = await page.evaluate(
    ({ name, args }) => window.__api.call(name, args),
    { name, args },
  );
  expect(r.ok, `${name}: ${JSON.stringify(r.error)}`).toBe(true);
  return r.result;
};

test("an extrude of a hidden sketch can be edited", async () => {
  await call("document.new", { discardCurrent: true });
  const sketch = await call("sketch.create", {
    plane: "XY",
    shapes: [
      { type: "circle", cx: 0, cy: 0, r: 5 },
      { type: "circle", cx: 0, cy: 0, r: 10 },
    ],
  });
  await page.evaluate(
    (id) => window.__store.getState().toggleItemVisibility(id),
    sketch.id,
  );
  const ext = await call("feature.extrude", { sketchId: sketch.id, depth: 5 });
  // The extrude's step records the sketch as hidden, as in the document.
  const hiddenAtStep = await page.evaluate(
    ({ ext, sk }) => {
      const h = window.__store.getState().history;
      const step = h.find((e) => e.itemId === ext);
      return step?.hiddenIds?.includes(sk) ?? false;
    },
    { ext: ext.id, sk: sketch.id },
  );
  expect(hiddenAtStep).toBe(true);
  const steps = await page.evaluate(
    () => window.__store.getState().history.length,
  );

  await page
    .getByTitle("Edit extrusion — change the profile and length, then Confirm")
    .click();
  const distance = page.locator("#extrude-distance");
  await expect(distance).toBeVisible({ timeout: 5000 });
  await distance.fill("7");
  await page
    .getByTitle("Confirm — create the extrude at this distance")
    .click();
  await expect(distance).toBeHidden();

  // The same extrude, now 7 mm, edited in place.
  await expect
    .poll(async () =>
      (await call("body.list", {})).bodies.map((b) => b.bboxMm.size[2]),
    )
    .toEqual([expect.closeTo(7, 1)]);
  expect(
    await page.evaluate(() => window.__store.getState().history.length),
  ).toBe(steps);
});
