// Every tool input carries a tooltip saying what CHANGING that value does.
// This is a UI-only surface, so nothing else in the suite would notice a hint
// that stopped reaching the DOM -- e.g. a `hint` prop the shared Field no
// longer forwards, which is silent in the app and invisible to a unit test.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

test.describe.serial("tool input tooltips", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  // Every dimension field of every primitive: these all come through the shared
  // Field's `hint`, so one broken forward would take the lot with it.
  for (const [type, labels] of [
    ["cube", ["W(mm)", "H(mm)", "D(mm)"]],
    ["sphere", ["Radius(mm)"]],
    ["cylinder", ["Radius(mm)", "Height(mm)"]],
    ["torus", ["Major R(mm)", "Minor R(mm)"]],
    ["cone", ["Bottom R(mm)", "Top R(mm)", "Height(mm)"]],
  ]) {
    test(`the ${type} dialog explains each of its dimensions`, async () => {
      await page.evaluate(
        (t) => window.__store.getState().openBoxCreate(t, { x: 0, y: 0, z: 0 }),
        type,
      );
      const bar = page.locator(".sketch-distance-input-overlay");
      await expect(bar).toBeVisible();

      for (const label of labels) {
        const field = bar.locator("span", { hasText: label }).first();
        const hint = await field.getAttribute("title");
        expect(hint, `no tooltip on ${type} ${label}`).toBeTruthy();
        // A hint that just repeats the label teaches nothing -- it has to say
        // what happens when the value changes.
        expect(
          hint.length,
          `${type} ${label} tooltip too short`,
        ).toBeGreaterThan(25);
      }
      await page.evaluate(() => window.__store.getState().closeBoxDialog());
    });
  }

  test("the plane dialog explains its orientation and offset fields", async () => {
    await page.evaluate(() =>
      window.__store.getState().startPlaneTool({
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      }),
    );
    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();
    for (const label of ["Rot X°", "Y°", "Z°", "Offset(mm)"]) {
      const hint = await bar
        .locator("span", { hasText: label })
        .first()
        .getAttribute("title");
      expect(hint, `no tooltip on plane ${label}`).toBeTruthy();
    }
    await page.evaluate(() => window.__store.getState().cancelPlaneTool());
  });
});
