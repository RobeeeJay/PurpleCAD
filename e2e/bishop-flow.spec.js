// A chess bishop: a mitre spun from a bezier profile, the traditional slit cut
// into its front, a ball finial on top and a bevelled foot.
//
// The straight runs carry the dimensions; the curves join them. The solver
// treats a bezier as FIXED (sketchSolver.js: "bezier & unknowns: treated as
// fixed"), so the control points are authored from the same variables and the
// test checks the curves still MEET the dimensioned runs after solving.
//
// Ends by saving test-results/parts/bishop.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD.
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let bishopId;
let bishopPcad;

const V = {
  TotalHeight: 80,
  BaseDia: 36,
  BaseHeight: 7,
  WaistDia: 11,
  WaistY: 26,
  MitreDia: 22,
  MitreY: 46, // the widest point of the mitre
  NeckDia: 6,
};
const BALL_DIA = 9;
const SLIT = { width: 30, thick: 4, reach: 9, angleDeg: 35, y: 60 };
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

// The body's radius AT a height, read off the nearest ring of vertices.
//
// A max-over-a-band measure cannot do this: a revolved surface is tessellated
// in rings, so a thin band is often empty, and a wide one centred on a waist
// reports the widest point in it instead of the waist -- 20.3mm where the
// dimension says 13.
const radiusNear = (id, yMm) =>
  page.evaluate(
    ({ n, yMm }) => {
      const it = window.__store.getState().items.find((i) => i.id === n);
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
      let bestDy = Infinity;
      for (let i = 0; i < p.length; i += 3)
        bestDy = Math.min(bestDy, Math.abs((p[i + 1] - base) * 10 - yMm));
      let r = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs((p[i + 1] - base) * 10 - yMm) > bestDy + 0.05) continue;
        r = Math.max(r, Math.hypot(p[i] - cx, p[i + 2] - cz) * 10);
      }
      return +r.toFixed(2);
    },
    { n: id, yMm },
  );

// How far forward (+z) there is material at a point on the body, by casting a
// ray through the triangles.
//
// A vertex-window probe cannot see the slit: its cut walls are flat, so they
// tessellate to corner vertices only and nothing lands in the window, while the
// slot's tilted top and bottom faces DO put vertices out at the old surface
// radius -- which reads as "still solid" (11.92mm before the cut, 12.06mm
// after). A ray answers the question the test is actually asking.
const rayFront = (id, xMm, yMm) =>
  page.evaluate(
    ({ n, xMm, yMm }) => {
      const g = window.__store
        .getState()
        .items.find((i) => i.id === n).geometryData;
      const p = g.positions,
        ix = g.indices;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[i + k]);
          hi[k] = Math.max(hi[k], p[i + k]);
        }
      const px = (lo[0] + hi[0]) / 2 + xMm / 10;
      const py = lo[1] + yMm / 10;
      const cz = (lo[2] + hi[2]) / 2;
      let best = null;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3,
          b = ix[t + 1] * 3,
          c = ix[t + 2] * 3;
        const ax = p[a],
          ay = p[a + 1],
          bx = p[b],
          by = p[b + 1],
          gx = p[c],
          gy = p[c + 1];
        const d = (by - gy) * (ax - gx) + (gx - bx) * (ay - gy);
        if (Math.abs(d) < 1e-12) continue;
        const w0 = ((by - gy) * (px - gx) + (gx - bx) * (py - gy)) / d;
        const w1 = ((gy - ay) * (px - gx) + (ax - gx) * (py - gy)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p[a + 2] + w1 * p[b + 2] + w2 * p[c + 2];
        if (best === null || z > best) best = z;
      }
      return best === null ? null : +((best - cz) * 10).toFixed(2);
    },
    { n: id, xMm, yMm },
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

test.describe.serial("bishop", () => {
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

  test("the lathe spins a bezier mitre from its dimensions", async () => {
    test.setTimeout(360_000);
    await page.evaluate((v) => {
      const s = window.__store.getState();
      const u = (mm) => mm / 10;
      const rBase = u(v.BaseDia / 2),
        hBase = u(v.BaseHeight),
        rWaist = u(v.WaistDia / 2),
        yWaist = u(v.WaistY),
        rMitre = u(v.MitreDia / 2),
        yMitre = u(v.MitreY),
        rNeck = u(v.NeckDia / 2),
        yTop = u(v.TotalHeight);
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: rBase, y2: 0 }, // 0 foot
        { type: "line", x1: rBase, y1: 0, x2: rBase, y2: hBase }, // 1 base side
        {
          // 2 the skirt sweeping in to a slim stem
          type: "bezier",
          p0: { x: rBase, y: hBase },
          p1: { x: rBase - u(1), y: hBase + u(4) },
          p2: { x: rWaist, y: yWaist - u(6) },
          p3: { x: rWaist, y: yWaist },
        },
        {
          // 3 the collar swelling out into the mitre. A SYMMETRIC s-curve
          // here reads as straight to any curvature check -- its two lobes sit
          // on opposite sides of the chord and cancel (measured 0.78mm/-0.48mm)
          // -- so the control points lean outward early for a single convex
          // bow, which is also the shape a bishop's collar actually has.
          type: "bezier",
          p0: { x: rWaist, y: yWaist },
          p1: { x: rWaist + u(4), y: yWaist + u(3) },
          p2: { x: rMitre, y: yMitre - u(4) },
          p3: { x: rMitre, y: yMitre },
        },
        {
          // 4 mitre closing to the neck
          type: "bezier",
          p0: { x: rMitre, y: yMitre },
          p1: { x: rMitre, y: yMitre + u(9) },
          p2: { x: rNeck + u(3), y: yTop },
          p3: { x: rNeck, y: yTop },
        },
        { type: "line", x1: rNeck, y1: yTop, x2: 0, y2: yTop }, // 5 top face
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
        link(3, "p3", 4, "p0"),
        link(4, "p3", 5, "start"),
        link(5, "end", 6, "start"),
        link(6, "end", 0, "start"),
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "horizontal", shapeIdx: 5 },
        { type: "vertical", shapeIdx: 6 },
        // Pin the profile's inner edge ONTO the spin axis, or it spins to a
        // different radius than the dimensions say.
        { type: "colinear", shapeAIdx: 6, shapeBIdx: 7 },
        ...[
          [0, "BaseDia / 2"],
          [1, "BaseHeight"],
          [5, "NeckDia / 2"],
          [6, "TotalHeight"],
        ].map(([idx, distance]) => ({
          type: "distance",
          shapeAIdx: idx,
          pointA: "start",
          shapeBIdx: idx,
          pointB: "end",
          distance,
        })),
        // The waist and the widest point of the mitre, across and up.
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
        {
          type: "pointLineDistance",
          pointShapeIdx: 4,
          pointKey: "p0",
          lineShapeIdx: 7,
          distance: "MitreDia / 2",
        },
        {
          type: "pointLineDistance",
          pointShapeIdx: 4,
          pointKey: "p0",
          lineShapeIdx: 0,
          distance: "MitreY",
        },
      ];
      s.addItem(
        {
          id: 900,
          type: "sketch",
          name: "Bishop Profile",
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
      s.selectItem(900);
    }, V);
    await setVars();
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 900);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      const axisX = sk.shapes[6].x1;
      const y0 = sk.shapes[0].y1;
      return {
        curves: sk.shapes.filter((sh) => sh.type === "bezier").length,
        baseR: len(sk.shapes[0]),
        baseH: len(sk.shapes[1]),
        neckR: len(sk.shapes[5]),
        total: len(sk.shapes[6]),
        waistR: +((sk.shapes[3].p0.x - axisX) * 10).toFixed(1),
        waistY: +((sk.shapes[3].p0.y - y0) * 10).toFixed(1),
        mitreR: +((sk.shapes[4].p0.x - axisX) * 10).toFixed(1),
        mitreY: +((sk.shapes[4].p0.y - y0) * 10).toFixed(1),
        joinGap: +(
          Math.hypot(
            sk.shapes[4].p3.x - sk.shapes[5].x1,
            sk.shapes[4].p3.y - sk.shapes[5].y1,
          ) * 10
        ).toFixed(2),
      };
    });
    expect(sec.curves).toBe(3);
    expect(sec.baseR).toBeCloseTo(V.BaseDia / 2, 0);
    expect(sec.baseH).toBeCloseTo(V.BaseHeight, 0);
    expect(sec.neckR).toBeCloseTo(V.NeckDia / 2, 0);
    expect(sec.total).toBeCloseTo(V.TotalHeight, 0);
    expect(sec.waistR).toBeCloseTo(V.WaistDia / 2, 0);
    expect(sec.waistY).toBeCloseTo(V.WaistY, 0);
    expect(sec.mitreR).toBeCloseTo(V.MitreDia / 2, 0);
    expect(sec.mitreY).toBeCloseTo(V.MitreY, 0);
    expect(sec.joinGap).toBeLessThan(0.2);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 900);
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
        sketchId: 900,
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
      s.setSweepAxis({ sketchId: 900, shapeIdx: 7 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    bishopId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(bishopId).not.toBeNull();

    const b = await box(bishopId);
    expect(b.h).toBeCloseTo(V.TotalHeight, -1);
    expect(b.w).toBeCloseTo(V.BaseDia, -1);
    expect(b.d).toBeCloseTo(b.w, -1);
    // Wide foot, narrow waist, mitre swelling back out above it.
    expect(await widthBetween(bishopId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
    const waist = (await radiusNear(bishopId, V.WaistY)) * 2;
    expect(waist).toBeCloseTo(V.WaistDia, -1);
    expect((await radiusNear(bishopId, V.MitreY)) * 2).toBeCloseTo(
      V.MitreDia,
      -1,
    );
    expect(waist).toBeLessThan(V.MitreDia);
    // The mitre is CURVED, and the lathe FOLLOWS that curve.
    //
    // Not a midpoint-vs-chord test: the waist-to-mitre bezier is an S, so its
    // middle sits exactly ON the chord (measured 19.5 against a chord of
    // 19.5). Curvature has to be read over the whole span, and the mesh
    // checked against the authored curve rather than against a straight line.
    const curve = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 900);
      const y0 = sk.shapes[0].y1;
      const axisX = sk.shapes[6].x1;
      const at = (sh, t) => {
        const m = 1 - t;
        return {
          r:
            (m * m * m * sh.p0.x +
              3 * m * m * t * sh.p1.x +
              3 * m * t * t * sh.p2.x +
              t * t * t * sh.p3.x -
              axisX) *
            10,
          y:
            (m * m * m * sh.p0.y +
              3 * m * m * t * sh.p1.y +
              3 * m * t * t * sh.p2.y +
              t * t * t * sh.p3.y -
              y0) *
            10,
        };
      };
      const spans = {};
      for (const [name, idx] of [
        ["base", 2],
        ["mitre", 3],
        ["crown", 4],
      ]) {
        const sh = sk.shapes[idx];
        const pts = [];
        for (let i = 0; i <= 40; i++) pts.push(at(sh, i / 40));
        const a = pts[0],
          b = pts[pts.length - 1];
        const len = Math.hypot(b.r - a.r, b.y - a.y);
        let bow = 0;
        for (const q of pts)
          bow = Math.max(
            bow,
            Math.abs((b.r - a.r) * (a.y - q.y) - (a.r - q.r) * (b.y - a.y)) /
              len,
          );
        spans[name] = { bow: +bow.toFixed(2), pts };
      }
      return spans;
    });
    for (const [name, span] of Object.entries(curve))
      expect(
        span.bow,
        `the ${name} curve bows only ${span.bow}mm off a straight run`,
      ).toBeGreaterThan(1);

    // Every sampled height on the spun body sits on the authored curve.
    for (const yMm of [35, 40, 45]) {
      const want = curve.mitre.pts.reduce((best, q) =>
        Math.abs(q.y - yMm) < Math.abs(best.y - yMm) ? q : best,
      ).r;
      const got = await radiusNear(bishopId, yMm);
      expect(
        got,
        `at ${yMm}mm the body measured r=${got}, the profile says ${want.toFixed(2)}`,
      ).toBeCloseTo(want, 0);
    }
  });

  test("a ball finial tops the mitre", async () => {
    test.setTimeout(360_000);
    const before = await box(bishopId);
    const body = await worldBox(bishopId);
    await page.evaluate(
      ({ body, dia }) => {
        window.__store.getState().addItem({
          id: 910,
          name: "Finial",
          type: "sphere",
          children: [],
          parentId: null,
          // Sitting mostly above the neck, sunk enough to fuse.
          position: { x: body.axisX, y: body.maxY + dia / 40, z: body.axisZ },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { radius: dia / 20 },
        });
      },
      { body, dia: BALL_DIA },
    );
    await settled();
    bishopId = await unionOf(bishopId, 910);

    const after = await box(bishopId);
    expect(after.h).toBeGreaterThan(before.h);
    expect(after.h).toBeLessThan(before.h + BALL_DIA);
    expect(after.w).toBeCloseTo(before.w, -1);
    // It is a BALL: wider than the neck it stands on.
    expect(
      await widthBetween(bishopId, V.TotalHeight - 3, after.h),
    ).toBeGreaterThan(V.NeckDia);
  });

  test("the traditional slit is cut into the mitre", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(bishopId);
    const beforeFront = await rayFront(bishopId, 0, SLIT.y);
    const beforeCollar = await rayFront(bishopId, 0, V.MitreY - 6);
    const body = await worldBox(bishopId);
    await page.evaluate(
      ({ body, slit }) => {
        const u = (mm) => mm / 10;
        window.__store.getState().addItem({
          id: 920,
          name: "Slit Cutter",
          type: "cube",
          children: [],
          parentId: null,
          // Biting into the FRONT of the mitre only -- deep enough to read as a
          // slit, not so deep it severs the top off.
          position: {
            x: body.axisX,
            y: body.minY + u(slit.y),
            z: body.axisZ + u(slit.reach),
          },
          rotation: { x: 0, y: 0, z: (slit.angleDeg * Math.PI) / 180 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: {
            width: u(slit.width),
            height: u(slit.thick),
            depth: u(slit.reach * 2),
          },
        });
      },
      { body, slit: SLIT },
    );
    await settled();

    const seen = await page.evaluate(() =>
      window.__store.getState().items.map((i) => i.id),
    );
    const bar = page.locator(".sketch-distance-input-overlay");
    await page.evaluate((id) => {
      const s = window.__store.getState();
      s.startBooleanTool("difference");
      window.__store.setState({ selectedIds: [id] });
    }, bishopId);
    await expect(bar).toBeVisible();
    await expect(
      bar.locator("button", { hasText: /Object to cut: / }),
    ).toBeVisible();
    await page.evaluate(() => window.__store.setState({ selectedIds: [920] }));
    await expect(
      bar.locator("button", { hasText: /Cutting objects: / }),
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
            seen,
          ),
        { timeout: 300000 },
      )
      .not.toBe(null);
    await settled();
    bishopId = await page.evaluate(
      (s) =>
        window.__store
          .getState()
          .items.find(
            (i) =>
              !s.includes(i.id) &&
              i.type === "csg" &&
              i.geometryData?.positions?.length,
          ).id,
      seen,
    );

    expect(await tris(bishopId)).toBeGreaterThan(beforeTris);
    // The front of the mitre is cut back where the slit is, and the piece keeps
    // its base -- so this is a notch, not a shrunken body.
    const afterFront = await rayFront(bishopId, 0, SLIT.y);
    expect(
      afterFront,
      `material reached ${beforeFront}mm forward at the slit before the cut and ${afterFront}mm after`,
    ).toBeLessThan(beforeFront - 4);
    // and ONLY there -- the collar below the slit is untouched.
    expect(await rayFront(bishopId, 0, V.MitreY - 6)).toBeCloseTo(
      beforeCollar,
      1,
    );
    expect(await widthBetween(bishopId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
  });

  test("the foot is bevelled", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(bishopId);
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
    }, bishopId);

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
      { id: bishopId, rim },
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
            bishopId,
          ),
        { timeout: 300000 },
      )
      .toBe("chamfer");
    await settled();

    expect(await tris(bishopId)).toBeGreaterThan(beforeTris);
    expect(await widthBetween(bishopId, 0, 0.3)).toBeLessThan(
      V.BaseDia - RIM_BEVEL,
    );
    expect(await widthBetween(bishopId, 0, V.BaseHeight)).toBeCloseTo(
      V.BaseDia,
      -1,
    );
  });

  test("the finished bishop saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "bishop");
    expect(steps).toBeGreaterThan(3);
    bishopPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, bishopPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
  });
});
