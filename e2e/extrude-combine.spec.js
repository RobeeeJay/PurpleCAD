import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// The extrude dialog's Combine checkbox.  On (the default): the extrusion
// merges into the body it is attached to, here the cube its sketch sits on.
// Off: it is always a new object.  Disabled for a cut, which is always a
// difference.
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

const items = () =>
  page.evaluate(() =>
    window.__store.getState().items.map((i) => ({
      id: i.id,
      type: i.type,
      kind: i.regenerator?.kind ?? null,
      inputs: i.regenerator?.inputIds ?? null,
    })),
  );

test.describe.serial("Combine in the extrude dialog", () => {
  let sketchPos;
  const overlay = () => page.locator(".sketch-distance-input-overlay");

  // Open the extrude dialog on the circle.
  const pickCircle = async () => {
    await page.getByTitle("Reset view").click();
    await page.evaluate(() =>
      window.__store.getState().setExtrudeSelectMode("profile"),
    );
    await page.waitForTimeout(600); // region fills materialise
    await clickView(
      await screen(sketchPos.x, sketchPos.y, sketchPos.z),
      "the circle",
    );
    await expect(overlay()).toBeVisible({ timeout: 5000 });
  };
  const extrude = async (mm) => {
    const distance = page.locator("#extrude-distance");
    await distance.fill(String(mm));
    await distance.press("Enter");
    await expect(overlay()).toBeHidden();
  };

  test("a circle sketched on a cube's top face", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.newDocument();
      s.addItem({
        id: 800,
        name: "Block",
        type: "cube",
        children: [],
        parentId: null,
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.selectItem(null);
    });
    await page.getByTitle("Reset view").click();
    await page.evaluate(() =>
      window.__store.getState().setSketchPlacementMode(true),
    );
    await clickView(await screen(0, 2, 0), "the cube's top");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.type === "sketch")
              ?.id ?? null,
        ),
      )
      .not.toBeNull();
    sketchPos = await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.type === "sketch");
      s.addSketchShapes(sk.id, [{ type: "circle", cx: 0, cy: 0, r: 0.3 }]);
      s.selectItem(null);
      return sk.position;
    });
    await page.waitForTimeout(1600); // fly-out tween
  });

  test("unchecked, the extrusion is a new object and the cube is left alone", async () => {
    await pickCircle();
    const combine = page.locator("#extrude-combine");
    await expect(combine).toBeChecked();
    await combine.uncheck();
    await extrude(5);
    await expect
      .poll(async () => (await items()).filter((i) => i.type === "extrude"))
      .toHaveLength(1);
    const all = await items();
    expect(all.some((i) => i.kind === "extrudeUnion")).toBe(false);
    expect(all.find((i) => i.id === 800)?.type).toBe("cube");
    // Still shown: not consumed into anything.
    const cubeHidden = await page.evaluate(() => {
      const s = window.__store.getState();
      const entry = s.history.at(-1);
      return (entry.hiddenIds ?? []).includes(800);
    });
    expect(cubeHidden).toBe(false);
  });

  test("checked again by default, it merges into the cube", async () => {
    await pickCircle();
    await expect(page.locator("#extrude-combine")).toBeChecked();
    await extrude(5);
    await expect
      .poll(
        async () =>
          (await items()).find((i) => i.kind === "extrudeUnion")?.inputs ??
          null,
        { timeout: 30000 },
      )
      .toEqual([800]);
  });

  // The merged extrusion's timeline step, and its Edit button (the last:
  // the standalone one from the first extrusion comes before it).
  const mergedStep = () =>
    page.evaluate(
      () =>
        window.__store
          .getState()
          .history.find(
            (h) => h.instruction?.item?.regenerator?.kind === "extrudeUnion",
          ).id,
    );
  const editMerged = () =>
    page
      .getByTitle("Edit extrusion — change the profile and length", {
        exact: false,
      })
      .last()
      .click();
  const mergedId = () =>
    page.evaluate(
      () =>
        window.__store
          .getState()
          .items.find((i) => i.regenerator?.kind === "extrudeUnion").id,
    );
  const hiddenNow = (id) =>
    page.evaluate((id) => {
      const s = window.__store.getState();
      const at =
        s.activeHistoryId != null
          ? s.history.find((h) => h.id === s.activeHistoryId)
          : s.history.at(-1);
      return (at.hiddenIds ?? []).includes(id);
    }, id);

  test("editing shows the scene as it was when the extrusion was made", async () => {
    // A later step, from which the merged extrusion is hidden.
    const id = await mergedId();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id: 900,
        name: "Later",
        type: "cube",
        children: [],
        parentId: null,
        position: { x: 5, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.toggleItemVisibility(id);
      s.selectItem(null);
    }, id);
    expect(await hiddenNow(id)).toBe(true);

    await editMerged();
    await expect(overlay()).toBeVisible({ timeout: 5000 });
    // The timeline is on the extrusion's step: shown, as it was then, and the
    // later cube not made yet.
    expect(
      await page.evaluate(() => window.__store.getState().activeHistoryId),
    ).toBe(await mergedStep());
    expect(await hiddenNow(id)).toBe(false);
    expect(
      await page.evaluate(() =>
        window.__store.getState().items.some((i) => i.id === 900),
      ),
    ).toBe(false);

    // Cancel: back to the latest step, where it is hidden again.
    await page.keyboard.press("Escape");
    await expect(overlay()).toBeHidden();
    expect(
      await page.evaluate(() => window.__store.getState().activeHistoryId),
    ).toBeNull();
    expect(await hiddenNow(id)).toBe(true);
    await page.evaluate((id) => {
      window.__store.getState().toggleItemVisibility(id);
    }, id);
  });

  test("unticked in an edit it un-merges; ticked again it merges back", async () => {
    const id = await mergedId();
    const inputs = () =>
      page.evaluate(
        (id) =>
          window.__store.getState().items.find((i) => i.id === id)?.regenerator
            ?.inputIds ?? null,
        id,
      );

    await editMerged();
    await expect(overlay()).toBeVisible({ timeout: 5000 });
    const combine = page.locator("#extrude-combine");
    await expect(combine).toBeEnabled();
    await expect(
      combine,
      "it is merged, so Combine starts ticked",
    ).toBeChecked();
    await combine.uncheck();
    await page.locator("#extrude-distance").press("Enter");
    await expect(overlay()).toBeHidden();
    await expect.poll(inputs).toEqual([]);
    // The cube it had merged into shows again, at the latest step.
    expect(await hiddenNow(800)).toBe(false);

    await editMerged();
    await expect(overlay()).toBeVisible({ timeout: 5000 });
    await expect(combine, "now separate, so unticked").not.toBeChecked();
    await combine.check();
    await page.locator("#extrude-distance").press("Enter");
    await expect(overlay()).toBeHidden();
    await expect.poll(inputs, { timeout: 30000 }).toEqual([800]);
    expect(await hiddenNow(800)).toBe(true);
  });

  test("ticked in an edit of the standalone one, it merges into the cube", async () => {
    // The first extrusion, made with Combine off.  Its Edit moves the
    // timeline to its step, where the cube is still on show to merge into.
    const standalone = await page.evaluate(
      () =>
        window.__store.getState().items.find((i) => i.type === "extrude").id,
    );
    await page
      .getByTitle("Edit extrusion — change the profile and length", {
        exact: false,
      })
      .first()
      .click();
    await expect(overlay()).toBeVisible({ timeout: 5000 });
    const combine = page.locator("#extrude-combine");
    await expect(combine, "standalone, so unticked").not.toBeChecked();
    await combine.check();
    // What the merge depends on, as the dialog is confirmed: the cube must be
    // on show at this step and the sketch attached to it.
    const before = await page.evaluate((id) => {
      const s = window.__store.getState();
      const sketch = s.items.find((i) => i.type === "sketch");
      return {
        active: s.activeHistoryId,
        retargetId: s.extrudeRetargetId,
        standalone: id,
        cube: s.items.find((i) => i.id === 800)?.visible ?? "missing",
        sketchHost: sketch?.hostSolidId ?? null,
        combine: s.extrudeDepthInput?.combine,
        locked: s.extrudeDepthInput?.combineLocked,
      };
    }, standalone);
    await page.locator("#extrude-distance").press("Enter");
    await expect(overlay()).toBeHidden();
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const it = window.__store.getState().items.find((i) => i.id === id);
            return it
              ? {
                  type: it.type,
                  kind: it.regenerator?.kind ?? null,
                  inputs: it.regenerator?.inputIds ?? null,
                }
              : null;
          }, standalone),
        {
          timeout: 30000,
          message: `when confirmed: ${JSON.stringify(before)}`,
        },
      )
      // The same object, now merged into the cube, in its own step.
      .toEqual({ type: "csg", kind: "extrudeUnion", inputs: [800] });
  });

  test("a cut disables it", async () => {
    await pickCircle();
    await overlay().getByRole("button", { name: "Cut" }).click();
    await expect(page.locator("#extrude-combine")).toBeDisabled();
    await page.keyboard.press("Escape");
  });
});
