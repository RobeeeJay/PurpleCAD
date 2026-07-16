import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

// The 2D sketch workflow with REAL mouse input: enter sketch mode, draw a
// rectangle and a circle by clicking the canvas, undo/redo a shape, then
// extrude the drawn region through the profile-pick + depth-overlay flow.
// This is the interaction surface (sketchDraw / sketchInteraction /
// SketchOverlays) that unit tests structurally can't touch.
//
// Screen↔sketch mapping: the top-down sketch camera is calibrated by drawing
// a probe line at two known SCREEN points, reading back its LOCAL endpoints,
// solving the axis-aligned affine transform, then undoing the probe.

let app;
let page;
let toScreen; // (lx, ly) -> {x, y}

const shapes = () =>
  page.evaluate(
    () => window.__store.getState().items.find((i) => i.id === 300)?.shapes,
  );

test.describe.serial("2D sketch workflow", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("enter sketch mode and calibrate the sketch plane", async () => {
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem({
        id: 300,
        type: "sketch",
        name: "Sketch W",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // ground sketch
        scale: { x: 1, y: 1, z: 1 },
        shapes: [],
        constraints: [],
      });
      s.selectItem(300);
    });
    await page.waitForTimeout(1600); // fly-in tween settles top-down

    // Probe: draw a line between two screen points, read its local coords.
    const size = page.viewportSize() || { width: 1400, height: 868 };
    const p1 = { x: size.width * 0.55, y: size.height * 0.35 };
    const p2 = { x: size.width * 0.8, y: size.height * 0.7 };
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.press("Escape"); // end the line chain
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(1);
    const probe = (await shapes())[0];
    // Solve sx = a·lx + b, sy = c·ly + d (top-down view is axis-aligned).
    const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
    const b = p1.x - a * probe.x1;
    const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
    const d = p1.y - c * probe.y1;
    toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
    expect(Number.isFinite(a) && Number.isFinite(c)).toBe(true);

    await page.evaluate(() => window.__store.getState().undoSketch(300));
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(0);
  });

  test("draw a rectangle with the mouse (4 lines at the right coords)", async () => {
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("rect"),
    );
    const A = toScreen(0, 0);
    const B = toScreen(2, 1.5); // 20 × 15 mm
    await page.mouse.click(A.x, A.y);
    await page.mouse.click(B.x, B.y);
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(4);
    const lines = await shapes();
    for (const l of lines) expect(l.type).toBe("line");
    // Envelope of all endpoints ≈ the requested rectangle (snap tolerance).
    const xs = lines.flatMap((l) => [l.x1, l.x2]);
    const ys = lines.flatMap((l) => [l.y1, l.y2]);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(2, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(1.5, 1);
  });

  test("draw a circle; sketch undo/redo behave", async () => {
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("circle"),
    );
    const C = toScreen(4, 0.75);
    const R = toScreen(4.5, 0.75); // radius 0.5 units = 5 mm
    await page.mouse.click(C.x, C.y);
    await page.mouse.click(R.x, R.y);
    await expect.poll(async () => (await shapes())?.length ?? 0).toBe(5);
    const circle = (await shapes()).find((s) => s.type === "circle");
    expect(circle).toBeTruthy();
    expect(circle.cx).toBeCloseTo(4, 1);
    expect(circle.cy).toBeCloseTo(0.75, 1);
    expect(circle.r).toBeCloseTo(0.5, 1);

    await page.evaluate(() => window.__store.getState().undoSketch(300));
    expect((await shapes()).length).toBe(4); // circle gone
    await page.evaluate(() => window.__store.getState().redoSketch(300));
    expect((await shapes()).length).toBe(5); // and back
  });

  test("trim removes a segment up to the crossing line (real clicks)", async () => {
    // Two crossing lines drawn with the mouse: a horizontal one through a
    // vertical one; trimming the horizontal's left arm removes it up to the
    // crossing.
    const before = (await shapes()).length;
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    const H1 = toScreen(-4, -2);
    const H2 = toScreen(-1, -2);
    await page.mouse.click(H1.x, H1.y);
    await page.mouse.click(H2.x, H2.y);
    await page.keyboard.press("Escape");
    const V1 = toScreen(-2.5, -3);
    const V2 = toScreen(-2.5, -1);
    await page.mouse.click(V1.x, V1.y);
    await page.mouse.click(V2.x, V2.y);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes()).length).toBe(before + 2);

    await page
      .getByTitle("Trim — click or drag over a line", { exact: false })
      .click();
    const hit = toScreen(-3.5, -2); // on the horizontal's LEFT arm
    await page.mouse.click(hit.x, hit.y);
    await expect
      .poll(async () => {
        const line = (await shapes()).find(
          (sh) =>
            sh.type === "line" &&
            Math.abs(sh.y1 - -2) < 0.05 &&
            Math.abs(sh.y2 - -2) < 0.05,
        );
        return line ? Math.min(line.x1, line.x2) : null;
      })
      .toBeCloseTo(-2.5, 1); // left arm gone: line now starts at the crossing
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
  });

  test("horizontal constraint straightens a slanted line via the toolbar", async () => {
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    const A = toScreen(-4, 1);
    const B = toScreen(-1.5, 1.4); // slightly slanted
    await page.mouse.click(A.x, A.y);
    await page.mouse.click(B.x, B.y);
    await page.keyboard.press("Escape");
    const idx = (await shapes()).length - 1;
    // Select the line by clicking on it (select mode = no active tool).
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
    const mid = toScreen(-2.75, 1.2);
    await page.mouse.click(mid.x, mid.y);
    const selected = await page.evaluate(
      () => window.__store.getState().selectedSketchElement,
    );
    expect(selected?.type).toBe("line");
    expect(selected.shapeIdx).toBe(idx);

    await page
      .getByTitle("Horizontal — force the selected line", { exact: false })
      .click();
    const line = (await shapes())[idx];
    expect(line.y1).toBeCloseTo(line.y2, 5);
  });

  test("offset creates a linked parallel copy of the selected circle", async () => {
    const before = (await shapes()).length;
    const circleIdx = (await shapes()).findIndex((sh) => sh.type === "circle");
    // Select the circle by clicking its rim (right-most point).
    const rim = toScreen(4.5, 0.75);
    await page.mouse.click(rim.x, rim.y);
    const sel = await page.evaluate(
      () => window.__store.getState().selectedSketchElement,
    );
    expect(sel?.shapeIdx).toBe(circleIdx);

    await page
      .getByTitle("Offset — parallel copy of the selected lines", {
        exact: false,
      })
      .click();
    await expect.poll(async () => (await shapes()).length).toBe(before + 1);
    const all = await shapes();
    const circles = all.filter((sh) => sh.type === "circle");
    expect(circles.length).toBe(2);
    // 5 mm offset = 0.5 units: concentric circle, radius ± 0.5.
    expect(Math.abs(circles[1].r - circles[0].r)).toBeCloseTo(0.5, 1);
    expect(circles[1].cx).toBeCloseTo(circles[0].cx, 3);
    // Linked by an offset constraint so the distance stays editable.
    const constraints = await page.evaluate(
      () =>
        window.__store.getState().items.find((i) => i.id === 300).constraints,
    );
    expect(constraints.some((c) => c.type === "offset")).toBe(true);

    // Commit the offset's live distance input so its overlay closes (the
    // extrude flow opens its own overlay next).
    await page.keyboard.press("Enter");
    await expect(page.locator(".sketch-distance-input-overlay")).toBeHidden();
  });

  test("distance dimension: pick two endpoints, type a length, solver obeys", async () => {
    // The horizontal line from the constraint test spans x -4..-1.5 at y≈1.
    const lineIdx = await page.evaluate(() => {
      const shapes = window.__store
        .getState()
        .items.find((i) => i.id === 300).shapes;
      return shapes.findIndex(
        (sh) =>
          sh.type === "line" &&
          Math.abs(sh.y1 - sh.y2) < 1e-4 &&
          Math.abs(sh.y1 - 1) < 0.4,
      );
    });
    expect(lineIdx).toBeGreaterThanOrEqual(0);
    const line = (await shapes())[lineIdx];

    // D arms the distance-constraint tool; click both endpoints.
    await page.keyboard.press("d");
    const P1 = toScreen(line.x1, line.y1);
    const P2 = toScreen(line.x2, line.y2);
    await page.mouse.click(P1.x, P1.y);
    await page.mouse.click(P2.x, P2.y);
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await overlay.locator("input").first().fill("30");
    await overlay.locator("input").first().press("Enter");

    // The solver moves an endpoint so the span is exactly 30 mm (3 units).
    await expect
      .poll(async () => {
        const l = (await shapes())[lineIdx];
        return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      })
      .toBeCloseTo(3, 1);
    // And the dimension persists as a constraint.
    const hasDim = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 300)
        .constraints.some((c) => /dist/i.test(c.type)),
    );
    expect(hasDim).toBe(true);
  });

  test("mirror reflects a clicked circle across a clicked line", async () => {
    // Vertical mirror line at x=6, then mirror the circle at (4, 0.75).
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    const M1 = toScreen(6, -1);
    const M2 = toScreen(6, 2.5);
    await page.mouse.click(M1.x, M1.y);
    await page.mouse.click(M2.x, M2.y);
    await page.keyboard.press("Escape");
    const before = (await shapes()).length;

    await page
      .getByTitle("Mirror — pick a mirror line", { exact: false })
      .click();
    // First click: the mirror line; second: the geometry to reflect.
    const onLine = toScreen(6, 1.5);
    await page.mouse.click(onLine.x, onLine.y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().sketchMirrorState?.lineIdx ?? null,
        ),
      )
      .not.toBe(null);
    const onCircle = toScreen(4.5, 0.75); // the circle's rim
    await page.mouse.click(onCircle.x, onCircle.y);
    // Phase 2 toggles shapes into the mirror SET (live preview); the copy is
    // committed by the overlay's Confirm button.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchMirrorState?.shapeIndices.length ??
            0,
        ),
      )
      .toBe(1);
    await page
      .getByTitle("Confirm — create the mirrored geometry")
      .click();

    await expect.poll(async () => (await shapes()).length).toBe(before + 1);
    const circles = (await shapes()).filter((sh) => sh.type === "circle");
    const mirrored = circles.find((c) => c.cx > 6);
    expect(mirrored).toBeTruthy();
    expect(mirrored.cx).toBeCloseTo(8, 1); // 4 reflected about x=6
    expect(mirrored.cy).toBeCloseTo(0.75, 1);
    // Linked with a mirror constraint (stays in sync with the source).
    const hasMirror = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 300)
        .constraints.some((c) => c.type === "mirror"),
    );
    expect(hasMirror).toBe(true);
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
  });

  test("circular pattern repeats a circle around a picked centre", async () => {
    // Centre snap point: draw a short line whose endpoint is the hub.
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    const HUB = { x: 4, y: 4 };
    const L1 = toScreen(HUB.x, HUB.y);
    const L2 = toScreen(HUB.x + 1, HUB.y);
    await page.mouse.click(L1.x, L1.y);
    await page.mouse.click(L2.x, L2.y);
    await page.keyboard.press("Escape");
    const before = (await shapes()).length;

    await page
      .getByTitle("Circular Pattern — pick a centre point", { exact: false })
      .click();
    await page.mouse.click(L1.x, L1.y); // phase 1: the hub endpoint
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchCircularPatternState
              ?.centerShapeIdx ?? null,
        ),
      )
      .not.toBe(null);
    // Phase 2: the original circle at (4, 0.75) joins the pattern set.
    const rim = toScreen(4.5, 0.75);
    await page.mouse.click(rim.x, rim.y);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchCircularPatternState?.shapeIndices
              ?.length ?? 0,
        ),
      )
      .toBe(1);
    await page.getByTitle("Confirm — create the patterned geometry").click();

    // Copies appear (count comes from the document default, > 1), each the
    // same radius at the same distance from the hub as the source.
    const all = await shapes();
    const copies = all.slice(before + 1).filter((sh) => sh.type === "circle");
    expect(copies.length).toBeGreaterThan(0);
    const srcDist = Math.hypot(4 - HUB.x, 0.75 - HUB.y);
    for (const c of copies) {
      expect(c.r).toBeCloseTo(0.5, 1);
      expect(Math.hypot(c.cx - HUB.x, c.cy - HUB.y)).toBeCloseTo(srcDist, 1);
    }
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
  });

  test("text tool decomposes typed text into sketch geometry", async () => {
    const before = (await shapes()).length;
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("text"),
    );
    const at = toScreen(-4, 4);
    await page.mouse.click(at.x, at.y);
    // The dialog opens seeded at the click point; type and create.
    const dialog = page.locator(".variables-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.locator("textarea").fill("OK");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect
      .poll(async () => (await shapes()).length)
      .toBeGreaterThan(before);
    // Text persists as ONE "text" shape at the click point (its glyph
    // outlines are decomposed later, at loop-finding/extrude time).
    const added = (await shapes()).slice(before);
    expect(added.length).toBe(1);
    expect(added[0].type).toBe("text");
    expect(added[0].text).toBe("OK");
    expect(added[0].x).toBeCloseTo(-4, 0);
    expect(added[0].y).toBeCloseTo(4, 0);
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );
  });

  test("measure reports the distance between two picked points", async () => {
    await page.evaluate(() => window.__store.getState().startMeasureTool());
    // Two known endpoints of the hub line drawn earlier: (4,4) and (5,4).
    const P1 = toScreen(4, 4);
    const P2 = toScreen(5, 4);
    await page.mouse.click(P1.x, P1.y);
    await page.mouse.click(P2.x, P2.y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().measureTool?.picks?.length ?? 0,
        ),
      )
      .toBe(2);
    // The overlay reports 10 mm (1 scene unit).
    await expect(page.locator(".measure-overlay")).toContainText("10");
    await page.evaluate(() => window.__store.getState().cancelMeasureTool());
  });

  test("midpoint constraint pins a point to a line's middle and tracks drags", async () => {
    // Draw a fresh line and a point with the mouse.
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("line"),
    );
    const L1 = toScreen(-4, -5);
    const L2 = toScreen(0, -5);
    await page.mouse.click(L1.x, L1.y);
    await page.mouse.click(L2.x, L2.y);
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool("point"),
    );
    const P = toScreen(-1, -6.5); // deliberately off the line
    await page.mouse.click(P.x, P.y);
    const lineIdx = (await shapes()).length - 2;
    const pointIdx = lineIdx + 1;
    expect((await shapes())[pointIdx].type).toBe("point");
    await page.evaluate(() =>
      window.__store.getState().setActiveSketchTool(null),
    );

    // Select the POINT first, then shift-click the line (the shift-click
    // hit-test targets line-drawn shapes; the seed carries any element kind).
    const onPoint = toScreen(-1, -6.5);
    await page.mouse.click(onPoint.x, onPoint.y);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__store.getState().selectedSketchElement?.type ?? null,
        ),
      )
      .toBe("point");
    const onLine = toScreen(-3, -5);
    await page.keyboard.down("Shift");
    await page.mouse.click(onLine.x, onLine.y);
    await page.keyboard.up("Shift");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().sketchMultiSelectedIndices?.length ?? 0,
        ),
      )
      .toBe(2);
    await page
      .getByTitle("Midpoint — pin the selected point", { exact: false })
      .click();

    // The point snapped to the line's middle and the constraint persisted.
    let pt = (await shapes())[pointIdx];
    expect(pt.x).toBeCloseTo(-2, 1);
    expect(pt.y).toBeCloseTo(-5, 1);
    const hasConstraint = await page.evaluate(() =>
      window.__store
        .getState()
        .items.find((i) => i.id === 300)
        .constraints.some((c) => c.type === "midpoint"),
    );
    expect(hasConstraint).toBe(true);

    // Drag the line with the mouse — wherever it lands (endpoint stretch or
    // whole-line translate depending on the grab), the point rides its middle.
    const end = toScreen(0, -5);
    const target = toScreen(2, -5);
    await page.mouse.move(end.x, end.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(
        async () => {
          const all = await shapes();
          const ln = all[lineIdx];
          const p = all[pointIdx];
          return Math.hypot(
            p.x - (ln.x1 + ln.x2) / 2,
            p.y - (ln.y1 + ln.y2) / 2,
          );
        },
        { timeout: 5000 },
      )
      .toBeLessThan(0.05);
    // And the line really moved (the drag did something).
    const moved = (await shapes())[lineIdx];
    expect(Math.max(moved.x1, moved.x2)).toBeGreaterThan(0.5);
  });

  test("extrude the drawn rectangle through the profile-pick flow", async () => {
    // Leave the drawing tool, then start the extrude profile pick.
    await page.evaluate(() => {
      window.__store.getState().setActiveSketchTool(null);
      window.__store.getState().setExtrudeSelectMode("profile");
    });
    await page.waitForTimeout(600); // region fills materialise
    // Click inside the rectangle region (its centre).
    const centre = toScreen(1, 0.75);
    await page.mouse.click(centre.x, centre.y);
    // The depth overlay appears once a profile is selected.
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    // The bar holds two formula fields: start-offset first, DEPTH second
    // (autofocused).
    const depth = overlay.locator("input").nth(1);
    await depth.fill("8");
    await depth.press("Enter");

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const it = window.__store
              .getState()
              .items.find((i) => i.type === "extrude");
            return it ? { depth: it.depth } : null;
          }),
        { timeout: 30000 },
      )
      .toBeTruthy();
    const extrude = await page.evaluate(() => {
      const it = window.__store.getState().items.find(
        (i) => i.type === "extrude",
      );
      return {
        depth: it.depth,
        poly: it.profile?.polygon2D?.length ?? 0,
        // A single extrude commits via addItem (label "Added"); assert the
        // CREATE entry for this item exists rather than a specific label.
        created: window.__store
          .getState()
          .history.some(
            (h) =>
              h.instruction?.type === "create" &&
              h.instruction.item?.id === it.id,
          ),
      };
    });
    // Depth persists as a user-facing mm formula string ("8" = 8 mm — see
    // the variables/formulas convention in CLAUDE.md).
    expect(Number(extrude.depth)).toBeCloseTo(8, 3);
    expect(extrude.poly).toBeGreaterThanOrEqual(4);
    expect(extrude.created).toBe(true);
  });
});
