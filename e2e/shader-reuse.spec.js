import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Releasing a gizmo drag and changing the selection rebuild the gizmo and
// reapply body materials. Disposing the old materials before the new ones were
// drawn made three.js delete and RECOMPILE the same shader programs every time:
// 0.35 s on a Radeon Pro 5500M, over 1 s on an Intel UHD 630, a visible hitch
// at the end of each move. Neither should link a single program.

let app, page;

test.beforeAll(async () => {
  app = await launchApp();
  page = await app.firstWindow();
  await expect(page.locator(".toolbar")).toBeVisible();
  await page.evaluate(() => {
    const sphere = (id, x) => {
      const seg = 48,
        rings = 24,
        positions = [],
        indices = [];
      for (let j = 0; j <= rings; j++)
        for (let i = 0; i <= seg; i++) {
          const v = (j / rings) * Math.PI,
            u = (i / seg) * Math.PI * 2;
          positions.push(
            Math.sin(v) * Math.cos(u),
            Math.cos(v),
            Math.sin(v) * Math.sin(u),
          );
        }
      for (let j = 0; j < rings; j++)
        for (let i = 0; i < seg; i++) {
          const a = j * (seg + 1) + i,
            b = a + seg + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      return {
        id,
        name: `Ball ${id}`,
        type: "csg",
        children: [],
        geometryData: { positions, normals: null, indices },
        position: { x, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    };
    const s = window.__store.getState();
    s.addItem(sphere(901, 0));
    s.addItem(sphere(902, 3));
    s.selectItem(901);
  });
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  await app?.close();
});

// Counts linkProgram calls made while `action` runs and the frames after it.
const linksDuring = (action) =>
  page.evaluate(async (action) => {
    const proto = WebGL2RenderingContext.prototype;
    const link = proto.linkProgram;
    let links = 0;
    proto.linkProgram = function (p) {
      links++;
      return link.call(this, p);
    };
    try {
      await window.__shaderReuseActions[action]();
      for (let i = 0; i < 10; i++)
        await new Promise((r) => requestAnimationFrame(r));
    } finally {
      proto.linkProgram = link;
    }
    return links;
  }, action);

test("releasing a gizmo drag links no shader program", async () => {
  const dragged = await page.evaluate(async () => {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    const rect = canvas.getBoundingClientRect();
    const cc = window.__store.getState()._cameraControls;
    let hit = null;
    for (let x = rect.left; x < rect.right && !hit; x += 4)
      for (let y = rect.top; y < rect.bottom && !hit; y += 4)
        if (cc.handleAt(x, y)) hit = [x, y];
    if (!hit) return false;
    const mouse = (type, x, y) =>
      canvas.dispatchEvent(
        new MouseEvent(type, {
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === "mouseup" ? 0 : 1,
          bubbles: true,
        }),
      );
    mouse("mousedown", ...hit);
    for (let k = 1; k <= 10; k++) {
      // A real mouse sends pointermove too; the render loop wakes on it.
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: hit[0] + 3 * k,
          clientY: hit[1] + k,
          buttons: 1,
          bubbles: true,
        }),
      );
      mouse("mousemove", hit[0] + 3 * k, hit[1] + k);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.__shaderReuseActions = {
      release: () => mouse("mouseup", hit[0] + 30, hit[1] + 10),
    };
    return true;
  });
  expect(dragged, "found a transform handle to drag").toBe(true);
  const before = await page.evaluate(() => {
    const it = window.__store.getState().items.find((i) => i.id === 901);
    return { p: it.position, r: it.rotation };
  });
  expect(await linksDuring("release")).toBe(0);
  // The release must actually have committed something, or the check is empty.
  const after = await page.evaluate(() => {
    const it = window.__store.getState().items.find((i) => i.id === 901);
    return { p: it.position, r: it.rotation };
  });
  expect(after).not.toEqual(before);
});

test("switching the selection links no shader program", async () => {
  await page.evaluate(() => {
    window.__shaderReuseActions = {
      select: () => window.__store.getState().selectItem(902),
    };
  });
  expect(await linksDuring("select")).toBe(0);
  expect(await page.evaluate(() => window.__store.getState().selectedId)).toBe(
    902,
  );
});
