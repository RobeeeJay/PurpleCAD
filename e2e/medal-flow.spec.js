// A medal, built from the features a medal actually needs: a round blank spun
// on the lathe, a star logo standing proud of the face, a bevel round the
// outside edge top and bottom, a bore for the ribbon, and raised text.
//
// The blank is REVOLVED rather than extruded from a circle. An extruded circle
// is rebuilt as a many-sided prism, so its rim is dozens of separate straight
// edges: one edge pick bevels a single facet, and picking the whole face is
// rejected once the face is holed. A revolve gives one true circular rim edge,
// which one pick bevels all the way round -- and a medal that is actually round.
//
// Ends by saving test-results/parts/medal.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD. Dimension assertions cannot tell
// a medal from a washer.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let medalId;
let medalPcad;

const MM = 10; // MM_PER_UNIT

// The blank is variable-driven; the star is authored at a fixed size, because
// the formula grammar is + - * / ( ) over identifiers and a ten-point star
// needs sin/cos to place its tips.
const V = {
  MedalDia: 50,
  MedalThick: 4,
  RimBevel: 1.2,
  RibbonHoleDia: 5,
  LogoRaise: 1.0,
  TextRaise: 1.2,
};
const TEXT_HEIGHT_MM = 6;
const STAR_R = 1.0; // scene units

const setVars = () =>
  page.evaluate(
    (vv) =>
      window.__store.getState().setVariables(
        Object.entries(vv).map(([name, mm]) => ({
          name,
          formula: String(mm),
        })),
      ),
    V,
  );

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 240000 });

const bbox = (id) =>
  page.evaluate((n) => {
    const p = window.__store.getState().items.find((i) => i.id === n)
      .geometryData.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    return {
      w: +((hi[0] - lo[0]) * 10).toFixed(1),
      h: +((hi[1] - lo[1]) * 10).toFixed(1),
      d: +((hi[2] - lo[2]) * 10).toFixed(1),
    };
  }, id);

const tris = (id) =>
  page.evaluate(
    (n) =>
      (window.__store.getState().items.find((i) => i.id === n)?.geometryData
        ?.indices.length ?? 0) / 3,
    id,
  );

// Highest vertex in a RING of the face, in mm above the body's own base. A
// point probe is no good: the face is triangulated from the star's own tips and
// the rim, so most of it carries no vertices at all.
const heightInRing = (id, rLoMm, rHiMm) =>
  page.evaluate(
    ({ n, rLoMm, rHiMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let best = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        const r = Math.hypot(p[i], p[i + 2]) * 10;
        if (r < rLoMm || r > rHiMm) continue;
        best = Math.max(best, (p[i + 1] - base) * 10);
      }
      return Number.isFinite(best) ? +best.toFixed(2) : null;
    },
    { n: id, rLoMm, rHiMm },
  );

// Widest vertex sitting exactly at a given height above the base, in mm --
// how the bevel is measured (the face's rim pulls in, the mid-thickness
// waist does not).
const radiusAtHeight = (id, yMm, tolMm = 0.2) =>
  page.evaluate(
    ({ n, yMm, tolMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let r = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs((p[i + 1] - base) * 10 - yMm) > tolMm) continue;
        r = Math.max(r, Math.hypot(p[i], p[i + 2]) * 10);
      }
      return +r.toFixed(2);
    },
    { n: id, yMm, tolMm },
  );

test.describe.serial("medal", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
    await setVars();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the lathe spins a round blank from a constrained profile", async () => {
    test.setTimeout(360_000);
    await page.evaluate(() => {
      const s = window.__store.getState();
      // A rectangle spun about the Y axis: half the diameter wide, one
      // thickness tall. Shape 4 is the spin axis.
      const R = 2.5,
        T = 0.4;
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: R, y2: 0 }, // 0 underside
        { type: "line", x1: R, y1: 0, x2: R, y2: T }, // 1 rim
        { type: "line", x1: R, y1: T, x2: 0, y2: T }, // 2 face
        { type: "line", x1: 0, y1: T, x2: 0, y2: 0 }, // 3 axis side
        { type: "line", x1: 0, y1: -1, x2: 0, y2: T + 1 }, // 4 spin axis
      ];
      const C = [
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "horizontal", shapeIdx: 2 },
        { type: "vertical", shapeIdx: 3 },
        {
          type: "coincident",
          shapeAIdx: 0,
          pointA: "end",
          shapeBIdx: 1,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 1,
          pointA: "end",
          shapeBIdx: 2,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 2,
          pointA: "end",
          shapeBIdx: 3,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 3,
          pointA: "end",
          shapeBIdx: 0,
          pointB: "start",
        },
        // Pin the profile's inner edge ONTO the spin axis. Nothing else anchors
        // it in x, and a profile free to slide sideways spins to a different
        // radius than the variables say.
        { type: "colinear", shapeAIdx: 3, shapeBIdx: 4 },
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "MedalDia / 2",
        },
        {
          type: "distance",
          shapeAIdx: 1,
          pointA: "start",
          shapeBIdx: 1,
          pointB: "end",
          distance: "MedalThick",
        },
      ];
      s.addItem(
        {
          id: 200,
          type: "sketch",
          name: "Medal Section",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 }, // XY plane; +Y is the spin axis
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints: C,
        },
        "Added",
      );
      s.selectItem(200);
    });
    await setVars(); // solve the constraints
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 200);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      return { half: len(sk.shapes[0]), thick: len(sk.shapes[1]) };
    });
    expect(sec.half).toBeCloseTo(V.MedalDia / 2, 0);
    expect(sec.thick).toBeCloseTo(V.MedalThick, 0);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 200);
      const pts = sk.shapes.slice(0, 4).map((l) => ({ x: l.x1, y: l.y1 }));
      s.startSweepTool("revolve");
      s.setSweepProfile({
        sketchId: 200,
        profileCentroid: {
          x: pts.reduce((a, p) => a + p.x, 0) / 4,
          y: pts.reduce((a, p) => a + p.y, 0) / 4,
        },
        polygon2D: pts,
        holes: [],
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normalWorld: { x: 0, y: 0, z: 1 },
      });
      s.setSweepAxis({ sketchId: 200, shapeIdx: 4 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    medalId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(medalId).not.toBeNull();

    const b = await bbox(medalId);
    expect(b.w).toBeCloseTo(V.MedalDia, 0);
    expect(b.d).toBeCloseTo(b.w, 0); // round, not oval
    expect(b.h).toBeCloseTo(V.MedalThick, 0);
  });

  test("a star logo stands proud of the face", async () => {
    test.setTimeout(360_000);
    await page.evaluate((R) => {
      const s = window.__store.getState();
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 5;
        const r = i % 2 === 0 ? R : R * 0.42;
        pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      const shapes = pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return { type: "line", x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      });
      s.addItem(
        {
          id: 210,
          type: "sketch",
          name: "Star Logo",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // lying on the face
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints: [],
        },
        "Added",
      );
      // Extruded from the SAME base plane as the blank and one LogoRaise
      // taller, so it stands proud of the face whatever MedalThick becomes --
      // no repositioned sketch to keep in step.
      s.addItem(
        {
          id: 211,
          type: "extrude",
          name: "Star",
          children: [],
          parentId: null,
          profile: {
            type: "sketchLoop",
            sketchId: 210,
            textShapeIdx: null,
            profileCentroid: { x: 0, y: 0 },
            polygon2D: pts,
            holes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: -Math.PI / 2, y: 0, z: 0 },
            normalWorld: { x: 0, y: 1, z: 0 },
          },
          depth: "MedalThick + LogoRaise",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        "Added",
      );
    }, STAR_R);
    await settled();

    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.startBooleanTool("union");
      window.__store.setState({ selectedIds: [id, 211] });
    }, medalId);
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .items.find((i) => i.regenerator?.kind === "boolean")?.id ??
              null,
          ),
        { timeout: 120000 },
      )
      .not.toBe(null);
    await settled();
    // The union consumes both inputs into a NEW csg -- the medal from here on.
    medalId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.find((i) => i.regenerator?.kind === "boolean").id,
    );

    const b = await bbox(medalId);
    expect(b.w).toBeCloseTo(V.MedalDia, 0);
    // The star raised the overall height; the blank alone would be MedalThick.
    expect(b.h).toBeCloseTo(V.MedalThick + V.LogoRaise, 0);
    // ...and it is the CENTRE that is tall, not the rim: a star that failed to
    // fuse would leave the face flat and the height would come from elsewhere.
    expect(await heightInRing(medalId, 0, 11)).toBeCloseTo(
      V.MedalThick + V.LogoRaise,
      0,
    );
    expect(await heightInRing(medalId, 24, 26)).toBeCloseTo(V.MedalThick, 0);
  });

  test("the outside edge is bevelled top and bottom", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(medalId);
    const before = await bbox(medalId);
    // One point on each rim circle, in the mesh's LOCAL frame -- the frame a
    // real edge click records. The revolve made these true circles, so a
    // single point names the whole ring.
    const rim = await page.evaluate((id) => {
      const p = window.__store.getState().items.find((i) => i.id === id)
        .geometryData.positions;
      let lo = Infinity,
        hi = -Infinity,
        r = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.hypot(p[i], p[i + 2]) < 2.3) continue; // rim only
        r = Math.max(r, Math.hypot(p[i], p[i + 2]));
        lo = Math.min(lo, p[i + 1]);
        hi = Math.max(hi, p[i + 1]);
      }
      return { r, lo, hi };
    }, medalId);

    await page.evaluate(
      ({ id, rim }) => {
        const s = window.__store.getState();
        s.setSelectedSubGeometry({
          itemId: id,
          edges: [
            { ax: rim.r, ay: rim.hi, az: 0, bx: rim.r, by: rim.hi, bz: 0 },
            { ax: rim.r, ay: rim.lo, az: 0, bx: rim.r, by: rim.lo, bz: 0 },
          ],
          faces: [],
        });
        s.setChamferSelectMode("chamfer");
      },
      { id: medalId, rim },
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill(String(V.RimBevel));
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            medalId,
          ),
        { timeout: 300000 },
      )
      .toBe("chamfer");
    await settled();

    expect(await tris(medalId)).toBeGreaterThan(beforeTris);
    // The widest point is untouched -- that is the mid-thickness waist, which
    // no bevel reaches -- while BOTH faces have pulled in by the bevel.
    const after = await bbox(medalId);
    expect(after.w).toBeCloseTo(before.w, 0);
    const faceR = await radiusAtHeight(medalId, V.MedalThick);
    const backR = await radiusAtHeight(medalId, 0);
    for (const r of [faceR, backR]) {
      expect(r).toBeLessThan(V.MedalDia / 2 - V.RimBevel * 0.5);
      expect(r).toBeGreaterThan(V.MedalDia / 2 - V.RimBevel * 1.6);
    }
  });

  test("a bore takes the ribbon", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(medalId);
    // Near the rim but inside the bevel. The hole tool stores resolved numbers,
    // so unlike the rest of the medal this one does not track MedalDia.
    const holeZ = -(V.MedalDia / 2 - V.RibbonHoleDia) / MM;
    await page.evaluate(
      ({ id, z, dia, len }) => {
        const s = window.__store.getState();
        const p = s.items.find((i) => i.id === id).geometryData.positions;
        let top = -Infinity;
        for (let i = 1; i < p.length; i += 3) top = Math.max(top, p[i]);
        s.startHoleTool();
        s.setHoleFace(id, {
          normal: { x: 0, y: 1, z: 0 },
          point: { x: 0, y: top, z },
        });
        s.setHolePoint({ x: 0, y: top, z });
        s.updateHoleParams({ threaded: false, lengthMm: len, diameterMm: dia });
      },
      {
        id: medalId,
        z: holeZ,
        dia: V.RibbonHoleDia,
        len: V.MedalThick + V.LogoRaise + 2,
      },
    );
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Cut the hole").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            medalId,
          ),
        { timeout: 300000 },
      )
      .toBe("hole");
    await settled();

    expect(await tris(medalId)).toBeGreaterThan(beforeTris); // bore wall added
    // It went all the way THROUGH: the bore's mouth appears on BOTH faces, at
    // the right radius. (A cylinder is tessellated with vertices only at its
    // ends, so there is nothing to measure at mid-thickness.)
    const mouth = (yMm) =>
      page.evaluate(
        ({ id, z, yMm }) => {
          const p = window.__store.getState().items.find((i) => i.id === id)
            .geometryData.positions;
          let base = Infinity;
          for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
          let rMin = Infinity,
            n = 0;
          for (let i = 0; i < p.length; i += 3) {
            if (Math.abs((p[i + 1] - base) * 10 - yMm) > 0.3) continue;
            const d = Math.hypot(p[i], p[i + 2] - z) * 10;
            if (d > 6) continue; // around the bore only
            rMin = Math.min(rMin, d);
            n++;
          }
          return { n, rMin: Number.isFinite(rMin) ? +rMin.toFixed(2) : null };
        },
        { id: medalId, z: holeZ, yMm },
      );

    const top = await mouth(V.MedalThick);
    const bottom = await mouth(0);
    for (const m of [top, bottom]) {
      expect(m.n).toBeGreaterThan(8); // a real bore mouth, not a dimple
      expect(m.rMin).toBeCloseTo(V.RibbonHoleDia / 2, 0);
    }
  });

  test("the text is raised off the face", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(medalId);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem(
        {
          id: 220,
          type: "sketch",
          name: "Medal Text",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [],
          constraints: [],
        },
        "Added",
      );
      s.selectItem(220);
    });
    // Through the real Text dialog, so the glyph outlines come from the app's
    // own font handling rather than being faked here.
    await page.evaluate(
      (h) =>
        window.__store.getState().setTextDraft({
          x: 0,
          y: 0,
          text: "1ST",
          heightMm: h,
          font: "helvetiker",
        }),
      TEXT_HEIGHT_MM,
    );
    await expect(page.locator(".variables-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__store.getState().items.find((i) => i.id === 220).shapes
              .length,
        ),
      )
      .toBe(1);

    // Centre the word on its own anchor (a text shape is anchored top-left).
    await page.evaluate(() => {
      const s = window.__store.getState();
      const sh = s.items.find((i) => i.id === 220).shapes[0];
      s.updateSketchTextShape(220, 0, { ...sh, x: -sh.w / 2, y: sh.h / 2 });
    });

    await page.evaluate(
      ({ id, thick, raise }) => {
        const s = window.__store.getState();
        const sh = s.items.find((i) => i.id === 220).shapes[0];
        const p = s.items.find((i) => i.id === id).geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        // One profile per glyph outline, in the same shape a sketch-fill click
        // would hand the tool. The polygon is re-derived from the live sketch
        // per profile, matched on this centroid.
        const profiles = sh.contours.map((c) => {
          const poly = c.map((pt) => ({ x: pt.x + sh.x, y: pt.y + sh.y }));
          const cx = poly.reduce((a, q) => a + q.x, 0) / poly.length;
          const cy = poly.reduce((a, q) => a + q.y, 0) / poly.length;
          return {
            type: "sketchLoop",
            sketchId: 220,
            textShapeIdx: 0,
            profileCentroid: { x: cx, y: cy },
            polygon2D: poly,
            holes: [],
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: -Math.PI / 2, y: 0, z: 0 },
            normalWorld: { x: 0, y: 1, z: 0 },
          };
        });
        s.startEmbossTool();
        s.setEmbossProfiles(profiles);
        // On the flat face, below the star and clear of both the bevel and the
        // ribbon bore (which is on the opposite side).
        s.setEmbossFaceSelection({
          itemId: id,
          face: { nx: 0, ny: 1, nz: 0, cx: 0, cy: base + thick / 10, cz: 1.7 },
          faceSet: null,
          valid: true,
        });
        s.updateEmbossParams({
          deboss: false,
          projection: "center",
          distanceMm: raise,
        });
      },
      { id: medalId, thick: V.MedalThick, raise: V.TextRaise },
    );
    await page.waitForTimeout(1200); // debounced ghost settles
    await page.getByTitle("Stamp the relief").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            medalId,
          ),
        { timeout: 300000 },
      )
      .toBe("emboss");
    await settled();

    expect(await tris(medalId)).toBeGreaterThan(beforeTris);
    // Measure the relief itself: where it sits, how big it is, and which way
    // round it reads. A mirrored stamp passes every "something is raised here"
    // check, and this suite has already been fooled once by eyeballing a
    // rotated screenshot -- "1" is a far thinner glyph than "T", so counting
    // the raised vertices in the first and last quarter of the word settles it.
    const word = await page.evaluate(
      ({ id, thick, raise }) => {
        const p = window.__store.getState().items.find((i) => i.id === id)
          .geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        const pts = [];
        for (let i = 0; i < p.length; i += 3) {
          if ((p[i + 1] - base) * 10 < thick + raise * 0.5) continue; // proud
          if (Math.hypot(p[i], p[i + 2]) * 10 < 12) continue; // not the star
          pts.push([p[i] * 10, p[i + 2] * 10]);
        }
        const xs = pts.map((q) => q[0]);
        const zs = pts.map((q) => q[1]);
        const x0 = Math.min(...xs),
          x1 = Math.max(...xs);
        const q = (x1 - x0) / 4;
        return {
          n: pts.length,
          w: +(x1 - x0).toFixed(2),
          h: +(Math.max(...zs) - Math.min(...zs)).toFixed(2),
          cx: +((x0 + x1) / 2).toFixed(2),
          cz: +((Math.min(...zs) + Math.max(...zs)) / 2).toFixed(2),
          // Where the ink sits within its own bounding box. Mirroring flips
          // the sign of this; tessellation does not.
          skew: +(
            (xs.reduce((a, x) => a + x, 0) / xs.length - (x0 + x1) / 2) /
            (x1 - x0)
          ).toFixed(4),
        };
      },
      { id: medalId, thick: V.MedalThick, raise: V.TextRaise },
    );
    expect(word.n).toBeGreaterThan(50);
    expect(word.h).toBeGreaterThan(TEXT_HEIGHT_MM * 0.6); // as tall as the text
    expect(word.h).toBeLessThan(TEXT_HEIGHT_MM * 1.4);
    expect(word.w).toBeGreaterThan(TEXT_HEIGHT_MM); // the whole word, not a glyph
    expect(Math.abs(word.cx)).toBeLessThan(2); // centred across the medal
    expect(word.cz).toBeGreaterThan(12); // clear of the star, on the flat face
    const inkSkew = await page.evaluate(() => {
      const sh = window.__store.getState().items.find((i) => i.id === 220)
        .shapes[0];
      const xs = sh.contours.flat().map((p) => p.x + sh.x);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs);
      return +(
        (xs.reduce((a, x) => a + x, 0) / xs.length - (x0 + x1) / 2) /
        (x1 - x0)
      ).toFixed(4);
    });
    // Same sign and size as the sketch's own ink: a mirrored stamp would flip
    // it, and nothing else about the relief would look wrong.
    expect(Math.abs(inkSkew)).toBeGreaterThan(0.02); // the check has teeth
    expect(word.skew).toBeCloseTo(inkSkew, 2);
    // It stands PROUD, in the band where the text was placed -- and the star
    // is still the tallest thing on the medal.
    expect(await heightInRing(medalId, 13, 21)).toBeCloseTo(
      V.MedalThick + V.TextRaise,
      0,
    );
    expect(await heightInRing(medalId, 0, 11)).toBeCloseTo(
      V.MedalThick + V.LogoRaise,
      0,
    );
  });

  test("the finished medal saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "medal");
    expect(steps).toBeGreaterThan(4);
    medalPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, medalPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
    // The relief has to come back too. Loading REPLAYS the timeline, so this is
    // what catches an emboss stamped onto a body that a later step supersedes:
    // live it looks right, reopened the text is simply gone.
    const raised = await page.evaluate(
      ({ thick, raise }) => {
        const s = window.__store.getState();
        const it = s.items
          .filter((i) => i.type === "csg" && i.geometryData)
          .pop();
        const p = it.geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        let n = 0;
        for (let i = 0; i < p.length; i += 3) {
          if ((p[i + 1] - base) * 10 < thick + raise * 0.5) continue;
          if (Math.hypot(p[i], p[i + 2]) * 10 < 12) continue; // not the star
          n++;
        }
        return n;
      },
      { thick: V.MedalThick, raise: V.TextRaise },
    );
    expect(raised).toBeGreaterThan(50);
  });
});
