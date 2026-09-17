import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The variable-name suggestion list a formula field pops up must be wholly on
// screen and on top of everything.  It used to open below the field inside the
// field's own container: in the bars docked at the bottom of the viewport it
// ran off the bottom of the window, and a clipping or stacking ancestor could
// hide it.  Driven through a real bottom bar (the sketch Centre tool's offset
// fields) with real typing, clicks and arrow keys.

let app;
let page;

const VARIABLES = [
  { name: "Wall", formula: "3" },
  { name: "Width", formula: "40" },
  { name: "Wobble", formula: "Wall * 2" },
];

// The list's box, the window, and what is drawn at the list's centre.
const listState = () =>
  page.evaluate(() => {
    const list = document.querySelector(".formula-suggestions");
    if (!list) return null;
    const r = list.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + Math.min(r.height / 2, 12),
    );
    return {
      rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: list.dataset.placement,
      onTop: !!top && list.contains(top),
      names: [...list.querySelectorAll(".formula-suggestion-name")].map(
        (n) => n.textContent,
      ),
    };
  });

const expectWhollyOnScreen = (s) => {
  expect(s.rect.top).toBeGreaterThanOrEqual(0);
  expect(s.rect.left).toBeGreaterThanOrEqual(0);
  expect(s.rect.bottom).toBeLessThanOrEqual(s.viewport.height);
  expect(s.rect.right).toBeLessThanOrEqual(s.viewport.width);
};

test.describe.serial("formula field suggestions", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((variables) => {
      const s = window.__store.getState();
      s.setVariables(variables);
      s.addItem({
        id: 710,
        type: "sketch",
        name: "Suggestion sketch",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [{ type: "line", x1: 0, y1: 0, x2: 2, y2: 0 }],
        constraints: [],
      });
      s.selectItem(710);
    }, VARIABLES);
    await page.waitForTimeout(1800);
    await page
      .getByTitle("Centre — put the centre of one shape", { exact: false })
      .click();
    await expect(page.locator(".sketch-centre-overlay")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("in a bar at the bottom of the window the list opens ABOVE the field, on top of everything", async ({}, testInfo) => {
    const field = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset X (mm)");
    await field.fill("W");
    await expect
      .poll(async () => (await listState())?.names)
      .toEqual(["Wall", "Width", "Wobble"]);
    const s = await listState();
    const box = await field.boundingBox();
    // Wholly on screen and on top -- what the user actually needs -- checked
    // before the placement flag the new code sets.
    expectWhollyOnScreen(s);
    expect(s.onTop).toBe(true);
    expect(s.rect.bottom).toBeLessThanOrEqual(box.y);
    expect(s.placement).toBe("above");
    const file = testInfo.outputPath("suggestions-above-bottom-bar.png");
    await page.screenshot({ path: file, timeout: 15_000 });
    await testInfo.attach("suggestions-above", {
      path: file,
      contentType: "image/png",
    });
  });

  test("clicking a suggestion inserts it", async () => {
    await page.locator(".formula-suggestion", { hasText: "Width" }).click();
    const field = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset X (mm)");
    await expect(field).toHaveValue("Width");
    await expect(page.locator(".formula-suggestions")).toHaveCount(0);
  });

  test("arrow keys and Enter still choose from the list", async () => {
    const field = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset Y (mm)");
    await field.fill("Wo");
    await expect
      .poll(async () => (await listState())?.names)
      .toEqual(["Wobble"]);
    await field.fill("W");
    await expect.poll(async () => (await listState())?.names?.length).toBe(3);
    await field.press("ArrowDown");
    await field.press("ArrowDown");
    await field.press("Enter");
    await expect(field).toHaveValue("Wobble");
    // Enter took the suggestion; it did not confirm the dialog.
    await expect(page.locator(".sketch-centre-overlay")).toBeVisible();
  });

  test("leaving the field and coming straight back keeps the list", async () => {
    // Closing on blur waits 100 ms. Returning inside that window used to let
    // the stale close fire on the focused field: the list vanished and stayed
    // gone. (Found as a load-dependent failure of the resize test below.)
    const x = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset X (mm)");
    // Not the value the next test types: re-filling an unchanged value only
    // selects the text, which (rightly) closes the list.
    await x.fill("Wal");
    await expect.poll(async () => (await listState())?.names).toEqual(["Wall"]);
    await page.evaluate(() => {
      const bar = document.querySelector(".sketch-centre-overlay");
      bar.querySelector('input[aria-label="Offset Y (mm)"]').focus();
      bar.querySelector('input[aria-label="Offset X (mm)"]').focus();
    });
    await page.waitForTimeout(300); // well past the close-on-blur delay
    expect((await listState())?.names).toEqual(["Wall"]);
  });

  test("the same field near the top of the window opens its list below", async () => {
    // Park the bar at the top of the viewport: now there is room beneath.
    await page.evaluate(() => {
      const bar = document.querySelector(".sketch-centre-overlay");
      bar.style.position = "fixed";
      bar.style.top = "70px";
      bar.style.bottom = "auto";
    });
    const field = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset X (mm)");
    await field.fill("Wa");
    await expect.poll(async () => (await listState())?.names).toEqual(["Wall"]);
    const s = await listState();
    const box = await field.boundingBox();
    expect(s.placement).toBe("below");
    expect(s.rect.top).toBeGreaterThanOrEqual(box.y + box.height);
    expectWhollyOnScreen(s);
    expect(s.onTop).toBe(true);
  });

  test("the list follows the field when the window changes size", async () => {
    const before = (await listState()).rect;
    const field = page
      .locator(".sketch-centre-overlay")
      .getByLabel("Offset X (mm)");
    // Slide the bar; a resize event makes the list re-place itself.
    await page.evaluate(() => {
      document.querySelector(".sketch-centre-overlay").style.top = "160px";
      window.dispatchEvent(new Event("resize"));
    });
    const box = await field.boundingBox();
    await expect
      .poll(async () => (await listState()).rect.top)
      .toBeGreaterThanOrEqual(box.y + box.height);
    expect((await listState()).rect.top).toBeGreaterThan(before.top);
  });
});
