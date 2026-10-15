// A chess rook: a tower spun from a bezier profile, with battlements cut round
// its top by a circular pattern of cutters, and its rims bevelled.
//
// The straight runs carry the dimensions; the curves join them. The solver
// treats a bezier as FIXED (sketchSolver.js: "bezier & unknowns: treated as
// fixed"), so the control points are authored from the same variables and the
// test checks the curves still MEET the dimensioned runs after solving.
//
// Ends by saving test-results/parts/rook.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let rookId;
let rookPcad;

const V = {
  TotalHeight: 66,
  BaseDia: 42,
  BaseHeight: 9,
  WaistDia: 26,
  WaistY: 30, // height of the narrowest point
  TopDia: 38,
  BandHeight: 12, // the straight band the battlements are cut into
};
const CRENELS = 5;
const CRENEL_W = 9; // how wide each gap is
const RIM_BEVEL = 1.5;

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

const tris = (id) =>
  page.evaluate(
    (n) =>
      (window.__store.getState().items.find((i) => i.id === n)?.geometryData
        ?.indices.length ?? 0) / 3,
    id,
  );

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

test.describe.serial("rook", () => {
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

  test("the lathe spins a bezier tower from its dimensions", async () => {
    test.setTimeout(360_000);
    await page.evaluate((v) => {
      const s = window.__store.getState();
      const u = (mm) => mm / 10;
      const rBase = u(v.BaseDia / 2),
        hBase = u(v.BaseHeight),
        rWaist = u(v.WaistDia / 2),
        yWaist = u(v.WaistY),
        rTop = u(v.TopDia / 2),
        yBand = u(v.TotalHeight - v.BandHeight),
        yTop = u(v.TotalHeight);
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: rBase, y2: 0 }, // 0 foot
        { type: "line", x1: rBase, y1: 0, x2: rBase, y2: hBase }, // 1 base side
        {
          // 2 base sweeping in to the waist
          type: "bezier",
          p0: { x: rBase, y: hBase },
          p1: { x: rBase, y: hBase + u(6) },
          p2: { x: rWaist + u(3), y: yWaist },
          p3: { x: rWaist, y: yWaist },
        },
        {
          // 3 waist flaring out under the battlements
          type: "bezier",
          p0: { x: rWaist, y: yWaist },
          p1: { x: rWaist, y: yWaist + u(8) },
          p2: { x: rTop - u(3), y: yBand },
          p3: { x: rTop, y: yBand },
        },
        { type: "line", x1: rTop, y1: yBand, x2: rTop, y2: yTop }, // 4 band
        { type: "line", x1: rTop, y1: yTop, x2: 0, y2: yTop }, // 5 top face
        { type: "line", x1: 0, y1: yTop, x2: 0, y2: 0 }, // 6 axis side
        { type: "line", x1: 0, y1: -1, x2: 0, y2: yTop + 1 }, // 7 spin axis
      ];
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
        link(2, "p3", 3, "p0"),
        link(3, "p3", 4, "start"),
        link(4, "end", 5, "start"),
        link(5, "end", 6, "start"),
        link(6, "end", 0, "start"),
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "vertical", shapeIdx: 4 },
        { type: "horizontal", shapeIdx: 5 },
        { type: "vertical", shapeIdx: 6 },
        // Pin the profile's inner edge ONTO the spin axis, or it spins to a
        // different radius than the dimensions say.
        { type: "colinear", shapeAIdx: 6, shapeBIdx: 7 },
        ...[
          [0, "BaseDia / 2"],
          [1, "BaseHeight"],
          [4, "BandHeight"],
          [5, "TopDia / 2"],
          [6, "TotalHeight"],
        ].map(([idx, distance]) => ({
          type: "distance",
          shapeAIdx: idx,
          pointA: "start",
          shapeBIdx: idx,
          pointB: "end",
          distance,
        })),
        // The waist: how narrow, and how high.
        {
          type: "pointLineDistance",
          pointShapeIdx: 3,
          pointKey: "p0",
          lineShapeIdx: 7,
          distance: "WaistDia / 2",
        },
        {
          type: "pointLineDistance",
          pointShapeIdx: 3,
          pointKey: "p0",
          lineShapeIdx: 0,
          distance: "WaistY",
        },
      ];
      s.addItem(
        {
          id: 800,
          type: "sketch",
          name: "Rook Profile",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints: C,
        },
        "Added",
      );
      s.selectItem(800);
    }, V);
    await setVars();
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 800);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      const axisX = sk.shapes[6].x1;
      return {
        curves: sk.shapes.filter((sh) => sh.type === "bezier").length,
        baseR: len(sk.shapes[0]),
        baseH: len(sk.shapes[1]),
        band: len(sk.shapes[4]),
        topR: len(sk.shapes[5]),
        total: len(sk.shapes[6]),
        waistR: +((sk.shapes[3].p0.x - axisX) * 10).toFixed(1),
        // The curves have to still MEET the runs they join.
        joinGap: +(
          Math.hypot(
            sk.shapes[3].p3.x - sk.shapes[4].x1,
            sk.shapes[3].p3.y - sk.shapes[4].y1,
          ) * 10
        ).toFixed(2),
      };
    });
    expect(sec.curves).toBe(2);
    expect(sec.baseR).toBeCloseTo(V.BaseDia / 2, 0);
    expect(sec.baseH).toBeCloseTo(V.BaseHeight, 0);
    expect(sec.band).toBeCloseTo(V.BandHeight, 0);
    expect(sec.topR).toBeCloseTo(V.TopDia / 2, 0);
    expect(sec.total).toBeCloseTo(V.TotalHeight, 0);
    expect(sec.waistR).toBeCloseTo(V.WaistDia / 2, 0);
    expect(sec.joinGap).toBeLessThan(0.2);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 800);
      const pts = [];
      for (const sh of sk.shapes.slice(0, 7)) {
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
        sketchId: 800,
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
      s.setSweepAxis({ sketchId: 800, shapeIdx: 7 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    rookId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(rookId).not.toBeNull();

    const b = await box(rookId);
    expect(b.h).toBeCloseTo(V.TotalHeight, -1);
    expect(b.w).toBeCloseTo(V.BaseDia, -1);
    expect(b.d).toBeCloseTo(b.w, -1);
    // Wide foot, narrow waist, flaring back out to the battlement band.
    expect(await widthBetween(rookId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
    const waist = await widthBetween(rookId, V.WaistY - 2, V.WaistY + 2);
    expect(waist).toBeCloseTo(V.WaistDia, -1);
    expect(
      await widthBetween(rookId, V.TotalHeight - V.BandHeight, V.TotalHeight),
    ).toBeCloseTo(V.TopDia, -1);
    // The waist is CURVED, not a straight taper: halfway up from the base it
    // stands proud of the chord between the two ends the curve joins.
    const midY = (V.BaseHeight + V.WaistY) / 2;
    const chord =
      (V.BaseDia / 2 +
        (V.WaistDia / 2 - V.BaseDia / 2) *
          ((midY - V.BaseHeight) / (V.WaistY - V.BaseHeight))) *
      2;
    // A band, not a slice: a revolved curve is tessellated in rings, and a
    // thin cut between two of them contains no vertices at all.
    const actual = await widthBetween(rookId, midY - 3, midY + 3);
    expect(
      actual,
      `waist at ${midY}mm measured ${actual}, chord would be ${chord.toFixed(1)}`,
    ).toBeGreaterThan(chord + 1.5);
  });

  test("battlements are cut round the top by a circular pattern", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(rookId);
    const body = await worldBox(rookId);
    // One cutter through the band, then the pattern repeats it round the axis.
    await page.evaluate(
      ({ body, v, w }) => {
        const s = window.__store.getState();
        const u = (mm) => mm / 10;
        s.addItem({
          id: 810,
          name: "Crenel Cutter",
          type: "cube",
          children: [],
          parentId: null,
          // Sitting on the rim, open at the top, cutting inward past the wall.
          position: {
            x: body.axisX + u(v.TopDia / 2),
            y: body.minY + u(v.TotalHeight - 1),
            z: body.axisZ,
          },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: {
            width: u(v.TopDia),
            height: u(v.BandHeight),
            depth: u(w),
          },
        });
      },
      { body, v: V, w: CRENEL_W },
    );
    await settled();

    const seen = await page.evaluate(() =>
      window.__store.getState().items.map((i) => i.id),
    );
    await page.evaluate(
      ({ body, count }) => {
        const s = window.__store.getState();
        s.startPattern3d({ patternType: "circular", sourceId: 810 });
        s.updatePattern3d({
          axis: {
            origin: { x: body.axisX, y: body.minY, z: body.axisZ },
            dir: { x: 0, y: 1, z: 0 },
          },
        });
      },
      { body, count: CRENELS },
    );
    const bar = page.locator(".sketch-distance-input-overlay");
    await expect(bar).toBeVisible();
    await bar.locator("input").first().fill(String(CRENELS));
    await page.getByTitle("Create the pattern").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (s) =>
              window.__store
                .getState()
                .items.find(
                  (i) =>
                    !s.includes(i.id) &&
                    i.regenerator?.kind === "pattern3d" &&
                    i.geometryData?.positions?.length,
                )?.id ?? null,
            seen,
          ),
        { timeout: 300000 },
      )
      .not.toBe(null);
    await settled();
    const ringId = await page.evaluate(
      (s) =>
        window.__store
          .getState()
          .items.find(
            (i) => !s.includes(i.id) && i.regenerator?.kind === "pattern3d",
          ).id,
      seen,
    );

    // Cut is a two-set pick: the object to cut, THEN the cutters -- and
    // choosing the object clears the selection ready for the second set. The
    // pattern holds the COPIES, so the original cutter goes in with it.
    const seenBefore = await page.evaluate(() =>
      window.__store.getState().items.map((i) => i.id),
    );
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.startBooleanTool("difference");
      window.__store.setState({ selectedIds: [id] });
    }, rookId);
    await expect(bar).toBeVisible();
    await expect(
      bar.locator("button", { hasText: /Object to cut: / }),
    ).toBeVisible();
    await page.evaluate(
      (ids) => window.__store.setState({ selectedIds: ids }),
      [810, ringId],
    );
    await expect(
      bar.locator("button", { hasText: /Cutting objects: 2 objects/ }),
    ).toBeVisible();
    await page.getByTitle("Apply Cut").click();
    await expect
      .poll(
        () =>
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
            seenBefore,
          ),
        { timeout: 300000 },
      )
      .not.toBe(null);
    await settled();
    rookId = await page.evaluate(
      (s) =>
        window.__store
          .getState()
          .items.find(
            (i) =>
              !s.includes(i.id) &&
              i.type === "csg" &&
              i.geometryData?.positions?.length,
          ).id,
      seenBefore,
    );

    expect(await tris(rookId)).toBeGreaterThan(beforeTris);
    // FIVE gaps round the rim: at the top of the band there is material where a
    // merlon stands and none where a gap was cut.
    const rim = await page.evaluate(
      ({ id, yMm, count }) => {
        const it = window.__store.getState().items.find((i) => i.id === id);
        const p = it.geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        let loX = 1e9,
          hiX = -1e9,
          loZ = 1e9,
          hiZ = -1e9;
        for (let i = 0; i < p.length; i += 3) {
          loX = Math.min(loX, p[i]);
          hiX = Math.max(hiX, p[i]);
          loZ = Math.min(loZ, p[i + 2]);
          hiZ = Math.max(hiZ, p[i + 2]);
        }
        const cx = (loX + hiX) / 2,
          cz = (loZ + hiZ) / 2;
        const step = 360 / count;
        const material = (deg, half) => {
          let n = 0;
          for (let i = 0; i < p.length; i += 3) {
            const y = (p[i + 1] - base) * 10;
            if (Math.abs(y - yMm) > 1.5) continue;
            let d =
              ((Math.atan2(p[i + 2] - cz, p[i] - cx) * 180) / Math.PI - deg) %
              360;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            if (Math.abs(d) <= half) n++;
          }
          return n;
        };
        // A NARROW window down the middle of each gap: a wider one reaches the
        // gap's own side walls, whose vertices are material and would read as
        // "nothing was cut here".
        const gaps = [];
        const merlons = [];
        for (let k = 0; k < count; k++) {
          gaps.push(material(k * step, step / 12));
          merlons.push(material(k * step + step / 2, step / 7));
        }
        return { gaps, merlons };
      },
      { id: rookId, yMm: V.TotalHeight - 1, count: CRENELS },
    );
    expect(
      rim.gaps.filter((n) => n === 0).length,
      `gaps cut at ${JSON.stringify(rim.gaps)}`,
    ).toBe(CRENELS);
    expect(
      rim.merlons.filter((n) => n > 0).length,
      `merlons standing at ${JSON.stringify(rim.merlons)}`,
    ).toBe(CRENELS);
  });

  test("the foot is bevelled", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(rookId);
    // One point on the bottom rim, in the mesh's LOCAL frame -- the frame a
    // real edge click records. The revolve made it a true circle, so a single
    // point names the whole ring.
    const rim = await page.evaluate((id) => {
      const p = window.__store.getState().items.find((i) => i.id === id)
        .geometryData.positions;
      let lo = Infinity,
        r = 0;
      for (let i = 0; i < p.length; i += 3) lo = Math.min(lo, p[i + 1]);
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i + 1] - lo) > 1e-6) continue;
        r = Math.max(r, Math.hypot(p[i], p[i + 2]));
      }
      return { r, lo };
    }, rookId);

    await page.evaluate(
      ({ id, rim }) => {
        const s = window.__store.getState();
        s.setSelectedSubGeometry({
          itemId: id,
          edges: [
            { ax: rim.r, ay: rim.lo, az: 0, bx: rim.r, by: rim.lo, bz: 0 },
          ],
          faces: [],
        });
        s.setChamferSelectMode("chamfer");
      },
      { id: rookId, rim },
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill(String(RIM_BEVEL));
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            rookId,
          ),
        { timeout: 300000 },
      )
      .toBe("chamfer");
    await settled();

    expect(await tris(rookId)).toBeGreaterThan(beforeTris);
    // The very bottom ring is pulled in by the bevel while the base's widest
    // point is untouched.
    const footR = await widthBetween(rookId, 0, 0.3);
    expect(footR).toBeLessThan(V.BaseDia - RIM_BEVEL);
    expect(await widthBetween(rookId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
  });

  test("the finished rook saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "rook");
    expect(steps).toBeGreaterThan(3);
    rookPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, rookPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
  });
});
