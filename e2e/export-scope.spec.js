// The Save / Export menu offers the whole scene or only the selection for STL
// and STEP.  It used to export the selection whenever there was one, without
// saying so -- a part exported with one body still selected came out alone.
// Driven through the real menu; the download is captured as its Blob.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

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

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  // Exporting at normal resolution asks first; say yes.
  page.on("dialog", (d) => d.accept());
  await expect(page.locator(".toolbar")).toBeVisible();
  await page.evaluate(
    ([a, b]) => {
      const s = window.__store.getState();
      s.newDocument();
      s.addItem(a);
      s.addItem(b);
      s.selectItem(null);
      // Keep the download's Blob and name; swallow the download itself.
      window.__exported = null;
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj) => {
        if (obj instanceof Blob) window.__exportBlob = obj;
        return create(obj);
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && String(this.href).startsWith("blob:")) {
          window.__exported = {
            name: this.download,
            blob: window.__exportBlob,
          };
          return;
        }
        return click.apply(this, arguments);
      };
    },
    [cube(830, "Left", -3), cube(831, "Right", 3)],
  );
});

test.afterAll(async () => {
  await app?.close();
});

const menuItem = async (label) => {
  await page.getByTitle("Save / Export").click();
  return page.getByRole("button", { name: label });
};

// Export through the menu; returns the file name and, for STL, its triangle
// count (a binary STL's header holds it at byte 80).
async function exportVia(label) {
  await page.evaluate(() => (window.__exported = null));
  await (await menuItem(label)).click();
  await expect
    .poll(() => page.evaluate(() => !!window.__exported), { timeout: 30000 })
    .toBe(true);
  return page.evaluate(async () => {
    const { name, blob } = window.__exported;
    const buf = await blob.arrayBuffer();
    const text = name.endsWith(".step")
      ? new TextDecoder().decode(buf).slice(0, 13)
      : null;
    const triangles = name.endsWith(".stl")
      ? new DataView(buf).getUint32(80, true)
      : null;
    return { name, triangles, text };
  });
}

test("with nothing selected, only the scene can be exported", async () => {
  const selected = await menuItem("Export selected as STL");
  await expect(selected).toBeDisabled();
  await page.keyboard.press("Escape");
  const scene = await exportVia("Export scene as STL");
  // Two boxes, twelve triangles each.
  expect(scene).toMatchObject({ name: "scene.stl", triangles: 24 });
});

test("the scene export takes every body even with one selected", async () => {
  await page.evaluate(() => window.__store.getState().selectItem(831));
  const scene = await exportVia("Export scene as STL");
  expect(scene).toMatchObject({ name: "scene.stl", triangles: 24 });
});

test("the selection export takes only the selected body, named after it", async () => {
  await page.evaluate(() => window.__store.getState().selectItem(831));
  const stl = await exportVia("Export selected as STL");
  expect(stl).toMatchObject({ name: "Right.stl", triangles: 12 });
  const step = await exportVia("Export selected as STEP");
  expect(step).toMatchObject({ name: "Right.step", text: "ISO-10303-21;" });
});
