// A chess knight: a spun base with a horse's head standing on it.
//
// The head is the reason this piece is not like the others -- it has no axis of
// revolution, so it is EXTRUDED from a side profile, the way a knight is
// actually carved. Its silhouette is authored from the dimensions (the muzzle
// and the ear need a shape, not a radius), while the base is spun from
// constrained dimensions like the king and queen, and the head's width is the
// extrude depth, which IS a dimension.
//
// Ends by saving test-results/parts/knight.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD. Dimension assertions cannot tell
// a horse from a doorstop.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let knightId;
let knightPcad;

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

const box = (id) =>
  page.evaluate((n) => {
    const it = window.__store.getState().items.find((i) => i.id === n);
    if (!it?.geometryData?.positions?.length) return null;
    const p = it.geometryData.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    const o = [it.position.x, it.position.y, it.position.z];
    return {
      w: +((hi[0] - lo[0]) * 10).toFixed(1),
      h: +((hi[1] - lo[1]) * 10).toFixed(1),
      d: +((hi[2] - lo[2]) * 10).toFixed(1),
      loY: +((lo[1] + o[1]) * 10).toFixed(1),
      hiY: +((hi[1] + o[1]) * 10).toFixed(1),
      midX: +(((lo[0] + hi[0]) / 2 + o[0]) * 10).toFixed(1),
      midZ: +(((lo[2] + hi[2]) / 2 + o[2]) * 10).toFixed(1),
    };
  }, id);

// Extent along one axis, in mm, for the material in a height band -- how the
// tests tell the round base from the flat head.
const spanBetween = (id, axis, yLoMm, yHiMm) =>
  page.evaluate(
    ({ n, axis, yLoMm, yHiMm }) => {
      const it = window.__store.getState().items.find((i) => i.id === n);
      const p = it.geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      const k = axis === "x" ? 0 : 2;
      let lo = 1e9,
        hi = -1e9;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - base) * 10;
        if (y < yLoMm || y > yHiMm) continue;
        lo = Math.min(lo, p[i + k]);
        hi = Math.max(hi, p[i + k]);
      }
      return hi < lo ? null : +((hi - lo) * 10).toFixed(1);
    },
    { n: id, axis, yLoMm, yHiMm },
  );

const unionOf = async (...ids) => {
  const seen = await page.evaluate(() =>
    window.__store.getState().items.map((i) => i.id),
  );
  await page.evaluate((sel) => {
    window.__store.getState().startBooleanTool("union");
    window.__store.setState({ selectedIds: sel });
  }, ids);
  const bar = page.locator(".sketch-distance-input-overlay");
  await expect(bar).toBeVisible();
  await expect(
    bar.locator("button", { hasText: new RegExp(`${ids.length} objects`) }),
  ).toBeVisible();
  await page.getByTitle("Apply Union").click();
  const found = () =>
    page.evaluate(
      (s) =>
        window.__store
          .getState()
          .items.find(
            (i) =>
              !s.includes(i.id) &&
              i.type === "csg" &&
              i.geometryData?.positions?.length,
          )?.id ?? null,
      seen,
    );
  await expect.poll(found, { timeout: 300000 }).not.toBe(null);
  await settled();
  return await found();
};

test.describe.serial("knight", () => {
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

  test("the lathe spins the base the head will stand on", async () => {
    test.setTimeout(360_000);
    await page.evaluate((v) => {
      const s = window.__store.getState();
      const u = (mm) => mm / 10;
      const rBase = u(v.BaseDia / 2),
        hBase = u(v.BaseHeight),
        rCollar = u(v.CollarDia / 2),
        yTop = u(v.CollarTop);
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: rBase, y2: 0 }, // 0 foot
        { type: "line", x1: rBase, y1: 0, x2: rBase, y2: hBase }, // 1 base side
        { type: "line", x1: rBase, y1: hBase, x2: rCollar, y2: yTop - u(6) }, // 2 taper
        { type: "line", x1: rCollar, y1: yTop - u(6), x2: rCollar, y2: yTop }, // 3 collar
        { type: "line", x1: rCollar, y1: yTop, x2: 0, y2: yTop }, // 4 collar top
        { type: "line", x1: 0, y1: yTop, x2: 0, y2: 0 }, // 5 axis side
        { type: "line", x1: 0, y1: -1, x2: 0, y2: yTop + 1 }, // 6 spin axis
      ];
      const link = (a, b) => ({
        type: "coincident",
        shapeAIdx: a,
        pointA: "end",
        shapeBIdx: b,
        pointB: "start",
      });
      const C = [
        link(0, 1),
        link(1, 2),
        link(2, 3),
        link(3, 4),
        link(4, 5),
        link(5, 0),
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "vertical", shapeIdx: 3 },
        { type: "horizontal", shapeIdx: 4 },
        { type: "vertical", shapeIdx: 5 },
        // Pin the profile's inner edge ONTO the spin axis, or it spins to a
        // different radius than the dimensions say.
        { type: "colinear", shapeAIdx: 5, shapeBIdx: 6 },
        ...[
          [0, "BaseDia / 2"],
          [1, "BaseHeight"],
          [4, "CollarDia / 2"],
          [5, "CollarTop"],
        ].map(([idx, distance]) => ({
          type: "distance",
          shapeAIdx: idx,
          pointA: "start",
          shapeBIdx: idx,
          pointB: "end",
          distance,
        })),
      ];
      s.addItem(
        {
          id: 700,
          type: "sketch",
          name: "Knight Base",
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
      s.selectItem(700);
    }, V);
    await setVars(); // solve
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 700);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      return {
        baseR: len(sk.shapes[0]),
        baseH: len(sk.shapes[1]),
        collarR: len(sk.shapes[4]),
        top: len(sk.shapes[5]),
      };
    });
    expect(sec.baseR).toBeCloseTo(V.BaseDia / 2, 0);
    expect(sec.baseH).toBeCloseTo(V.BaseHeight, 0);
    expect(sec.collarR).toBeCloseTo(V.CollarDia / 2, 0);
    expect(sec.top).toBeCloseTo(V.CollarTop, 0);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 700);
      const pts = sk.shapes.slice(0, 6).map((l) => ({ x: l.x1, y: l.y1 }));
      s.startSweepTool("revolve");
      s.setSweepProfile({
        sketchId: 700,
        profileCentroid: {
          x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
          y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
        },
        polygon2D: pts,
        holes: [],
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        normalWorld: { x: 0, y: 0, z: 1 },
      });
      s.setSweepAxis({ sketchId: 700, shapeIdx: 6 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    knightId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(knightId).not.toBeNull();

    const b = await box(knightId);
    expect(b.h).toBeCloseTo(V.CollarTop, -1);
    expect(b.w).toBeCloseTo(V.BaseDia, -1);
    expect(b.d).toBeCloseTo(b.w, -1); // round, so far
  });

  test("the head is extruded from a side profile, not spun", async () => {
    test.setTimeout(360_000);
    const baseBox = await box(knightId);
    await page.evaluate(
      ({ v, baseTopY }) => {
        const s = window.__store.getState();
        const u = (mm) => mm / 10;
        // A horse's head in side view, sized off the dimensions. Every point
        // is a fraction of the head's height, so the shape scales with the
        // piece: muzzle out front, mouth and chin under it, jaw sweeping back
        // to the throat, and two ears with a notch between them.
        //
        // The first attempt used a handful of points and came out a fin -- one
        // blunt wedge for a muzzle and a single spike for an ear. A horse needs
        // the features spelled out.
        const y0 = baseTopY;
        const H = v.TotalHeight - v.CollarTop; // head height above the collar
        const P = (fx, fy) => ({ x: u(fx * H), y: u(y0 + fy * H) });
        const backBottom = P(-0.2, 0),
          maneTop = P(-0.22, 0.63),
          behindEars = P(-0.12, 0.76),
          backEar = P(-0.17, 0.96),
          earNotch = P(-0.06, 0.78),
          frontEar = P(0.01, 1.0),
          forehead = P(0.07, 0.78),
          brow = P(0.15, 0.7),
          noseTop = P(0.4, 0.52),
          noseTip = P(0.45, 0.42),
          mouth = P(0.34, 0.35),
          chin = P(0.21, 0.4),
          throat = P(0.04, 0.14),
          frontBottom = P(-0.04, 0);
        const shapes = [
          // Back of the neck and the mane, curving up from the collar.
          {
            type: "bezier",
            p0: backBottom,
            p1: P(-0.3, 0.3),
            p2: P(-0.27, 0.5),
            p3: maneTop,
          },
          {
            type: "line",
            x1: maneTop.x,
            y1: maneTop.y,
            x2: behindEars.x,
            y2: behindEars.y,
          },
          // The ears: back one, notch, front one.
          {
            type: "line",
            x1: behindEars.x,
            y1: behindEars.y,
            x2: backEar.x,
            y2: backEar.y,
          },
          {
            type: "line",
            x1: backEar.x,
            y1: backEar.y,
            x2: earNotch.x,
            y2: earNotch.y,
          },
          {
            type: "line",
            x1: earNotch.x,
            y1: earNotch.y,
            x2: frontEar.x,
            y2: frontEar.y,
          },
          {
            type: "line",
            x1: frontEar.x,
            y1: frontEar.y,
            x2: forehead.x,
            y2: forehead.y,
          },
          {
            type: "line",
            x1: forehead.x,
            y1: forehead.y,
            x2: brow.x,
            y2: brow.y,
          },
          // Brow down the nose bridge to the tip of the muzzle.
          {
            type: "bezier",
            p0: brow,
            p1: P(0.26, 0.66),
            p2: P(0.37, 0.6),
            p3: noseTop,
          },
          {
            type: "line",
            x1: noseTop.x,
            y1: noseTop.y,
            x2: noseTip.x,
            y2: noseTip.y,
          },
          {
            type: "line",
            x1: noseTip.x,
            y1: noseTip.y,
            x2: mouth.x,
            y2: mouth.y,
          },
          { type: "line", x1: mouth.x, y1: mouth.y, x2: chin.x, y2: chin.y },
          // Jaw and throat, back down to the collar.
          {
            type: "bezier",
            p0: chin,
            p1: P(0.13, 0.3),
            p2: P(0.08, 0.24),
            p3: throat,
          },
          {
            type: "line",
            x1: throat.x,
            y1: throat.y,
            x2: frontBottom.x,
            y2: frontBottom.y,
          },
          {
            type: "line",
            x1: frontBottom.x,
            y1: frontBottom.y,
            x2: backBottom.x,
            y2: backBottom.y,
          },
        ];
        s.addItem(
          {
            id: 710,
            type: "sketch",
            name: "Knight Head",
            children: [],
            parentId: null,
            // Set back half the head's width so the extrude straddles the axis.
            position: { x: 0, y: 0, z: -u(v.HeadWidth / 2) },
            rotation: { x: 0, y: 0, z: 0 }, // XY plane, extruding along +Z
            scale: { x: 1, y: 1, z: 1 },
            shapes,
            constraints: [],
          },
          "Added",
        );
        // Sample the silhouette for the extrude's seed polygon; it is re-derived
        // from the sketch on every regen, so this only has to name the loop.
        const pts = [];
        for (const sh of shapes) {
          if (sh.type === "line") pts.push({ x: sh.x1, y: sh.y1 });
          else
            for (let i = 0; i < 16; i++) {
              const t = i / 16,
                m = 1 - t;
              pts.push({
                x:
                  m * m * m * sh.p0.x +
                  3 * m * m * t * sh.p1.x +
                  3 * m * t * t * sh.p2.x +
                  t * t * t * sh.p3.x,
                y:
                  m * m * m * sh.p0.y +
                  3 * m * m * t * sh.p1.y +
                  3 * m * t * t * sh.p2.y +
                  t * t * t * sh.p3.y,
              });
            }
        }
        s.addItem(
          {
            id: 711,
            type: "extrude",
            name: "Head",
            children: [],
            parentId: null,
            profile: {
              type: "sketchLoop",
              sketchId: 710,
              textShapeIdx: null,
              profileCentroid: {
                x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
                y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
              },
              polygon2D: pts,
              holes: [],
              position: { x: 0, y: 0, z: -u(v.HeadWidth / 2) },
              rotation: { x: 0, y: 0, z: 0 },
              normalWorld: { x: 0, y: 0, z: 1 },
            },
            // The head's width is a dimension like any other.
            depth: "HeadWidth",
            position: { x: 0, y: 0, z: -u(v.HeadWidth / 2) },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          "Added",
        );
      },
      { v: V, baseTopY: V.CollarTop - 4 }, // sunk into the collar so it fuses
    );
    await settled();

    knightId = await unionOf(knightId, 711);

    const b = await box(knightId);
    expect(b.h).toBeCloseTo(V.TotalHeight, -1);
    // The head is FLAT: across the piece it is the extrude's depth, while
    // front-to-back it reaches much further. A spun head would measure the same
    // both ways, which is exactly what the other pieces do.
    const headLo = V.CollarTop + 6;
    const headHi = V.TotalHeight - 2;
    const acrossHead = await spanBetween(knightId, "z", headLo, headHi);
    const alongHead = await spanBetween(knightId, "x", headLo, headHi);
    expect(acrossHead).toBeCloseTo(V.HeadWidth, -1);
    expect(
      alongHead,
      `head is ${alongHead}mm front-to-back and ${acrossHead}mm across`,
    ).toBeGreaterThan(acrossHead * 1.5);
    // ...and it FACES one way: the muzzle overhangs the axis the base is spun
    // about, so the head's middle sits forward of it.
    const headMid = await page.evaluate(
      ({ id, yLo, yHi }) => {
        const it = window.__store.getState().items.find((i) => i.id === id);
        const p = it.geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        let lo = 1e9,
          hi = -1e9;
        for (let i = 0; i < p.length; i += 3) {
          const y = (p[i + 1] - base) * 10;
          if (y < yLo || y > yHi) continue;
          lo = Math.min(lo, p[i]);
          hi = Math.max(hi, p[i]);
        }
        return +(((lo + hi) / 2) * 10).toFixed(1);
      },
      { id: knightId, yLo: headLo, yHi: headHi },
    );
    const baseMid = baseBox.midX;
    expect(
      headMid,
      `head centred at ${headMid}mm against a base at ${baseMid}mm`,
    ).toBeGreaterThan(baseMid + 2);
  });

  test("the finished knight saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "knight");
    expect(steps).toBeGreaterThan(3);
    knightPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, knightPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
  });
});
