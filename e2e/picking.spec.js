import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import fs from "node:fs";

// REAL raycast picking on mesh bodies — the one seam every other tool spec
// sidesteps by seeding picks through the store.  Here the clicks are aimed
// with cameraControls.worldToScreen and go through the genuine mouse
// handlers: Ctrl+click an edge for chamfer, click faces for the texture
// tool's connected-face grow, then confirm each op end-to-end.

let app;
let page;

const screenPt = (x, y, z) =>
  page.evaluate(
    ([x, y, z]) =>
      window.__store.getState()._cameraControls.worldToScreen(x, y, z),
    [x, y, z],
  );

test.describe.serial("real raycast picking", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await page.evaluate(() => {
      window.__store.getState().addItem({
        id: 400,
        name: "Cube 400",
        type: "cube",
        children: [],
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    });
    await page.waitForTimeout(800); // scene + camera settle
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("Ctrl+click picks a real edge; chamfer confirms end-to-end", async () => {
    await page
      .getByTitle("Chamfer — select faces/edges", { exact: false })
      .click();
    // Top-front edge of the cube (world): from (-1,2,1) to (1,2,1) → aim at
    // its midpoint.  The default camera looks from +X/+Y/+Z so it's visible.
    const mid = await screenPt(0, 2, 1);
    expect(mid.inFront).toBe(true);
    await page.keyboard.down("Control");
    await page.mouse.click(mid.x, mid.y);
    await page.keyboard.up("Control");

    const sel = await page.evaluate(
      () => window.__store.getState().selectedSubGeometry,
    );
    expect(sel?.itemId).toBe(400);
    expect(sel.edges.length).toBe(1);
    // The picked edge is the real top-front edge, in the mesh's local frame.
    const e = sel.edges[0];
    expect(Math.abs(e.ay - 1) + Math.abs(e.by - 1)).toBeLessThan(0.05);
    expect(Math.abs(e.az - 1) + Math.abs(e.bz - 1)).toBeLessThan(0.05);

    const overlay = page.locator(".sketch-distance-input-overlay");
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.id === 400)
              ?.regenerator?.kind ?? null,
        ),
      )
      .toBe("chamfer");
  });

  test("Alt-free face click feeds the texture tool's connected-face grow", async () => {
    // The cube is now a chamfered csg with a REAL tessellated mesh — clicking
    // its top face must run growConnectedFaceSet on genuine geometry.
    await page
      .getByTitle("Texture — displace faces with a black-and-white image", {
        exact: false,
      })
      .click();
    const top = await screenPt(0.3, 2, -0.2); // on the top face, off-centre
    await page.mouse.click(top.x, top.y);

    const tt = await page.evaluate(() => {
      const t = window.__store.getState().textureTool;
      return {
        itemId: t?.itemId ?? null,
        valid: !!t?.facesValid,
        tris: t?.faceTris?.length ?? 0,
        // The grown region's plane: a top-face pick reports an up normal.
        ny: t?.face?.ny ?? 0,
      };
    });
    expect(tt.itemId).toBe(400);
    expect(tt.valid).toBe(true);
    expect(tt.tris).toBeGreaterThan(0);
    expect(tt.ny).toBeGreaterThan(0.9);

    // Clicking the same face again toggles it back off (mesh-face picks
    // accumulate/toggle).
    await page.mouse.click(top.x, top.y);
    const cleared = await page.evaluate(
      () => window.__store.getState().textureTool?.facesValid ?? null,
    );
    expect(cleared).toBe(false);
    await page.keyboard.press("Escape");
  });

  test("B toggles chain selection, only while faces or edges are on", async () => {
    // B presses the 3D selection widget's fifth button, as Z X C V press the
    // first four; in a sketch it stays the constraint filter.
    const sel = () =>
      page.evaluate(() => {
        const s = window.__store.getState();
        return { chain: s.selChain, face: s.selFace, object: s.selObject };
      });
    await page.evaluate(() =>
      window.__store.setState({
        selObject: false,
        selFace: true,
        selEdge: false,
        selPoint: false,
        selChain: true,
      }),
    );
    await page.keyboard.press("b");
    expect((await sel()).chain, "chain after B").toBe(false);
    await page.keyboard.press("b");
    expect((await sel()).chain, "chain after B again").toBe(true);
    // With only Object selection on there is nothing to chain, and the
    // widget greys the button: B leaves the setting alone.
    await page.evaluate(() =>
      window.__store.setState({
        selObject: true,
        selFace: false,
        selEdge: false,
      }),
    );
    await page.keyboard.press("b");
    const after = await sel();
    expect(after.chain, "chain after B with no face/edge selection").toBe(true);
    expect(after.object, "object selection untouched by B").toBe(true);
  });

  // An edge pick offers the body's REAL edges, the lines drawn on it.  It used
  // to offer every crease between triangles, so on a curved wall each seam
  // between facets was an "edge": a click on a boss's side chamfered a seam
  // down the cylinder.  Clicks across a ring's curved wall must select only
  // edges its outline draws -- and still find its rims.
  test("an edge pick on a curved body takes only the edges drawn on it", async () => {
    test.setTimeout(180000);
    const doc = JSON.parse(
      fs.readFileSync("test-files/reorder-timeline-before.pcad", "utf8"),
    );
    await page.evaluate((d) => {
      const s = window.__store.getState();
      s.loadDocument(d);
    }, doc);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const s = window.__store.getState();
            return s.pendingOperations === 0 && s.regenProgress == null;
          }),
        { timeout: 120000 },
      )
      .toBe(true);
    const {
      result: { bodies },
    } = await page.evaluate(() => window.__api.call("body.list", {}));
    const ring = bodies[0];
    // body.list is mm in the user's Z-up frame: internal x = X, y = Z, z = -Y.
    const corners = [];
    for (const X of [ring.bboxMm.min[0], ring.bboxMm.max[0]])
      for (const Y of [ring.bboxMm.min[1], ring.bboxMm.max[1]])
        for (const Z of [ring.bboxMm.min[2], ring.bboxMm.max[2]])
          corners.push(await screenPt(X / 10, Z / 10, -Y / 10));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];

    await page.evaluate(() => {
      window.__store.setState({ selChain: true, curveDetectionAngleDeg: 30 });
      window.__store.getState().setChamferSelectMode("chamfer");
    });
    await page.waitForTimeout(300);
    let edgePicks = 0;
    let longest = 0;
    const strays = [];
    for (let gy = 1; gy < 16; gy++)
      for (let gx = 1; gx < 16; gx++) {
        const x = x0 + ((x1 - x0) * gx) / 16;
        const y = y0 + ((y1 - y0) * gy) / 16;
        await page.evaluate(() =>
          window.__store.getState().clearSelectedSubGeometry(),
        );
        await page.mouse.move(x, y - 1);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        const r = await page.evaluate(() => {
          const s = window.__store.getState();
          const g = s.selectedSubGeometry;
          if (!g?.edges?.length) return null;
          const item = s.items.find((i) => i.id === g.itemId);
          const { positions: p, edges } = item.geometryData;
          const key = (x, y, z) =>
            `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;
          const drawn = new Set();
          for (let k = 0; k < edges.length; k += 2) {
            const a = key(
              p[3 * edges[k]],
              p[3 * edges[k] + 1],
              p[3 * edges[k] + 2],
            );
            const b = key(
              p[3 * edges[k + 1]],
              p[3 * edges[k + 1] + 1],
              p[3 * edges[k + 1] + 2],
            );
            drawn.add(`${a}|${b}`);
            drawn.add(`${b}|${a}`);
          }
          const off = g.edges.filter(
            (e) =>
              !drawn.has(`${key(e.ax, e.ay, e.az)}|${key(e.bx, e.by, e.bz)}`),
          );
          return { n: g.edges.length, off: off.length, e: off[0] ?? null };
        });
        if (!r) continue;
        edgePicks++;
        longest = Math.max(longest, r.n);
        if (r.off) strays.push({ at: [Math.round(x), Math.round(y)], ...r });
      }
    expect(
      strays,
      `clicks that picked an edge the body doesn't draw: ${JSON.stringify(strays.slice(0, 3))}`,
    ).toEqual([]);
    // The grid does reach the rims, and a rim selects as one whole curve.
    expect(edgePicks, "clicks that picked an edge").toBeGreaterThan(0);
    expect(longest, "segments in the longest edge picked").toBeGreaterThan(8);
  });
});
