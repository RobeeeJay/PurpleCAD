// A chess king: a silhouette spun on the lathe whose flare and bell are BEZIER
// curves, and a cross standing on its crown.
//
// The straight runs carry real dimensions -- base diameter and height, the
// stem, the collar, the neck, the total height, and the radii at the waist and
// the crown. The curves join those dimensioned points.
//
// The solver treats a bezier as FIXED (sketchSolver.js: "bezier & unknowns:
// treated as fixed"), so a curve's control points cannot be driven by a
// constraint. They are authored from the same variables as the dimensions, so
// the curve meets the dimensioned points it joins; what the solver enforces is
// everything either side of them.
//
// Ends by saving test-results/parts/king.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD. Dimension assertions cannot tell
// a king from a fence post.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let kingId;
let kingPcad;

const V = {
  TotalHeight: 88, // foot to the top of the head, before the cross
  BaseDia: 44,
  BaseHeight: 10,
  StemDia: 16,
  StemHeight: 24,
  CrownDia: 32,
  CollarHeight: 8,
  NeckDia: 14,
};

// The cross: bars rather than dimensions on the sketch, since it is not part of
// the spun profile.
const CROSS = { thick: 6, height: 22, arm: 20, armY: 13 };

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

const worldBox = (id) =>
  page.evaluate((n) => {
    const it = window.__store.getState().items.find((i) => i.id === n);
    const p = it.geometryData.positions;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    return {
      axisX: it.position.x + (lo[0] + hi[0]) / 2,
      axisZ: it.position.z + (lo[2] + hi[2]) / 2,
      minY: it.position.y + lo[1],
      maxY: it.position.y + hi[1],
    };
  }, id);

// Widest vertex in a HEIGHT RANGE, in mm across the axis.
const widthBetween = (id, yLoMm, yHiMm) =>
  page.evaluate(
    ({ n, yLoMm, yHiMm }) => {
      const it = window.__store.getState().items.find((i) => i.id === n);
      const p = it.geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let loX = 1e9,
        hiX = -1e9;
      for (let i = 0; i < p.length; i += 3) {
        loX = Math.min(loX, p[i]);
        hiX = Math.max(hiX, p[i]);
      }
      const cx = (loX + hiX) / 2;
      let best = 0;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - base) * 10;
        if (y < yLoMm || y > yHiMm) continue;
        best = Math.max(best, Math.abs(p[i] - cx) * 10);
      }
      return +(best * 2).toFixed(2);
    },
    { n: id, yLoMm, yHiMm },
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
  // Selection is captured by an effect, so confirming before the dialog reports
  // every object would fuse whatever set it had by then.
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

test.describe.serial("king", () => {
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

  test("the lathe spins a bezier silhouette from its dimensions", async () => {
    test.setTimeout(360_000);
    await page.evaluate((v) => {
      const s = window.__store.getState();
      const u = (mm) => mm / 10; // scene units
      const rBase = u(v.BaseDia / 2),
        hBase = u(v.BaseHeight),
        rStem = u(v.StemDia / 2),
        hStem = u(v.StemHeight),
        rCrown = u(v.CrownDia / 2),
        hCollar = u(v.CollarHeight),
        rNeck = u(v.NeckDia / 2),
        hTop = u(v.TotalHeight);
      // Where the curves meet the straight runs. Derived from the dimensions so
      // the authored curve lands exactly on the points the constraints hold.
      const yStemBot = hBase + u(24); // top of the flare
      const yStemTop = yStemBot + hStem;
      const yCrown = yStemTop + u(16); // top of the bell
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: rBase, y2: 0 }, // 0 foot
        { type: "line", x1: rBase, y1: 0, x2: rBase, y2: hBase }, // 1 base side
        {
          // 2 the flare: base out to the waist
          type: "bezier",
          p0: { x: rBase, y: hBase },
          p1: { x: rBase, y: hBase + u(10) },
          p2: { x: rStem + u(2), y: yStemBot },
          p3: { x: rStem, y: yStemBot },
        },
        { type: "line", x1: rStem, y1: yStemBot, x2: rStem, y2: yStemTop }, // 3 stem
        {
          // 4 the bell: waist out to the crown
          type: "bezier",
          p0: { x: rStem, y: yStemTop },
          p1: { x: rStem, y: yStemTop + u(8) },
          p2: { x: rCrown - u(4), y: yCrown },
          p3: { x: rCrown, y: yCrown },
        },
        {
          type: "line",
          x1: rCrown,
          y1: yCrown,
          x2: rCrown,
          y2: yCrown + hCollar,
        }, // 5 collar
        { type: "line", x1: rCrown, y1: yCrown + hCollar, x2: rNeck, y2: hTop }, // 6 taper
        { type: "line", x1: rNeck, y1: hTop, x2: 0, y2: hTop }, // 7 head top
        { type: "line", x1: 0, y1: hTop, x2: 0, y2: 0 }, // 8 axis side
        { type: "line", x1: 0, y1: -1, x2: 0, y2: hTop + 1 }, // 9 spin axis
      ];
      // Chain: lines meet by their ends, a bezier by p0/p3.
      const link = (a, ka, b, kb) => ({
        type: "coincident",
        shapeAIdx: a,
        pointA: ka,
        shapeBIdx: b,
        pointB: kb,
      });
      const C = [
        link(0, "end", 1, "start"),
        link(1, "end", 2, "p0"),
        link(2, "p3", 3, "start"),
        link(3, "end", 4, "p0"),
        link(4, "p3", 5, "start"),
        link(5, "end", 6, "start"),
        link(6, "end", 7, "start"),
        link(7, "end", 8, "start"),
        link(8, "end", 0, "start"),
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "vertical", shapeIdx: 3 },
        { type: "vertical", shapeIdx: 5 },
        { type: "horizontal", shapeIdx: 7 },
        { type: "vertical", shapeIdx: 8 },
        // Pin the profile's inner edge ONTO the spin axis: nothing else anchors
        // it in x, and a profile free to slide sideways spins to a different
        // radius than the dimensions say.
        { type: "colinear", shapeAIdx: 8, shapeBIdx: 9 },
        ...[
          [0, "BaseDia / 2"],
          [1, "BaseHeight"],
          [3, "StemHeight"],
          [5, "CollarHeight"],
          [7, "NeckDia / 2"],
          [8, "TotalHeight"],
        ].map(([idx, distance]) => ({
          type: "distance",
          shapeAIdx: idx,
          pointA: "start",
          shapeBIdx: idx,
          pointB: "end",
          distance,
        })),
        // The two radii the curves run between.
        {
          type: "pointLineDistance",
          pointShapeIdx: 3,
          pointKey: "start",
          lineShapeIdx: 9,
          distance: "StemDia / 2",
        },
        {
          type: "pointLineDistance",
          pointShapeIdx: 5,
          pointKey: "start",
          lineShapeIdx: 9,
          distance: "CrownDia / 2",
        },
      ];
      s.addItem(
        {
          id: 600,
          type: "sketch",
          name: "King Profile",
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
      s.selectItem(600);
    }, V);
    await setVars(); // solve
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 600);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      const axisX = sk.shapes[8].x1;
      return {
        curves: sk.shapes.filter((sh) => sh.type === "bezier").length,
        baseR: len(sk.shapes[0]),
        baseH: len(sk.shapes[1]),
        stem: len(sk.shapes[3]),
        collar: len(sk.shapes[5]),
        neckR: len(sk.shapes[7]),
        total: len(sk.shapes[8]),
        stemR: +((sk.shapes[3].x1 - axisX) * 10).toFixed(1),
        crownR: +((sk.shapes[5].x1 - axisX) * 10).toFixed(1),
        // The curves have to still MEET the runs they join after the solve.
        flareGap: +(
          Math.hypot(
            sk.shapes[2].p3.x - sk.shapes[3].x1,
            sk.shapes[2].p3.y - sk.shapes[3].y1,
          ) * 10
        ).toFixed(2),
        bellGap: +(
          Math.hypot(
            sk.shapes[4].p3.x - sk.shapes[5].x1,
            sk.shapes[4].p3.y - sk.shapes[5].y1,
          ) * 10
        ).toFixed(2),
      };
    });
    expect(sec.curves).toBe(2); // the flare and the bell
    expect(sec.baseR).toBeCloseTo(V.BaseDia / 2, 0);
    expect(sec.baseH).toBeCloseTo(V.BaseHeight, 0);
    expect(sec.stem).toBeCloseTo(V.StemHeight, 0);
    expect(sec.collar).toBeCloseTo(V.CollarHeight, 0);
    expect(sec.neckR).toBeCloseTo(V.NeckDia / 2, 0);
    expect(sec.total).toBeCloseTo(V.TotalHeight, 0);
    expect(sec.stemR).toBeCloseTo(V.StemDia / 2, 0);
    expect(sec.crownR).toBeCloseTo(V.CrownDia / 2, 0);
    // A gap here would mean the solver moved a run away from the curve it joins
    // -- the loop would not close and the revolve would have nothing to spin.
    expect(sec.flareGap).toBeLessThan(0.2);
    expect(sec.bellGap).toBeLessThan(0.2);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 600);
      // Sample the loop, curves included, into the polygon the revolve spins.
      // Re-derived from the sketch on every regen, so this seed only has to
      // identify the right loop.
      const pts = [];
      for (const sh of sk.shapes.slice(0, 9)) {
        if (sh.type === "line") pts.push({ x: sh.x1, y: sh.y1 });
        else
          for (let i = 0; i < 24; i++) {
            const t = i / 24,
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
      s.startSweepTool("revolve");
      s.setSweepProfile({
        sketchId: 600,
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
      s.setSweepAxis({ sketchId: 600, shapeIdx: 9 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    kingId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(kingId).not.toBeNull();

    const b = await bbox(kingId);
    expect(b.h).toBeCloseTo(V.TotalHeight, -1);
    expect(b.w).toBeCloseTo(V.BaseDia, -1);
    expect(b.d).toBeCloseTo(b.w, -1); // round about the axis
    // Wide foot, narrow waist, crown flaring back out.
    expect(await widthBetween(kingId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
    const waist = await widthBetween(
      kingId,
      V.BaseHeight + 24,
      V.BaseHeight + 24 + V.StemHeight,
    );
    expect(waist).toBeCloseTo(V.StemDia, -1);
    expect(waist).toBeLessThan(V.CrownDia);

    // The flare is CURVED, not a straight taper: halfway up it stands proud of
    // the straight line between the two ends it joins. A bezier that had been
    // flattened into its chord would sit on that line.
    const flareTopY = V.BaseHeight + 24;
    const midY = (V.BaseHeight + flareTopY) / 2;
    const onChord =
      (V.BaseDia / 2 +
        (V.StemDia / 2 - V.BaseDia / 2) *
          ((midY - V.BaseHeight) / (flareTopY - V.BaseHeight))) *
      2;
    const actual = await widthBetween(kingId, midY - 1, midY + 1);
    expect(
      actual,
      `flare at ${midY}mm measured ${actual}, chord would be ${onChord.toFixed(1)}`,
    ).toBeGreaterThan(onChord + 2);
  });

  test("a cross stands on the crown", async () => {
    test.setTimeout(360_000);
    const before = await bbox(kingId);
    const body = await worldBox(kingId);
    await page.evaluate(
      ({ body, cross }) => {
        const s = window.__store.getState();
        const u = (mm) => mm / 10;
        // Two bars: the upright sunk into the head so it fuses, and the arm
        // across it. A cross reads in one plane, so the arm runs along X only.
        s.addItem({
          id: 610,
          name: "Cross Upright",
          type: "cube",
          children: [],
          parentId: null,
          position: {
            x: body.axisX,
            y: body.maxY + u(cross.height / 2 - 3),
            z: body.axisZ,
          },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: {
            width: u(cross.thick),
            height: u(cross.height),
            depth: u(cross.thick),
          },
        });
        s.addItem({
          id: 611,
          name: "Cross Arm",
          type: "cube",
          children: [],
          parentId: null,
          position: {
            x: body.axisX,
            y: body.maxY + u(cross.armY),
            z: body.axisZ,
          },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: {
            width: u(cross.arm),
            height: u(cross.thick),
            depth: u(cross.thick),
          },
        });
      },
      { body, cross: CROSS },
    );
    await settled();

    kingId = await unionOf(kingId, 610, 611);

    const after = await bbox(kingId);
    // The cross stands above the head.
    expect(after.h).toBeGreaterThan(before.h + CROSS.height / 2);
    // It IS a cross: at the arm's height the body reaches out sideways to the
    // arm, and front-to-back only as far as the bar is thick.
    // Measured over the bar's full thickness: a box carries vertices only at
    // its corners, so a thin slice through the middle of one is empty.
    const armY = V.TotalHeight + CROSS.armY;
    // The bar's corners sit exactly on the band's edges, and positions are
    // float32: both can round a hair outside it and leave nothing to measure
    // (it did, once the normal resolution went to 0.05 mm and moved the head
    // by a hundred-thousandth of a millimetre).  A tenth of a millimetre of
    // margin keeps them in.
    const armLo = armY - CROSS.thick / 2 - 0.1;
    const armHi = armY + CROSS.thick / 2 + 0.1;
    const across = await widthBetween(kingId, armLo, armHi);
    // Where the union actually has material above the head, for when the arm
    // isn't found: each height (mm above the base) with its widest reach.
    const above = await page.evaluate(
      ({ n, from }) => {
        const it = window.__store.getState().items.find((i) => i.id === n);
        const p = it.geometryData.positions;
        let base = Infinity;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          base = Math.min(base, p[i + 1]);
          lo = Math.min(lo, p[i]);
          hi = Math.max(hi, p[i]);
        }
        const cx = (lo + hi) / 2;
        const at = new Map();
        for (let i = 0; i < p.length; i += 3) {
          const y = Math.round((p[i + 1] - base) * 100) / 10;
          if (y < from) continue;
          at.set(y, Math.max(at.get(y) ?? 0, Math.abs(p[i] - cx) * 20));
        }
        return [...at]
          .sort((a, b) => a[0] - b[0])
          .map(([y, w]) => `${y}:${w.toFixed(1)}`)
          .join(" ");
      },
      { n: kingId, from: V.TotalHeight - 5 },
    );
    expect(
      across,
      `arm band ${armLo}..${armHi} mm; heights (mm above base) : width -- ${above}`,
    ).toBeCloseTo(CROSS.arm, -1);
    const depth = await page.evaluate(
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
          lo = Math.min(lo, p[i + 2] * 10);
          hi = Math.max(hi, p[i + 2] * 10);
        }
        return +(hi - lo).toFixed(2);
      },
      { id: kingId, yLo: armLo, yHi: armHi },
    );
    expect(
      depth,
      `cross arm is ${across}mm across and ${depth}mm deep`,
    ).toBeCloseTo(CROSS.thick, -1);
    expect(across).toBeGreaterThan(depth * 2); // an arm, not a block
  });

  test("the finished king saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "king");
    expect(steps).toBeGreaterThan(3);
    kingPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, kingPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
  });
});
