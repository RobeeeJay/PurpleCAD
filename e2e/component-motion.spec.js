import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Components and their motion, driven through the Objects list and the motion
// dialog: a component (was "folder") holds a cube; its motion is set up with
// the dialog, the reference picked the way an Alt+click on a face records it;
// play moves the cube; with collision detection on, sliding into another cube
// stops the motion and rings the collision point in red; play carries on;
// stop puts the cube back.  The animation is display only, so positions are
// read from the scene's meshes.

let app;
let page;

const LID = 700;
const WALL = 701;

const state = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return {
      folders: s.folders,
      motionTool: s.motionTool,
      motionPlaying: s.motionPlaying,
      motionCollision: s.motionCollision,
    };
  });
const motion = () =>
  page.evaluate(() =>
    window.__store.getState()._cameraControls.componentMotionState(),
  );
// The lid mesh's world transform, as drawn.
const lidMatrix = () =>
  page.evaluate(
    (id) => window.__store.getState()._cameraControls.meshWorldData(id).matrix,
    LID,
  );
const lidX = async () => (await lidMatrix())[12];
const dialog = () => page.locator(".component-motion-overlay");

const snap = async (testInfo, name) => {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, timeout: 15_000 });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
};

test.describe.serial("component motion", () => {
  let folderId;

  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(
      ({ lid, wall }) => {
        const s = window.__store.getState();
        const cube = (id, name, x) => ({
          id,
          name,
          type: "cube",
          children: [],
          parentId: null,
          position: { x, y: 1, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        });
        s.addItem(cube(lid, "Lid", 0));
        s.addItem(cube(wall, "Wall", 4));
      },
      { lid: LID, wall: WALL },
    );
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the Objects list makes Components, not folders", async () => {
    const button = page.locator(".tree-view-header .tree-header-btn", {
      has: page.locator("svg"),
    });
    await page.getByTitle(/^New component/).click();
    await expect.poll(async () => (await state()).folders.length).toBe(1);
    const folder = (await state()).folders[0];
    folderId = folder.id;
    expect(folder.name).toBe("New Component");
    await expect(button.first()).toBeVisible();
    // Put the lid in it, as a drag in the list would.
    await page.evaluate(
      ({ id, fid }) => window.__store.getState().reparentItem(id, fid),
      { id: LID, fid: folderId },
    );
    await page.keyboard.press("Escape"); // leave the new component's name as is
  });

  test("the motion button opens the dialog with the reference pick live", async () => {
    await page.getByTitle(/^Motion — set how this component moves/).click();
    await expect(dialog()).toBeVisible();
    expect((await state()).motionTool).toMatchObject({
      folderId,
      type: "rotation",
      picking: true,
    });
    // An Alt+click on the lid's +X face records this.
    await page.evaluate(
      (id) =>
        window.__store.getState().setSelectedSubGeometry({
          itemId: id,
          edges: [],
          faces: [{ nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 }],
        }),
      LID,
    );
    await expect
      .poll(async () => (await state()).motionTool.picking)
      .toBe(false);
    const ref = (await state()).motionTool.reference;
    expect(ref.kind).toBe("face");
    expect(ref.dir.x).toBeCloseTo(1, 6);
    expect(ref.origin.x).toBeCloseTo(1, 6); // the face's centre, in the world
    await expect(
      dialog().getByRole("button", { name: "Face ✓" }),
    ).toBeVisible();
    // The axis is drawn for as long as the dialog is open.
    expect((await motion()).axis).not.toBeNull();
  });

  test("an axis motion with collision detection is saved on the component", async ({}, testInfo) => {
    await dialog().getByRole("button", { name: "Axis" }).click();
    const set = async (label, value) => {
      await dialog().getByLabel(label, { exact: true }).fill(String(value));
    };
    await set("+ (mm)", 40);
    await set("− (mm)", 0);
    await set("Speed (mm/s)", 20);
    await expect
      .poll(async () => (await state()).motionTool.values.axis)
      .toEqual({ positive: 40, negative: 0, speed: 20 });
    await expect(dialog().getByLabel("Detect collisions")).toBeChecked();
    await snap(testInfo, "motion-dialog");
    await dialog().getByRole("button", { name: "Confirm" }).click();
    await expect(dialog()).toBeHidden();
    expect((await state()).folders[0].motion).toMatchObject({
      type: "axis",
      positive: 40,
      negative: 0,
      speed: 20,
      detectCollisions: true,
    });
    expect((await motion()).axis).toBeNull();
  });

  test("play slides the lid, and running into the wall stops it with a red ring", async ({}, testInfo) => {
    const x0 = await lidX();
    await page.getByTitle("Play the motion").click();
    await expect.poll(async () => (await motion()).playing).toEqual([folderId]);
    await expect.poll(lidX).toBeGreaterThan(x0 + 0.3);
    // The lid (x -1..1) meets the wall (x 3..5) after 20 mm of its 40.
    await expect
      .poll(async () => (await state()).motionCollision, { timeout: 10_000 })
      .not.toBeNull();
    const hit = (await state()).motionCollision;
    expect(hit.folderId).toBe(folderId);
    // Where the lid's front meets the wall's face: x 3, centred on the lid
    // (y 1, z 0), not off at a corner.
    expect(hit.point.x).toBeGreaterThan(2.9);
    expect(hit.point.x).toBeLessThan(3.4);
    expect(hit.point.y).toBeCloseTo(1, 1);
    expect(hit.point.z).toBeCloseTo(0, 1);
    // Paused where it hit: it doesn't keep going.
    const xHit = await lidX();
    expect(xHit - x0).toBeGreaterThan(1.9);
    expect(xHit - x0).toBeLessThan(2.4);
    await page.waitForTimeout(500);
    expect(await lidX()).toBeCloseTo(xHit, 6);
    // Ringed where it hit.
    const marker = (await motion()).collisionMarker;
    expect(marker.x).toBeCloseTo(hit.point.x, 6);
    await expect(
      page.getByTitle("Stopped by a collision — press to carry on"),
    ).toBeVisible();
    await snap(testInfo, "motion-collision");
  });

  test("play again carries on past it; stop puts the lid back", async () => {
    const xHit = await lidX();
    await page.getByTitle("Stopped by a collision — press to carry on").click();
    await expect.poll(async () => (await state()).motionCollision).toBeNull();
    expect((await motion()).collisionMarker).toBeNull();
    await expect.poll(lidX).toBeGreaterThan(xHit + 0.3);
    await page.getByTitle("Stop the motion").click();
    await expect.poll(async () => (await motion()).playing).toEqual([]);
    await expect.poll(lidX).toBeCloseTo(0, 6);
  });

  test("a rotation turns the lid about its reference without moving its centre", async () => {
    await page.getByTitle(/^Motion — set how this component moves/).click();
    await expect(dialog()).toBeVisible();
    // It re-opens on the saved motion, reference kept.
    expect((await state()).motionTool).toMatchObject({
      type: "axis",
      picking: false,
    });
    // Showing "Face ✓" for the kept reference; pressing it picks again.
    await expect(
      dialog().getByRole("button", { name: "Face ✓" }),
    ).toBeVisible();
    await dialog().getByTitle("Pick the reference on any part").click();
    await expect
      .poll(async () => (await state()).motionTool.picking)
      .toBe(true);
    // The lid's top face: spin about the vertical through its centre.
    await page.evaluate(
      (id) =>
        window.__store.getState().setSelectedSubGeometry({
          itemId: id,
          edges: [],
          faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }],
        }),
      LID,
    );
    await dialog().getByRole("button", { name: "Rotation" }).click();
    await dialog().getByLabel("Detect collisions").uncheck();
    await dialog().getByRole("button", { name: "Confirm" }).click();
    await expect(dialog()).toBeHidden();
    const before = await lidMatrix();
    await page.getByTitle("Play the motion").click();
    await expect
      .poll(async () => Math.abs((await lidMatrix())[0] - before[0]))
      .toBeGreaterThan(0.05);
    const during = await lidMatrix();
    expect(during[12]).toBeCloseTo(before[12], 6);
    expect(during[14]).toBeCloseTo(before[14], 6);
    await page.getByTitle("Stop the motion").click();
    await expect
      .poll(async () => (await lidMatrix())[0])
      .toBeCloseTo(before[0], 6);
  });
});
