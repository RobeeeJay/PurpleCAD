// A trophy: a bowl and stem spun on the lathe, a square plinth under it, a
// handle on each side, and text embossed into the plinth.
//
// Ends by saving test-results/parts/trophy.pcad and reopening it (see
// e2e/exportPart.js) -- open it in PurpleCAD. Dimension assertions cannot tell
// a trophy from a lamp.
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

let app;
let page;
let trophyId;
let trophyPcad;

const MM = 10; // MM_PER_UNIT

// The spun body is variable-driven. The plinth and the handles are primitives,
// which take resolved numbers rather than formulas -- so they are sized from
// these same values at build time but do not re-derive.
const V = {
  CupDia: 80,
  CupHeight: 60,
  StemDia: 20,
  StemHeight: 30,
  WallThickness: 4,
  FloorThickness: 8,
  BowlRadius: 90, // the outer arc's radius: SMALLER means a rounder bowl
};
const PLINTH = { w: 90, h: 16, d: 90 }; // mm
const HANDLE = { major: 16, minor: 4 }; // mm
const TEXT_HEIGHT_MM = 9;

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

// Where the body actually IS, in world scene units. The revolve profile is not
// anchored in sketch space -- nothing pins it to the origin -- so the spun body
// lands wherever the solver left it. Everything placed against it (the plinth,
// the handles) is measured off this rather than assumed.
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

// Widest vertex in a thin horizontal slice, in mm above the body's own base --
// how the tests tell WHERE a feature landed. A triangle count only says that
// something changed somewhere.
const widthAt = (id, yMm, tolMm = 2) =>
  page.evaluate(
    ({ n, yMm, tolMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let best = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs((p[i + 1] - base) * 10 - yMm) > tolMm) continue;
        best = Math.max(best, Math.abs(p[i]) * 10);
      }
      return +(best * 2).toFixed(2); // full width across the axis
    },
    { n: id, yMm, tolMm },
  );

// Widest vertex in a HEIGHT RANGE, in mm. A thin slice is no good on a box or a
// cylinder -- both are tessellated with vertices only at their ends, so a slice
// through the middle of one is empty.
const widthBetween = (id, yLoMm, yHiMm) =>
  page.evaluate(
    ({ n, yLoMm, yHiMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let best = 0;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - base) * 10;
        if (y < yLoMm || y > yHiMm) continue;
        best = Math.max(best, Math.abs(p[i]) * 10);
      }
      return +(best * 2).toFixed(2);
    },
    { n: id, yLoMm, yHiMm },
  );

// Narrowest radius in a slice -- the bore of the cup.
const boreAt = (id, yMm, tolMm = 1) =>
  page.evaluate(
    ({ n, yMm, tolMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let best = Infinity;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs((p[i + 1] - base) * 10 - yMm) > tolMm) continue;
        best = Math.min(best, Math.hypot(p[i], p[i + 2]) * 10);
      }
      return Number.isFinite(best) ? +best.toFixed(2) : null;
    },
    { n: id, yMm, tolMm },
  );

// Fuse `otherId` into the running body and adopt the RESULT as the body.
//
// The wait has to be for an id that did not exist before this call. Waiting for
// "some boolean-kind item other than the current one" passes instantly, because
// a consumed input stays in the item list -- so the second handle's union was
// never actually awaited, the emboss went onto the intermediate body, and the
// union that followed it became the final one WITHOUT the relief. That looked
// perfect live and lost the text on reload.
const unionWith = async (otherId) => {
  const before = await page.evaluate(() =>
    window.__store.getState().items.map((i) => i.id),
  );
  await page.evaluate(
    ({ a, b }) => {
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [a, b] });
    },
    { a: trophyId, b: otherId },
  );
  await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
  await page.getByTitle("Apply Union").click();
  await expect
    .poll(
      () =>
        page.evaluate(
          (seen) =>
            window.__store
              .getState()
              .items.find(
                (i) =>
                  !seen.includes(i.id) &&
                  i.type === "csg" &&
                  i.geometryData?.positions?.length,
              )?.id ?? null,
          before,
        ),
      { timeout: 120000 },
    )
    .not.toBe(null);
  await settled();
  trophyId = await page.evaluate(
    (seen) =>
      window.__store
        .getState()
        .items.find(
          (i) =>
            !seen.includes(i.id) &&
            i.type === "csg" &&
            i.geometryData?.positions?.length,
        ).id,
    before,
  );
};

test.describe.serial("trophy", () => {
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

  test("the lathe spins a hollow cup on a stem", async () => {
    test.setTimeout(360_000);
    await page.evaluate(() => {
      const s = window.__store.getState();
      // Authored roughly; the constraints put every edge where the variables
      // say. Straight stem and bore, curved bowl -- one closed loop, so no
      // construction geometry is needed.
      const sR = 1,
        sH = 3,
        cR = 4,
        cH = 6,
        w = 0.4,
        fT = 0.8,
        R = 9;
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: sR, y2: 0 }, // 0 underside of stem
        { type: "line", x1: sR, y1: 0, x2: sR, y2: sH }, // 1 stem
        {
          type: "arc",
          cx: sR - R,
          cy: sH + cH / 2,
          r: R,
          startAngle: -0.8,
          endAngle: 0.8,
        }, // 2 bowl wall
        { type: "line", x1: cR, y1: sH + cH, x2: cR - w, y2: sH + cH }, // 3 rim
        { type: "line", x1: cR - w, y1: sH + cH, x2: cR - w, y2: sH + fT }, // 4 bore
        { type: "line", x1: cR - w, y1: sH + fT, x2: 0, y2: sH + fT }, // 5 floor
        { type: "line", x1: 0, y1: sH + fT, x2: 0, y2: 0 }, // 6 axis side
        { type: "line", x1: 0, y1: -1, x2: 0, y2: sH + cH + 1 }, // 7 spin axis
      ];
      const C = [
        { type: "horizontal", shapeIdx: 0 },
        { type: "vertical", shapeIdx: 1 },
        { type: "horizontal", shapeIdx: 3 },
        { type: "vertical", shapeIdx: 4 },
        { type: "horizontal", shapeIdx: 5 },
        { type: "vertical", shapeIdx: 6 },
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
          shapeBIdx: 4,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 4,
          pointA: "end",
          shapeBIdx: 5,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 5,
          pointA: "end",
          shapeBIdx: 6,
          pointB: "start",
        },
        {
          type: "coincident",
          shapeAIdx: 6,
          pointA: "end",
          shapeBIdx: 0,
          pointB: "start",
        },
        // Pin the profile's inner edge ONTO the spin axis. Nothing else anchors
        // it in x, and a profile free to slide sideways spins to a different
        // radius than the variables say.
        { type: "colinear", shapeAIdx: 6, shapeBIdx: 7 },
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "StemDia / 2",
        },
        {
          type: "distance",
          shapeAIdx: 1,
          pointA: "start",
          shapeBIdx: 1,
          pointB: "end",
          distance: "StemHeight",
        },
        {
          type: "distance",
          shapeAIdx: 3,
          pointA: "start",
          shapeBIdx: 3,
          pointB: "end",
          distance: "WallThickness",
        },
        {
          type: "distance",
          shapeAIdx: 4,
          pointA: "start",
          shapeBIdx: 4,
          pointB: "end",
          distance: "CupHeight - FloorThickness",
        },
        {
          type: "distance",
          shapeAIdx: 2,
          pointA: "center",
          shapeBIdx: 2,
          pointB: "edge",
          distance: "BowlRadius",
        },
      ];
      s.addItem(
        {
          id: 300,
          type: "sketch",
          name: "Trophy Section",
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
      s.selectItem(300);
    });
    await setVars(); // solve the constraints
    await page.waitForTimeout(800);

    const sec = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 300);
      const len = (l) =>
        +(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 10).toFixed(1);
      return {
        stemHalf: len(sk.shapes[0]),
        stem: len(sk.shapes[1]),
        rim: len(sk.shapes[3]),
        bore: len(sk.shapes[4]),
        bowlR: +(sk.shapes[2].r * 10).toFixed(1),
      };
    });
    expect(sec.stemHalf).toBeCloseTo(V.StemDia / 2, 0);
    expect(sec.stem).toBeCloseTo(V.StemHeight, 0);
    expect(sec.rim).toBeCloseTo(V.WallThickness, 0);
    expect(sec.bore).toBeCloseTo(V.CupHeight - V.FloorThickness, 0);
    expect(sec.bowlR).toBeCloseTo(V.BowlRadius, 0);

    await page.evaluate(() => {
      const s = window.__store.getState();
      const sk = s.items.find((i) => i.id === 300);
      // Sample the constrained loop into the polygon the revolve spins. It is
      // re-derived from the sketch on every regen, so this seed only has to
      // identify the right loop.
      const pts = [];
      for (const sh of sk.shapes.slice(0, 7)) {
        if (sh.type === "line") pts.push({ x: sh.x1, y: sh.y1 });
        else
          for (let i = 0; i < 24; i++) {
            const a = sh.startAngle + ((sh.endAngle - sh.startAngle) * i) / 24;
            pts.push({
              x: sh.cx + Math.cos(a) * sh.r,
              y: sh.cy + Math.sin(a) * sh.r,
            });
          }
      }
      s.startSweepTool("revolve");
      s.setSweepProfile({
        sketchId: 300,
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
      s.setSweepAxis({ sketchId: 300, shapeIdx: 7 });
    });
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1200);

    trophyId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter(
            (i) => i.type === "csg" && i.geometryData?.positions?.length,
          )
          .pop()?.id ?? null,
    );
    expect(trophyId).not.toBeNull();

    const b = await bbox(trophyId);
    expect(b.h).toBeCloseTo(V.StemHeight + V.CupHeight, -1);
    expect(b.d).toBeCloseTo(b.w, -1); // round about the axis
    // A cup on a stem, not a bucket: narrow at the foot, wide at the rim...
    expect(await widthAt(trophyId, 2)).toBeCloseTo(V.StemDia, -1);
    expect(
      await widthAt(trophyId, V.StemHeight + V.CupHeight - 2),
    ).toBeGreaterThan(V.StemDia * 2);
    // ...and genuinely hollow.
    expect(
      await boreAt(trophyId, V.StemHeight + V.CupHeight - 2),
    ).toBeGreaterThan(V.CupDia / 4);
  });

  test("a plinth carries the cup", async () => {
    test.setTimeout(360_000);
    const before = await bbox(trophyId);
    const body = await worldBox(trophyId);
    await page.evaluate(
      ({ w, h, d, body }) => {
        window.__store.getState().addItem({
          id: 310,
          name: "Plinth",
          type: "cube",
          children: [],
          parentId: null,
          // Centred on the spun body's own axis, with its top face against the
          // underside of the stem.
          position: { x: body.axisX, y: body.minY - h / 20, z: body.axisZ },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { width: w / 10, height: h / 10, depth: d / 10 },
        });
      },
      { ...PLINTH, body },
    );
    await settled();
    await unionWith(310);

    const after = await bbox(trophyId);
    expect(after.h).toBeCloseTo(before.h + PLINTH.h, -1);
    // The plinth is square, wider than the cup, and at the BOTTOM.
    expect(after.w).toBeCloseTo(PLINTH.w, -1);
    expect(after.d).toBeCloseTo(PLINTH.d, -1);
    // The wide part is the plinth at the bottom; above it the body narrows to
    // the stem before flaring out again into the bowl.
    expect(await widthBetween(trophyId, 0, PLINTH.h)).toBeCloseTo(PLINTH.w, -1);
    expect(
      await widthBetween(trophyId, PLINTH.h + 1, PLINTH.h + V.StemHeight),
    ).toBeCloseTo(V.StemDia, -1);
  });

  test("a handle stands out on each side", async () => {
    test.setTimeout(360_000);
    const before = await bbox(trophyId);
    // High on the bowl, where it is wide: a handle down at the stem would sit
    // inside the plinth's footprint and prove nothing.
    const bandMm = PLINTH.h + V.StemHeight + V.CupHeight * 0.8;
    const body = await worldBox(trophyId);
    const cupR = (await widthBetween(trophyId, bandMm - 4, bandMm + 4)) / 2;
    expect(cupR).toBeGreaterThan(V.StemDia); // measured, not assumed

    // BOTH rings are added before either union: a union allocates the next free
    // id for its result, which collides with a handle added afterwards.
    await page.evaluate(
      ({ y, cupR, HANDLE, axisX, axisZ }) => {
        for (const [id, sign] of [
          [320, -1],
          [321, 1],
        ]) {
          window.__store.getState().addItem({
            id,
            name: `Handle ${id}`,
            type: "torus",
            children: [],
            parentId: null,
            // Straddling the bowl wall, so each ring is half in and half out --
            // a handle you could get a finger through.
            position: { x: axisX + (sign * cupR) / 10, y, z: axisZ },
            rotation: { x: Math.PI / 2, y: 0, z: 0 }, // ring stands upright
            scale: { x: 1, y: 1, z: 1 },
            dimensions: { major: HANDLE.major / 10, minor: HANDLE.minor / 10 },
          });
        }
      },
      {
        y: body.minY + bandMm / 10,
        cupR,
        HANDLE,
        axisX: body.axisX,
        axisZ: body.axisZ,
      },
    );
    await settled();
    await unionWith(320);
    await unionWith(321);

    const after = await bbox(trophyId);
    // They stick out SIDEWAYS, past everything else on the trophy.
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.w).toBeGreaterThan(cupR * 2 + HANDLE.major);
    // ...and they are up at the bowl, not somewhere else: the body is wider
    // across that band than the bowl itself is, and wider in X than in Z.
    const across = await widthBetween(trophyId, bandMm - 3, bandMm + 3);
    expect(across).toBeGreaterThan(cupR * 2 + HANDLE.major);
    expect(after.d).toBeCloseTo(before.d, -1); // nothing added front-to-back
  });

  test("the text is embossed into the plinth", async () => {
    test.setTimeout(360_000);
    const beforeTris = await tris(trophyId);
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.addItem(
        {
          id: 330,
          type: "sketch",
          name: "Plinth Text",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 }, // XY plane, facing +Z like the front
          scale: { x: 1, y: 1, z: 1 },
          shapes: [],
          constraints: [],
        },
        "Added",
      );
      s.selectItem(330);
    });
    // Through the real Text dialog, so the glyph outlines come from the app's
    // own font handling rather than being faked here.
    await page.evaluate(
      (h) =>
        window.__store.getState().setTextDraft({
          x: 0,
          y: 0,
          text: "CHAMPION",
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
            window.__store.getState().items.find((i) => i.id === 330).shapes
              .length,
        ),
      )
      .toBe(1);
    await page.evaluate(() => {
      const s = window.__store.getState();
      const sh = s.items.find((i) => i.id === 330).shapes[0];
      s.updateSketchTextShape(330, 0, { ...sh, x: -sh.w / 2, y: sh.h / 2 });
    });

    await page.evaluate(
      ({ id, plinthH }) => {
        const s = window.__store.getState();
        const sh = s.items.find((i) => i.id === 330).shapes[0];
        const p = s.items.find((i) => i.id === id).geometryData.positions;
        let base = Infinity,
          frontZ = -Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        // The +Z face -- the one facing the camera in the default view, so the
        // word is readable the moment the document is opened.
        for (let i = 0; i < p.length; i += 3) {
          if ((p[i + 1] - base) * 10 > plinthH) continue; // plinth only
          frontZ = Math.max(frontZ, p[i + 2]);
        }
        // One profile per glyph outline, in the same shape a sketch-fill click
        // would hand the tool. Counters (the holes in A, O, P) come through as
        // separate contours and are handed over as holes of the letter they
        // sit inside.
        const polys = sh.contours.map((c) =>
          c.map((pt) => ({ x: pt.x + sh.x, y: pt.y + sh.y })),
        );
        const boundsOf = (poly) =>
          poly.reduce(
            (b, q) => ({
              x0: Math.min(b.x0, q.x),
              x1: Math.max(b.x1, q.x),
              y0: Math.min(b.y0, q.y),
              y1: Math.max(b.y1, q.y),
            }),
            { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 },
          );
        const bounds = polys.map(boundsOf);
        const inside = (i, j) =>
          i !== j &&
          bounds[i].x0 > bounds[j].x0 &&
          bounds[i].x1 < bounds[j].x1 &&
          bounds[i].y0 > bounds[j].y0 &&
          bounds[i].y1 < bounds[j].y1;
        const profiles = [];
        polys.forEach((poly, i) => {
          if (polys.some((_, j) => inside(i, j))) return; // it is a counter
          const holes = polys.filter((_, j) => inside(j, i));
          const cx = poly.reduce((a, q) => a + q.x, 0) / poly.length;
          const cy = poly.reduce((a, q) => a + q.y, 0) / poly.length;
          profiles.push({
            type: "sketchLoop",
            sketchId: 330,
            textShapeIdx: 0,
            profileCentroid: { x: cx, y: cy },
            polygon2D: poly,
            holes,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            normalWorld: { x: 0, y: 0, z: 1 },
          });
        });
        s.startEmbossTool();
        s.setEmbossProfiles(profiles);
        s.setEmbossFaceSelection({
          itemId: id,
          face: {
            nx: 0,
            ny: 0,
            nz: 1,
            cx: 0,
            cy: base + plinthH / 20,
            cz: frontZ,
          },
          faceSet: null,
          valid: true,
        });
        s.updateEmbossParams({
          deboss: false,
          projection: "center",
          distanceMm: 1.2,
        });
      },
      { id: trophyId, plinthH: PLINTH.h },
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
            trophyId,
          ),
        { timeout: 300000 },
      )
      .toBe("emboss");
    await settled();

    expect(await tris(trophyId)).toBeGreaterThan(beforeTris);
    // The relief is ON the plinth's front face, and it is the WORD: measure
    // everything standing proud of that face and check its extent matches the
    // text that was stamped. "Something sticks out somewhere" would pass on a
    // relief that landed on the wrong face, or on one letter.
    const relief = await page.evaluate(
      ({ id, plinthH, plinthD }) => {
        const p = window.__store.getState().items.find((i) => i.id === id)
          .geometryData.positions;
        let base = Infinity;
        for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
        let faceZ = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          if ((p[i + 1] - base) * 10 > plinthH) continue;
          faceZ = Math.max(faceZ, p[i + 2] * 10);
        }
        // Strictly in FRONT of the plinth's own face -- at the face itself
        // sit its own corners, which would swallow the measurement.
        const front = plinthD / 2 + 0.2;
        let x0 = 1e9,
          x1 = -1e9,
          y0 = 1e9,
          y1 = -1e9,
          n = 0;
        for (let i = 0; i < p.length; i += 3) {
          const z = p[i + 2] * 10;
          if (z < front) continue;
          const y = (p[i + 1] - base) * 10;
          if (y > plinthH) continue;
          n++;
          x0 = Math.min(x0, p[i] * 10);
          x1 = Math.max(x1, p[i] * 10);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
        return {
          faceZ: +faceZ.toFixed(2),
          n,
          w: +(x1 - x0).toFixed(2),
          h: +(y1 - y0).toFixed(2),
        };
      },
      { id: trophyId, plinthH: PLINTH.h, plinthD: PLINTH.d },
    );
    console.log(
      "RELIEF",
      JSON.stringify(relief),
      "plinth",
      JSON.stringify(PLINTH),
    );
    expect(relief.faceZ).toBeGreaterThan(PLINTH.d / 2 + 0.5); // it protrudes
    expect(relief.n).toBeGreaterThan(50); // eight letters' worth of outline
    // As tall as the text, and wide enough to be the whole word rather than
    // one glyph -- but still inside the plinth.
    expect(relief.h).toBeGreaterThan(TEXT_HEIGHT_MM * 0.6);
    expect(relief.h).toBeLessThan(TEXT_HEIGHT_MM * 1.4);
    expect(relief.w).toBeGreaterThan(TEXT_HEIGHT_MM * 4);
    expect(relief.w).toBeLessThan(PLINTH.w);
  });

  test("the finished trophy saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "trophy");
    expect(steps).toBeGreaterThan(4);
    trophyPcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    test.setTimeout(360_000);
    const back = await importPartPcad(page, trophyPcad);
    expect(back.solids).toBeGreaterThan(0);
    expect(back.tris).toBeGreaterThan(200);
    const relief = await page.evaluate((plinthH) => {
      const s = window.__store.getState();
      const it = s.items
        .filter((i) => i.type === "csg" && i.geometryData)
        .pop();
      const p = it.geometryData.positions;
      let base = Infinity;
      for (let i = 1; i < p.length; i += 3) base = Math.min(base, p[i]);
      let n = 0,
        y0 = 1e9,
        y1 = -1e9,
        x0 = 1e9,
        x1 = -1e9;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - base) * 10;
        if (y > plinthH) continue;
        if (p[i + 2] * 10 < 45 + 0.2) continue;
        n++;
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        x0 = Math.min(x0, p[i] * 10);
        x1 = Math.max(x1, p[i] * 10);
      }
      return { n, w: +(x1 - x0).toFixed(2), h: +(y1 - y0).toFixed(2) };
    }, PLINTH.h);
    // The relief has to come back too. Loading REPLAYS the timeline, so this
    // is what catches an emboss that was stamped onto an intermediate body
    // which a later step then superseded -- live it looks right, reopened the
    // text is simply gone.
    expect(relief.n).toBeGreaterThan(50);
    expect(relief.w).toBeGreaterThan(TEXT_HEIGHT_MM * 4);
    expect(relief.h).toBeGreaterThan(TEXT_HEIGHT_MM * 0.6);
  });
});
