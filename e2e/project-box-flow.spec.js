// A whole parametric part, built the way a user would and then re-driven from
// its parameters: a project box, a lid that SEATS on it with a mating ridge
// dropping inside the walls, a push/pull fit clearance so it does not jam, and
// four M3 clearance holes through the lid into the wall tops.
//
// The point of the test is the parameter change near the end. Everything
// before it exists so that change has somewhere to go wrong: sketch dimensions
// re-solve, three offset rings re-derive, extrude depths re-resolve, and two
// unions, four bores and a push/pull rebuild on top of all of it.
//
// WHAT IS ACTUALLY PARAMETRIC (established by measurement, not assumed):
//   sketch distance constraints -> outer width/depth        (formula)
//   sketch offsets              -> wall + ridge thickness   (formula)
//   extrude depths              -> every height             (formula)
// Shell thickness, hole sizes and push/pull distances are stored as resolved
// NUMBERS by their commit paths (buildHoleShape divides h.length by
// MM_PER_UNIT, so a formula string would arrive as NaN). The box is therefore
// built from offset rings rather than the shell tool, and the holes and the
// clearance are authored FROM the variable values rather than following them.
// POSITIONS are numbers too, which is why the lid seats at a fixed y and the
// last test pins that it does not follow BoxHeight.
//
// Behaviours found while writing this, each pinned by a probe:
//   - The plate and the ridge need SEPARATE sketches. Nested in one sketch the
//     live re-derivation hands the outer entry the middle loop AS A HOLE, so
//     the "plate" comes back as an annulus and the lid has no floor. Bounding
//     boxes and the mate check both pass on that; only rendering it shows it.
//   - setItemTransform is POSITIONAL: (id, position, scale, rotation). Calling
//     it with an options object silently stores that object AS the position, so
//     item.position.x is undefined. Nothing complains until "Reset view" frames
//     the scene from item positions and the NaN reaches the camera.
//     (The lid is built in place anyway -- plate extruded up off the wall top,
//     ridge extruded down on a negative depth -- which is simpler than moving
//     it afterwards.)
//
// The threaded holes here used to come back EMPTY, and an earlier version of
// this comment blamed a thread face-count cap, with a table of the lengths that
// "failed". That was wrong: the lengths only correlated because they set how
// LONG the op ran. The tool's own preview debounce was calling cancelOcc while
// the commit was still running, and an abort during meshing returns an empty
// tessellation rather than throwing. Fixed in occClient (commit guard); the
// four M3 threads below are the regression cover for it.
//
// They are tapped LAST for a separate and still-live reason: a boolean whose
// input already carries four helical thread surfaces fails outright with
// "performCsg: Error". Drilling before the union failed every run; drilling
// after it passes every run. That is also the order a real part is made in.

import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";

let app;
let page;
let boxBaseId;
let lidId;

// mm; scene units are mm / 10.
const P0 = {
  BoxWidth: 60,
  BoxDepth: 40,
  BoxHeight: 30,
  // Thick enough that a screw hole fits IN the wall: the screws pass through
  // the lid into the wall tops, so the wall has to carry the bore.
  WallThickness: 4,
  LidThickness: 3,
  RidgeHeight: 5,
  RidgeThickness: 1.5,
  Clearance: 0.3,
  // M3: 3mm major diameter, 0.5mm pitch (src/three/metricThreads.js).
  ScrewDia: 3,
  ScrewPitch: 0.5,
};
const MM = 10; // MM_PER_UNIT
// Where the lid seats. A plain number: sketch positions are not parametric.
const BOX_HEIGHT_UNITS = P0.BoxHeight / MM;

const setVars = (vars) =>
  page.evaluate(
    (v) =>
      window.__store
        .getState()
        .setVariables(
          Object.entries(v).map(([name, mm]) => ({
            name,
            formula: String(mm),
          })),
        ),
    vars,
  );

// Adding a sketch does NOT solve it -- constraints re-solve on setVariables.
// Anything derived from the sketch (an offset, an extrude profile) must come
// AFTER that solve or it is built from the authored coordinates instead of the
// dimensions the variables ask for.
const addSolvedSketch = async (spec) => {
  await page.evaluate((r) => window.__store.getState().addItem(r, "Added"), spec);
  await setVars(P0);
  await page.waitForTimeout(300);
};

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 120000 });

// World-space bounding box of an item's baked mesh, in mm.
const bbox = (id) =>
  page.evaluate((n) => {
    const it = window.__store.getState().items.find((i) => i.id === n);
    const p = it?.geometryData?.positions;
    if (!p?.length) return null;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    const s = it.scale || { x: 1, y: 1, z: 1 };
    return {
      w: (hi[0] - lo[0]) * s.x * 10,
      h: (hi[1] - lo[1]) * s.y * 10,
      d: (hi[2] - lo[2]) * s.z * 10,
    };
  }, id);

// The baked mesh is cleared and re-set across a recalc pass, so sampling it
// once can catch the gap. Poll until it is present, then measure.
const waitBbox = async (id) => {
  await expect
    .poll(() => bbox(id).then((b) => !!b), { timeout: 120000 })
    .toBe(true);
  return bbox(id);
};

const tris = (id) =>
  page.evaluate(
    (n) =>
      (window.__store.getState().items.find((i) => i.id === n)?.geometryData
        ?.indices.length ?? 0) / 3,
    id,
  );

// A closed, CCW rectangle as four constrained lines, sized by two formulas.
const rectSketch = ({ id, name, w, d, x = 0, y = 0, z = 0, wFormula, dFormula }) => ({
  id,
  type: "sketch",
  name,
  children: [],
  parentId: null,
  position: { x, y, z },
  rotation: { x: -Math.PI / 2, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [
    { type: "line", x1: 0, y1: 0, x2: w, y2: 0 },
    { type: "line", x1: w, y1: 0, x2: w, y2: d },
    { type: "line", x1: w, y1: d, x2: 0, y2: d },
    { type: "line", x1: 0, y1: d, x2: 0, y2: 0 },
  ],
  constraints: [
    { type: "horizontal", shapeIdx: 0 },
    { type: "vertical", shapeIdx: 1 },
    { type: "horizontal", shapeIdx: 2 },
    { type: "vertical", shapeIdx: 3 },
    { type: "coincident", shapeAIdx: 0, pointA: "end", shapeBIdx: 1, pointB: "start" },
    { type: "coincident", shapeAIdx: 1, pointA: "end", shapeBIdx: 2, pointB: "start" },
    { type: "coincident", shapeAIdx: 2, pointA: "end", shapeBIdx: 3, pointB: "start" },
    { type: "coincident", shapeAIdx: 3, pointA: "end", shapeBIdx: 0, pointB: "start" },
    { type: "distance", shapeAIdx: 0, pointA: "start", shapeBIdx: 0, pointB: "end", distance: wFormula },
    { type: "distance", shapeAIdx: 1, pointA: "start", shapeBIdx: 1, pointB: "end", distance: dFormula },
  ],
});

test.describe.serial("parametric project box", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error")
        console.log(`[renderer error] ${m.text().slice(0, 200)}`);
    });
    await expect(page.locator(".toolbar")).toBeVisible();
    await setVars(P0);
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the box footprint is driven by its width and depth variables", async () => {
    await addSolvedSketch(
      rectSketch({
        // Authored deliberately WRONG (30x20mm) so the assertion below can
        // only pass if the constraints actually re-solved to the variables.
        id: 100,
        name: "Box Footprint",
        w: 3,
        d: 2,
        wFormula: "BoxWidth",
        dFormula: "BoxDepth",
      }),
    );
    // The solve is what proves the constraints bind to the variables rather
    // than to the coordinates they were authored at.
    const span = await page.evaluate(() => {
      const sk = window.__store.getState().items.find((i) => i.id === 100);
      const xs = sk.shapes.flatMap((s) => [s.x1, s.x2]);
      const ys = sk.shapes.flatMap((s) => [s.y1, s.y2]);
      return {
        w: (Math.max(...xs) - Math.min(...xs)) * 10,
        d: (Math.max(...ys) - Math.min(...ys)) * 10,
      };
    });
    expect(span.w).toBeCloseTo(P0.BoxWidth, 1);
    expect(span.d).toBeCloseTo(P0.BoxDepth, 1);
  });

  test("walls plus floor union into a hollow box base", async () => {
    // Inward is NEGATIVE: a positive offset distance moves the copy outward
    // (measured, not assumed -- +WallThickness spans -0.2..6.2 on a 0..6 rect,
    // -WallThickness spans 0.2..5.8).
    await page.evaluate(() =>
      window.__store
        .getState()
        .offsetSketchGeometry(100, [0, 1, 2, 3], "-WallThickness"),
    );
    await page.waitForTimeout(300);

    await addSolvedSketch(
      rectSketch({
        id: 110,
        name: "Box Floor Footprint",
        w: 3,
        d: 2,
        wFormula: "BoxWidth",
        dFormula: "BoxDepth",
      }),
    );

    await page.evaluate(() => {
      const s = window.__store.getState();
      const loopOf = (sketchId, from) =>
        s.items
          .find((i) => i.id === sketchId)
          .shapes.slice(from, from + 4)
          .map((l) => ({ x: l.x1, y: l.y1 }));
      const extrude = (id, name, sketchId, poly, holes, depth) => ({
        id,
        type: "extrude",
        name,
        children: [],
        parentId: null,
        profile: {
          type: "sketchLoop",
          sketchId,
          textShapeIdx: null,
          profileCentroid: { x: 3, y: 2 },
          polygon2D: poly,
          holes,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          normalWorld: { x: 0, y: 1, z: 0 },
        },
        depth,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      // Walls: the ring between the outer loop and its inward offset.
      s.addItem(
        extrude(101, "Box Walls", 100, loopOf(100, 0), [loopOf(100, 4)], "BoxHeight"),
        "Added",
      );
      // Floor: its OWN footprint sketch, one wall thickness thick.
      s.addItem(
        extrude(111, "Box Floor", 110, loopOf(110, 0), [], "WallThickness"),
        "Added",
      );
    });
    await settled();

    await page.evaluate(() => {
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [101, 111] });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(() => page.evaluate(() => window.__store.getState().items.find((i) => i.regenerator?.kind === "boolean")?.id ?? null), { timeout: 120000 })
      .not.toBe(null);
    await settled();

    boxBaseId = await page.evaluate(
      () =>
        window.__store.getState().items.find((i) => i.regenerator?.kind === "boolean").id,
    );
    const b = await waitBbox(boxBaseId);
    expect(b.w).toBeCloseTo(P0.BoxWidth, 0);
    expect(b.d).toBeCloseTo(P0.BoxDepth, 0);
    expect(b.h).toBeCloseTo(P0.BoxHeight, 0);
    // Hollow, not a solid block: a solid box tessellates to 12 triangles.
    expect(await tris(boxBaseId)).toBeGreaterThan(12);
  });

  test("the lid plate and its mating ridge come from one sketch", async () => {
    // Plate and ridge come from ONE sketch, three concentric loops deep: the
    // outer rect, an inward offset of WallThickness (the ridge's outer face,
    // which is exactly the box's inner face -- that is the mate), and a second
    // inward offset of WallThickness+RidgeThickness (the ridge's inner face).
    // Deriving the ridge by offset rather than by a fixed inset is what keeps
    // it centred when WallThickness changes -- a sketch's position is a plain
    // number and would not track.
    // TWO sketches, deliberately. With the plate and the ridge in ONE sketch the
    // loops nest, and the live re-derivation hands the outer entry the middle
    // loop AS A HOLE -- the "plate" comes back as a rectangular annulus and the
    // lid has no floor. Bounding boxes and the mate check cannot see that; only
    // looking at the part does. The plate therefore gets a sketch with no
    // offsets in it, and the ridge gets its own copy of the same outline.
    await addSolvedSketch(
      rectSketch({
        id: 120,
        name: "Lid Footprint",
        w: 3,
        d: 2,
        // ON the wall top, over the box. This y is a plain number -- sketch
        // positions are NOT parametric -- so the parameter-change test
        // re-seats the lid explicitly when BoxHeight moves.
        y: BOX_HEIGHT_UNITS,
        wFormula: "BoxWidth",
        dFormula: "BoxDepth",
      }),
    );
    await addSolvedSketch(
      rectSketch({
        id: 130,
        name: "Lid Ridge Footprint",
        w: 3,
        d: 2,
        y: BOX_HEIGHT_UNITS,
        wFormula: "BoxWidth",
        dFormula: "BoxDepth",
      }),
    );
    // Offsets must come AFTER the solve: they copy the CURRENT geometry, so
    // offsetting an unsolved 30x20 sketch rings the wrong rectangle. Same
    // outline and same position as the plate, so the ridge stays centred on it
    // however the parameters move.
    await page.evaluate(() => {
      const s = window.__store.getState();
      s.offsetSketchGeometry(130, [0, 1, 2, 3], "-WallThickness");
      s.offsetSketchGeometry(130, [0, 1, 2, 3], "-(WallThickness + RidgeThickness)");
    });
    await page.waitForTimeout(300);

    await page.evaluate(
      ({ lidY }) => {
      const s = window.__store.getState();
      const loopOf = (sketchId, from) =>
        s.items
          .find((i) => i.id === sketchId)
          .shapes.slice(from, from + 4)
          .map((l) => ({ x: l.x1, y: l.y1 }));
      const extrude = (id, name, sketchId, poly, holes, depth) => ({
        id,
        type: "extrude",
        name,
        children: [],
        parentId: null,
        profile: {
          type: "sketchLoop",
          sketchId,
          textShapeIdx: null,
          profileCentroid: { x: 3, y: 2 },
          polygon2D: poly,
          holes,
          position: { x: 0, y: lidY, z: 0 },
          rotation: { x: -Math.PI / 2, y: 0, z: 0 },
          normalWorld: { x: 0, y: 1, z: 0 },
        },
        depth,
        position: { x: 0, y: lidY, z: 0 },
        rotation: { x: -Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
      s.addItem(
        extrude(121, "Lid Plate", 120, loopOf(120, 0), [], "LidThickness"),
        "Added",
      );
      // Plate extrudes UP off the wall top, ridge extrudes DOWN into the box.
      // Building the lid in place beats seating it afterwards: a transform on
      // the finished lid hangs the renderer (see the header).
      s.addItem(
        extrude(122, "Lid Ridge", 130, loopOf(130, 4), [loopOf(130, 8)], "-RidgeHeight"),
        "Added",
      );
      },
      { lidY: BOX_HEIGHT_UNITS },
    );
    await settled();

    // The mate itself: the ridge's outer face is exactly the box's inner face,
    // so the lid drops into the walls. Both sides are derived, not authored --
    // the box inner from the wall ring's offset, the ridge outer from the lid
    // sketch's first offset.
    const mate = await page.evaluate(() => {
      const items = window.__store.getState().items;
      const spanOf = (sketchId, from) => {
        const sh = items.find((i) => i.id === sketchId).shapes.slice(from, from + 4);
        const xs = sh.flatMap((l) => [l.x1, l.x2]);
        const ys = sh.flatMap((l) => [l.y1, l.y2]);
        return {
          w: (Math.max(...xs) - Math.min(...xs)) * 10,
          d: (Math.max(...ys) - Math.min(...ys)) * 10,
        };
      };
      return { boxInner: spanOf(100, 4), ridgeOuter: spanOf(130, 4) };
    });
    expect(mate.ridgeOuter.w).toBeCloseTo(mate.boxInner.w, 1);
    expect(mate.ridgeOuter.d).toBeCloseTo(mate.boxInner.d, 1);
    expect(mate.boxInner.w).toBeCloseTo(P0.BoxWidth - 2 * P0.WallThickness, 1);
  });

  test("plate and ridge union into the finished lid", async () => {
    const before = await page.evaluate(
      () => window.__store.getState().items.filter((i) => i.regenerator?.kind === "boolean").length,
    );
    await page.evaluate(() => {
      window.__store.getState().startBooleanTool("union");
      window.__store.setState({ selectedIds: [121, 122] });
    });
    await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
    await page.getByTitle("Apply Union").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__store.getState().items.filter((i) => i.regenerator?.kind === "boolean").length,
          ),
        { timeout: 120000 },
      )
      .toBe(before + 1);
    await settled();

    lidId = await page.evaluate(
      (skip) =>
        window.__store
          .getState()
          .items.filter((i) => i.regenerator?.kind === "boolean")
          .find((i) => i.id !== skip).id,
      boxBaseId,
    );
    const lid = await waitBbox(lidId);
    expect(lid.w).toBeCloseTo(P0.BoxWidth, 0);
    expect(lid.d).toBeCloseTo(P0.BoxDepth, 0);
    // Plate plus the ridge standing proud of it.
    expect(lid.h).toBeCloseTo(P0.LidThickness + P0.RidgeHeight, 0);
  });

  test("push/pull cuts a fit clearance into the mating ridge", async () => {
    // Without this the ridge is exactly the size of the opening and the lid
    // jams. Push all four ridge outer faces inward at once -- the tool takes a
    // face list, matched by normal + centre.
    const ro = (P0.BoxWidth / 2 - P0.WallThickness) / MM;
    const rod = (P0.BoxDepth / 2 - P0.WallThickness) / MM;
    // The ridge hangs BELOW the plate, so its outer faces are centred at a
    // negative local y: half the plate plus half the ridge, downward. Getting
    // this wrong pushes the PLATE's outer faces and shrinks the whole lid.
    const cy = -(P0.LidThickness / 2 + P0.RidgeHeight / 2) / MM;
    await page.evaluate(
      ({ id, ro, rod, cy }) => {
        const s = window.__store.getState();
        s.setSelectedSubGeometry({
          itemId: id,
          edges: [],
          faces: [
            { nx: 1, ny: 0, nz: 0, cx: ro, cy, cz: 0 },
            { nx: -1, ny: 0, nz: 0, cx: -ro, cy, cz: 0 },
            { nx: 0, ny: 0, nz: 1, cx: 0, cy, cz: rod },
            { nx: 0, ny: 0, nz: -1, cx: 0, cy, cz: -rod },
          ],
        });
        s.setPushPullSelectMode("pushpull");
      },
      { id: lidId, ro, rod, cy },
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill(String(-P0.Clearance));
    await page.getByTitle("Confirm — apply the push/pull").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            lidId,
          ),
        { timeout: 120000 },
      )
      .toBe("pushpull");
    await settled();

    const fit = await page.evaluate(
      (id) => {
        const p = window.__store.getState().items.find((i) => i.id === id)
          .geometryData.positions;
        let ridge = -Infinity;
        let plate = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          if (p[i + 1] < -0.2) ridge = Math.max(ridge, p[i]);
          plate = Math.max(plate, p[i]);
        }
        return { ridgeW: +(ridge * 20).toFixed(2), plateW: +(plate * 20).toFixed(2) };
      },
      lidId,
    );
    const opening = P0.BoxWidth - 2 * P0.WallThickness;
    // Clearance on BOTH sides, and the plate itself must not have shrunk.
    expect(fit.ridgeW).toBeCloseTo(opening - 2 * P0.Clearance, 1);
    expect(fit.plateW).toBeCloseTo(P0.BoxWidth, 1);
  });

  test("four M3 threaded screw holes are tapped into the finished lid", async () => {
    test.setTimeout(300000); // four real helix sweeps

    // Tapped LAST, after the union and the push/pull. Not a stylistic choice:
    // a boolean whose input already carries four helical thread surfaces fails
    // outright ("performCsg: Error"), so the threads have to come after every
    // boolean -- which is also the order a real part is made in.
    //
    // The lid's baked frame is X width, Y thickness, Z depth, so the tap goes
    // in through +Y. Positions are read from the CURRENT mesh: the push/pull
    // re-centred it.
    const tap = (i) =>
      page.evaluate(
        ({ id, wallMm, i }) => {
          const p = window.__store.getState().items.find((it) => it.id === id)
            .geometryData.positions;
          const lo = [Infinity, Infinity, Infinity];
          const hi = [-Infinity, -Infinity, -Infinity];
          for (let a = 0; a < p.length; a += 3)
            for (let b = 0; b < 3; b++) {
              lo[b] = Math.min(lo[b], p[a + b]);
              hi[b] = Math.max(hi[b], p[a + b]);
            }
          const t = wallMm / 2 / 10; // centred on the wall below
          const xz = [
            [lo[0] + t, lo[2] + t],
            [hi[0] - t, lo[2] + t],
            [hi[0] - t, hi[2] - t],
            [lo[0] + t, hi[2] - t],
          ][i];
          return { x: xz[0], y: hi[1], z: xz[1] };
        },
        { id: lidId, wallMm: P0.WallThickness, i },
      );

    for (let i = 0; i < 4; i++) {
      const c = await tap(i);
      await page.evaluate(
        ({ id, c, dia, pitch, len }) => {
          const s = window.__store.getState();
          s.startHoleTool();
          s.setHoleFace(id, { normal: { x: 0, y: 1, z: 0 }, point: c });
          s.setHolePoint(c);
          // Authored FROM the variables rather than as formulas: buildHoleShape
          // divides h.length by MM_PER_UNIT, so a formula string arrives NaN.
          s.updateHoleParams({
            threaded: true,
            threadType: "M3",
            diameterMm: dia,
            pitchMm: pitch,
            toleranceMm: 0.1,
            lengthMm: len,
          });
        },
        {
          id: lidId,
          c,
          dia: P0.ScrewDia,
          pitch: P0.ScrewPitch,
          len: P0.LidThickness + 2,
        },
      );
      await expect(page.locator(".sketch-distance-input-overlay")).toBeVisible();
      await page.getByTitle("Cut the hole").click();
      await expect
        .poll(() => page.evaluate(() => !!window.__store.getState().holeTool), {
          timeout: 120000,
        })
        .toBe(false);
      await settled();
    }

    const holeSteps = await page.evaluate(
      () =>
        window.__store.getState().history.filter((h) => h.label === "Hole")
          .length,
    );
    expect(holeSteps).toBe(4);

    // All FOUR are really cut. A recorded step proves nothing: a hole that cuts
    // nothing still reports kind "hole" and leaves a well-formed body -- which
    // is exactly what the preview-cancels-the-commit bug used to produce.
    const boreHits = await page.evaluate(
      ({ id, wallMm }) => {
        const p = window.__store.getState().items.find((i) => i.id === id)
          .geometryData.positions;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let a = 0; a < p.length; a += 3)
          for (let b = 0; b < 3; b++) {
            lo[b] = Math.min(lo[b], p[a + b]);
            hi[b] = Math.max(hi[b], p[a + b]);
          }
        const t = wallMm / 2 / 10;
        return [
          [lo[0] + t, lo[2] + t],
          [hi[0] - t, lo[2] + t],
          [hi[0] - t, hi[2] - t],
          [lo[0] + t, hi[2] - t],
        ].map(([cx, cz]) => {
          let n = 0;
          for (let a = 0; a < p.length; a += 3)
            if (Math.hypot(p[a] - cx, p[a + 2] - cz) < 0.25) n++;
          return n;
        });
      },
      { id: lidId, wallMm: P0.WallThickness },
    );
    expect(boreHits.every((n) => n > 0)).toBe(true);
  });

  test("changing the parameters rebuilds the whole part", async () => {
    test.setTimeout(300000);
    // Every dimension moves at once, including the wall and ridge thicknesses
    // that only exist as sketch offsets, so nothing can pass by being ignored.
    // Everything except BoxHeight, which gets its own test below: the lid
    // seats at a FIXED sketch y, so raising the box would leave it floating.
    // WallThickness grows rather than shrinks -- the screw bore has to keep
    // fitting inside the wall.
    const P1 = {
      ...P0,
      BoxWidth: 90,
      BoxDepth: 55,
      WallThickness: 5,
      LidThickness: 4,
      RidgeHeight: 6,
    };
    await setVars(P1);
    await page.waitForTimeout(600);
    await settled();

    const base = await waitBbox(boxBaseId);
    expect(base.w).toBeCloseTo(P1.BoxWidth, 0);
    expect(base.d).toBeCloseTo(P1.BoxDepth, 0);
    expect(base.h).toBeCloseTo(P1.BoxHeight, 0); // unchanged here

    const lid = await waitBbox(lidId);
    expect(lid.w).toBeCloseTo(P1.BoxWidth, 0);
    expect(lid.d).toBeCloseTo(P1.BoxDepth, 0);
    // The ridge extrude's depth is "LidThickness + RidgeHeight", so BOTH
    // parameters have to have re-resolved for this to land.
    expect(lid.h).toBeCloseTo(P1.LidThickness + P1.RidgeHeight, 0);

    // The mate has to SURVIVE the change, not just have been right once: the
    // wall ring and the ridge are independent offsets that both re-derive from
    // the new WallThickness.
    const mate = await page.evaluate(() => {
      const items = window.__store.getState().items;
      const spanOf = (sketchId, from) => {
        const sh = items.find((i) => i.id === sketchId).shapes.slice(from, from + 4);
        const xs = sh.flatMap((l) => [l.x1, l.x2]);
        const ys = sh.flatMap((l) => [l.y1, l.y2]);
        return {
          w: (Math.max(...xs) - Math.min(...xs)) * 10,
          d: (Math.max(...ys) - Math.min(...ys)) * 10,
        };
      };
      return { boxInner: spanOf(100, 4), ridgeOuter: spanOf(130, 4) };
    });
    expect(mate.boxInner.w).toBeCloseTo(P1.BoxWidth - 2 * P1.WallThickness, 1);
    expect(mate.boxInner.d).toBeCloseTo(P1.BoxDepth - 2 * P1.WallThickness, 1);
    expect(mate.ridgeOuter.w).toBeCloseTo(mate.boxInner.w, 1);
    expect(mate.ridgeOuter.d).toBeCloseTo(mate.boxInner.d, 1);

    // The screw holes are still there afterwards. They do NOT resize -- hole
    // recipes store resolved numbers (see header) -- so this asserts survival
    // of the rebuild, not parametric behaviour.
    expect(
      await page.evaluate(
        () =>
          window.__store.getState().history.filter((h) => h.label === "Hole")
            .length,
      ),
    ).toBe(4);
  });

  test("raising the wall height rebuilds the box, and the lid does not follow", async () => {
    test.setTimeout(300000);
    const seatMm = P0.BoxHeight; // where the lid sketches were placed
    await setVars({ ...P0, BoxWidth: 90, BoxDepth: 55, WallThickness: 5, LidThickness: 4, RidgeHeight: 6, BoxHeight: 60 });
    await page.waitForTimeout(600);
    await settled();

    const base = await waitBbox(boxBaseId);
    expect(base.h).toBeCloseTo(60, 0);

    // The lid stayed at the old wall top. Sketch positions are plain numbers,
    // so a lid built ON a face does not track that face -- it has to be
    // re-seated. Asserted rather than glossed over: if positions ever become
    // parametric this test should start failing and be tightened.
    const lidY = await page.evaluate(
      () => window.__store.getState().items.find((i) => i.id === 120).position.y * 10,
    );
    expect(lidY).toBeCloseTo(seatMm, 1);
    expect(lidY).toBeLessThan(60);
  });
});
