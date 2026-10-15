import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

// Measuring in a sketch, a click on a line picks the LINE: the lines of a
// chain round a circle are a few pixels long, so every click on one was
// within snap range of an end and picked that vertex instead -- no line, and
// so no chain, could be measured.  A line's end is still picked when the click
// is right on it.  Real clicks; the screen <-> sketch mapping is calibrated as
// in sketch-shift-drag.spec.js.

const SK = 320;
let app;
let page;
let toScreen;

const shapes = () =>
  page.evaluate(
    (id) => window.__store.getState().items.find((i) => i.id === id)?.shapes,
    SK,
  );
const state = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return {
      picks: s.measureTool?.picks.length ?? null,
      line:
        s.selectedSketchElement?.type === "line"
          ? s.selectedSketchElement.shapeIdx
          : null,
      multi: s.sketchMultiSelectedIndices?.length ?? 0,
    };
  });
const readout = async () =>
  (await page.locator(".measure-readout").innerText())
    .replace(/\s+/g, " ")
    .trim();

// Placed where the calibration probe was drawn, so it's on screen at any
// zoom: shape 0 a long line along the probe's first part, shapes 1-24 a ring
// of 24 lines round a circle whose lines are about 15 px long on screen.
let longLine;
let ring;
const ringPoint = (k) => {
  const a = (k / 24) * 2 * Math.PI;
  return [ring.cx + ring.r * Math.cos(a), ring.cy + ring.r * Math.sin(a)];
};

test.describe.serial("picking lines to measure in a sketch", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.addItem({
        id,
        type: "sketch",
        name: "Measure Picks",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(id);
    }, SK);
    await page.waitForTimeout(1600); // fly-in tween settles top-down
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.45, y: size.height * 0.4 };
    const p2 = { x: size.width * 0.75, y: size.height * 0.6 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(1);
    const probe = (await shapes())[0];
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    const pxPerUnit = Math.abs(a);
    const dx = probe.x2 - probe.x1;
    longLine = {
      x1: probe.x1,
      y1: probe.y1,
      x2: probe.x1 + dx * 0.4,
      y2: probe.y1,
    };
    // A ring line's chord is 2 r sin(7.5 deg): about 15 px.
    ring = {
      cx: probe.x1 + dx * 0.75,
      cy: probe.y1,
      r: 15 / (2 * Math.sin(Math.PI / 24) * pxPerUnit),
    };
    await page.evaluate(
      ({ id, longLine, ring }) => {
        const s = window.__store.getState();
        s.setActiveSketchTool(null);
        const lines = Array.from({ length: 24 }, (_, i) => {
          const a0 = (i / 24) * 2 * Math.PI;
          const a1 = ((i + 1) / 24) * 2 * Math.PI;
          return {
            type: "line",
            x1: ring.cx + ring.r * Math.cos(a0),
            y1: ring.cy + ring.r * Math.sin(a0),
            x2: ring.cx + ring.r * Math.cos(a1),
            y2: ring.cy + ring.r * Math.sin(a1),
          };
        });
        // Joined end to end as the line tool joins a chain it draws: a
        // coincident constraint at each corner, which is what a double-click
        // follows to pick the whole chain.
        const joins = lines.map((_, i) => ({
          type: "coincident",
          shapeAIdx: 1 + i,
          pointA: "end",
          shapeBIdx: 1 + ((i + 1) % 24),
          pointB: "start",
        }));
        s.modifyItem(id, {
          shapes: [{ type: "line", ...longLine }, ...lines],
          constraints: joins,
        });
        s.startMeasureTool();
      },
      { id: SK, longLine, ring },
    );
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(25);
    await page.waitForTimeout(400);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("a click on a short line of a ring picks the line, not an end", async () => {
    const [x0, y0] = ringPoint(0);
    const [x1, y1] = ringPoint(1);
    const A = toScreen(x0, y0);
    const B = toScreen(x1, y1);
    const lengthPx = Math.hypot(B.x - A.x, B.y - A.y);
    // Short enough that an end is within the 14 px snap range of its middle:
    // the case that used to pick a vertex.
    expect(lengthPx, "ring line on screen").toBeLessThan(28);
    await page.mouse.click((A.x + B.x) / 2, (A.y + B.y) / 2);
    await expect.poll(state).toEqual({ picks: 0, line: 1, multi: 0 });
    expect(await readout()).toMatch(/^Length /);
  });

  test("a click right on a long line's end still picks the vertex", async () => {
    const E = toScreen(longLine.x2, longLine.y2);
    await page.mouse.click(E.x - 2, E.y);
    await expect.poll(async () => (await state()).picks).toBe(1);
  });

  test("a double-click on a ring line picks the chain, and reads its diameter", async () => {
    const [x0, y0] = ringPoint(3);
    const [x1, y1] = ringPoint(4);
    const A = toScreen(x0, y0);
    const B = toScreen(x1, y1);
    await page.mouse.dblclick((A.x + B.x) / 2, (A.y + B.y) / 2);
    await expect.poll(async () => (await state()).multi).toBe(24);
    const text = await readout();
    const diameter = Number(text.match(/Diameter ([\d.]+) mm/)?.[1]);
    expect(diameter, text).toBeCloseTo(ring.r * 2 * 10, 1);
    expect(text).not.toContain("Distance");
  });
});
