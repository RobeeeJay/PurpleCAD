// A vase, built from the features a vase actually needs: a curved profile spun
// on the lathe, a chamfer round the foot, a bevel on the inside of the rim
// only, and a pattern pressed into the outside wall.
//
// Ends by writing test-results/parts/vase.stl (see e2e/exportPart.js) -- open
// it in Preview. Dimension assertions cannot tell a vase from a bucket.
import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import { exportPartPcad, importPartPcad } from "./exportPart.js";

// A 2x2 PNG -- enough to displace a surface without dragging an asset around.
const PNG_2x2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/AwMDhAIAHfoE/mYCn2AAAAAASUVORK5CYII=";

let app;
let page;
let vaseId;
let vasePcad;

const MM = 10; // MM_PER_UNIT
const V = {
  height: 120,
  baseR: 25,
  bellyR: 42,
  neckR: 24,
  wall: 4,
  floor: 6,
};

// Quadratic Bezier from base to neck, pulled out by a belly control point:
// the silhouette is a real curve, not a cone, so the lathe has something to
// show. The curve does NOT pass through the control point, so the widest
// radius is derived from the sampled profile rather than assumed to be bellyR.
const SEGMENTS = 28;
const outerR = (t) => {
  const p0 = V.baseR / MM;
  const p1 = (V.bellyR * 1.12) / MM; // control point, pulled out to bulge
  const p2 = V.neckR / MM;
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
};

// Closed cross-section, revolved about x = 0:
//   axis floor -> outside up the curve -> across the rim -> inside back down
//   -> across the floor. Touching x = 0 gives the vase a solid bottom.
const profilePoints = () => {
  const H = V.height / MM;
  const w = V.wall / MM;
  const f = V.floor / MM;
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pts.push({ x: outerR(t), y: t * H });
  }
  for (let i = SEGMENTS; i >= 0; i--) {
    const t = i / SEGMENTS;
    const y = t * H;
    if (y < f) break;
    pts.push({ x: Math.max(outerR(t) - w, 0.05), y });
  }
  pts.push({ x: 0, y: f });
  return pts;
};

const settled = async () =>
  await expect(page.getByText(/Recalculating/)).toBeHidden({ timeout: 120000 });

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
    return {
      w: +((hi[0] - lo[0]) * 10).toFixed(1),
      h: +((hi[1] - lo[1]) * 10).toFixed(1),
      d: +((hi[2] - lo[2]) * 10).toFixed(1),
      lo: lo.map((v) => +(v * 10).toFixed(1)),
      hi: hi.map((v) => +(v * 10).toFixed(1)),
    };
  }, id);

// Widest radius among vertices in a thin horizontal slice, in mm. This is how
// the tests tell WHERE a feature landed -- a triangle count only says that
// something changed somewhere.
const radiusAt = (id, yMm, tolMm = 1.5) =>
  page.evaluate(
    ({ n, yMm, tolMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let lo = Infinity;
      for (let i = 1; i < p.length; i += 3) lo = Math.min(lo, p[i]);
      let best = 0;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - lo) * 10; // mm above the body's own base
        if (Math.abs(y - yMm) > tolMm) continue;
        best = Math.max(best, Math.hypot(p[i], p[i + 2]) * 10);
      }
      return +best.toFixed(2);
    },
    { n: id, yMm, tolMm },
  );

// Narrowest radius among vertices in a thin slice, in mm -- the bore.
const boreAt = (id, yMm, tolMm = 0.6) =>
  page.evaluate(
    ({ n, yMm, tolMm }) => {
      const p = window.__store.getState().items.find((i) => i.id === n)
        .geometryData.positions;
      let lo = Infinity;
      for (let i = 1; i < p.length; i += 3) lo = Math.min(lo, p[i]);
      let best = Infinity;
      for (let i = 0; i < p.length; i += 3) {
        const y = (p[i + 1] - lo) * 10;
        if (Math.abs(y - yMm) > tolMm) continue;
        best = Math.min(best, Math.hypot(p[i], p[i + 2]) * 10);
      }
      return Number.isFinite(best) ? +best.toFixed(2) : null;
    },
    { n: id, yMm, tolMm },
  );

const tris = (id) =>
  page.evaluate(
    (n) =>
      (window.__store.getState().items.find((i) => i.id === n)?.geometryData
        ?.indices.length ?? 0) / 3,
    id,
  );

test.describe.serial("vase", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the lathe spins a curved profile into a hollow vase", async () => {
    const pts = profilePoints();
    await page.evaluate(
      ({ pts, H }) => {
        const s = window.__store.getState();
        // The profile as edges, plus the spin axis as the LAST shape.
        const shapes = pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length];
          return { type: "line", x1: p.x, y1: p.y, x2: q.x, y2: q.y };
        });
        const axisIdx = shapes.length;
        shapes.push({ type: "line", x1: 0, y1: -1, x2: 0, y2: H + 1 });
        s.addItem(
          {
            id: 800,
            type: "sketch",
            name: "Vase Profile",
            children: [],
            parentId: null,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 }, // XY plane; +Y is the spin axis
            scale: { x: 1, y: 1, z: 1 },
            shapes,
            constraints: [],
          },
          "Added",
        );
        s.selectItem(800);
        window.__axisIdx = axisIdx;
      },
      { pts, H: V.height / MM },
    );
    await page.waitForTimeout(1200);

    await page.evaluate(
      ({ pts }) => {
        const s = window.__store.getState();
        s.startSweepTool("revolve");
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        s.setSweepProfile({
          sketchId: 800,
          profileCentroid: { x: cx, y: cy },
          polygon2D: pts,
          holes: [],
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          normalWorld: { x: 0, y: 0, z: 1 },
        });
        s.setSweepAxis({ sketchId: 800, shapeIdx: window.__axisIdx });
      },
      { pts },
    );
    await page.evaluate(() =>
      window.__store.getState()._cameraControls.commitSweep(),
    );
    await settled();
    await page.waitForTimeout(1500);

    vaseId = await page.evaluate(
      () =>
        window.__store
          .getState()
          .items.filter((i) => i.type === "csg" && i.geometryData?.positions?.length)
          .pop()?.id ?? null,
    );
    expect(vaseId).not.toBeNull();

    const b = await bbox(vaseId);
    const maxR = Math.max(...pts.map((p) => p.x)) * MM;
    // The body matches the profile that was spun, and is round about the axis.
    expect(b.w).toBeCloseTo(maxR * 2, -1);
    expect(b.d).toBeCloseTo(maxR * 2, -1);
    expect(b.h).toBeCloseTo(V.height, -1);
    // And it is genuinely bellied: wider in the middle than at either end.
    expect(maxR).toBeGreaterThan(V.baseR + 5);
    expect(maxR).toBeGreaterThan(V.neckR + 5);
    // A lathed curve tessellates to far more than a cylinder would.
    expect(await tris(vaseId)).toBeGreaterThan(200);
  });

  test("a chamfer runs round the foot", async () => {
    const before = await bbox(vaseId);
    const beforeTris = await tris(vaseId);
    // The body is bbox-centred, so the foot ring sits at the bottom of its own
    // local box at the base radius. A revolved circular edge reports its seam
    // point for both endpoints.
    const yBottom = before.lo[1] / MM;
    const r = V.baseR / MM;
    await page.evaluate(
      ({ id, r, y }) => {
        const s = window.__store.getState();
        s.setSelectedSubGeometry({
          itemId: id,
          edges: [{ ax: r, ay: y, az: 0, bx: r, by: y, bz: 0 }],
          faces: [],
        });
        s.setChamferSelectMode("chamfer");
      },
      { id: vaseId, r, y: yBottom },
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("3");
    await page.getByTitle("Confirm — apply the chamfer").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.__store.getState().items.find((i) => i.id === id)
                ?.regenerator?.kind ?? null,
            vaseId,
          ),
        { timeout: 120000 },
      )
      .toBe("chamfer");
    await settled();

    const after = await bbox(vaseId);
    // A chamfer only removes material: the body cannot have grown.
    expect(after.w).toBeLessThanOrEqual(before.w + 0.5);
    expect(await tris(vaseId)).toBeGreaterThan(beforeTris);

    // It landed on the FOOT specifically, and by the amount asked for: the
    // bottom ring is pulled in by exactly the chamfer size, while the belly
    // above is untouched. Slice sampling is vertex-based, so read the base ring
    // itself rather than a height that may fall between rings.
    expect(await radiusAt(vaseId, 0, 0.6)).toBeCloseTo(V.baseR - 3, 0);
    expect(after.w / 2).toBeGreaterThan(V.baseR + 5); // belly still proud
  });

  test("a bevel softens the inside of the rim only", async () => {
    const beforeOuter = await radiusAt(vaseId, V.height, 0.6);
    const beforeBore = await boreAt(vaseId, V.height);
    const beforeTris = await tris(vaseId);
    // A BEVEL is a chamfer, not a fillet. The rim is an annulus with TWO
    // circular edges; picking the inner one by its own radius is what makes
    // this inside-only, and the outer lip must come through untouched -- which
    // the assertions below check rather than assume.
    const b = await bbox(vaseId);
    const yTop = b.hi[1] / MM;
    const rInner = (V.neckR - V.wall) / MM;
    await page.evaluate(
      ({ id, r, y }) => {
        const s = window.__store.getState();
        s.setSelectedSubGeometry({
          itemId: id,
          edges: [{ ax: r, ay: y, az: 0, bx: r, by: y, bz: 0 }],
          faces: [],
        });
        s.setChamferSelectMode("chamfer");
      },
      { id: vaseId, r: rInner, y: yTop },
    );
    const overlay = page.locator(".sketch-distance-input-overlay");
    await expect(overlay).toBeVisible();
    await overlay.locator("input").first().fill("2");
    await page.getByTitle("Confirm — apply the chamfer").click();
    // The foot chamfer was also a "chamfer", so the kind alone proves nothing.
    // Wait for a SECOND chamfer step to appear in the timeline.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .history.filter((h) => /chamfer/i.test(h.label ?? "")).length,
          ),
        { timeout: 120000 },
      )
      .toBe(2);
    await settled();

    expect(await tris(vaseId)).toBeGreaterThan(beforeTris);
    // INSIDE only, in both directions. The bore has opened up at the rim by
    // the bevel size -- proving the op landed, which "outer unchanged" alone
    // would not, since a failed op leaves everything unchanged too...
    const afterBore = await boreAt(vaseId, V.height);
    expect(beforeBore).toBeCloseTo(V.neckR - V.wall, 0);
    expect(afterBore).toBeCloseTo(beforeBore + 2, 0);
    // ...and the outer lip is exactly where it was.
    const afterOuter = await radiusAt(vaseId, V.height, 0.6);
    expect(afterOuter).toBeCloseTo(beforeOuter, 0);
  });

  test("a pattern wraps around the outside wall", async () => {
    const beforeTris = await tris(vaseId);
    const beforeBore = await boreAt(vaseId, V.height / 2, 3);
    const b = await bbox(vaseId);
    // The outer wall is a surface of revolution, so it is described to the tool
    // as a cylinder about the vase's own axis at the belly radius. `conform`
    // with wrap makes the pattern follow the curve instead of being projected
    // flat onto it -- and wrap matters on a closed wall: it has to meet itself
    // at the seam.
    // Select the outer wall by its TRIANGLES rather than by a cylinder. A
    // cylinder faceSet matches faces within a hair of one radius, and this wall
    // curves away from any single radius -- it textured a band round the belly
    // and left the rest smooth. The wall is exactly the triangles whose outward
    // normal points away from the axis, so hand those over directly.
    const faceTris = await page.evaluate(
      ({ id, minR }) => {
        const g = window.__store.getState().items.find((i) => i.id === id)
          .geometryData;
        const p = g.positions;
        const idx = g.indices;
        const out = [];
        for (let t = 0; t < idx.length; t += 3) {
          const v = [0, 1, 2].map((k) => idx[t + k] * 3);
          const cx = (p[v[0]] + p[v[1]] + p[v[2]]) / 3;
          const cz = (p[v[0] + 2] + p[v[1] + 2] + p[v[2] + 2]) / 3;
          const r = Math.hypot(cx, cz);
          if (r < minR) continue; // skip the bore and the floor
          // Outward-facing only: normal . radial > 0.
          const ax = p[v[1]] - p[v[0]], ay = p[v[1] + 1] - p[v[0] + 1], az = p[v[1] + 2] - p[v[0] + 2];
          const bx = p[v[2]] - p[v[0]], by = p[v[2] + 1] - p[v[0] + 1], bz = p[v[2] + 2] - p[v[0] + 2];
          const nx = ay * bz - az * by, nz = ax * by - ay * bx;
          if (nx * cx + nz * cz <= 0) continue;
          for (const o of v) out.push(p[o], p[o + 1], p[o + 2]);
        }
        return out;
      },
      { id: vaseId, minR: (V.neckR - V.wall) / MM + 0.05 },
    );
    expect(faceTris.length / 9).toBeGreaterThan(50); // real wall coverage

    await page.evaluate(
      ({ id, png, faceTris }) => {
        const s = window.__store.getState();
        s.startTextureTool();
        s.setTextureFaceSelection({
          itemId: id,
          face: { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 },
          faceSet: null,
          faceTris,
          faceCount: faceTris.length / 9,
          valid: true,
          keepPicking: false,
        });
        s.updateTextureParams({
          png,
          pngName: "vase-pattern.png",
          wrap: true,
          projection: "conform",
          // Coarse on purpose: a fine displacement over a whole vase wall runs
          // into the triangle budget, and the point is that the feature
          // applies, not that it is pretty.
          resolutionMm: 1.0,
          depthMm: 3,
          sizeMm: 14,
        });
      },
      { id: vaseId, png: PNG_2x2, faceTris },
    );
    await page.waitForTimeout(1500); // debounced ghost settles

    await page.getByTitle("Confirm — apply the texture").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__store
                .getState()
                .history.filter((h) => /textur/i.test(h.label ?? "")).length,
          ),
        { timeout: 240000 },
      )
      .toBeGreaterThan(0);
    await settled();

    // The wall gained relief: far more triangles than the smooth body had.
    const afterTris = await tris(vaseId);
    expect(afterTris).toBeGreaterThan(beforeTris);
    // ...and it went on the OUTSIDE: the bore is untouched. Allow a millimetre
    // -- displacing re-meshes the WHOLE body, so the narrowest vertex found in
    // a slice of the bore moves a little even though the bore itself does not.
    // The pattern is 3mm deep; anything approaching that would mean it had cut
    // through to the inside.
    const afterBoreMid = await boreAt(vaseId, V.height / 2, 3);
    expect(Math.abs(afterBoreMid - beforeBore)).toBeLessThan(1.5);
  });

  test("the finished vase saves as a .pcad document", async ({}, testInfo) => {
    const { file, steps } = await exportPartPcad(page, testInfo, "vase");
    expect(file).toContain("vase.pcad");
    // Profile, revolve, two chamfers and the texture, plus "Scene created".
    expect(steps).toBeGreaterThanOrEqual(6);
    vasePcad = file;
  });

  test("the saved document reopens in PurpleCAD", async () => {
    // The check that matters: a document that cannot be reopened is not a
    // deliverable. Loading replays the timeline from scratch, so this also
    // proves the features rebuild rather than relying on the baked meshes.
    const before = await tris(vaseId);
    const after = await importPartPcad(page, vasePcad);
    expect(after.solids).toBeGreaterThan(0);
    expect(after.steps).toBeGreaterThanOrEqual(6);
    // The rebuilt vase is the same vase: same order of triangle count, not an
    // empty shell or a smooth body that lost its pattern.
    expect(after.tris).toBeGreaterThan(before * 0.5);
  });
});
