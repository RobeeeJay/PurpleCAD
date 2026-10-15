// Convert to Surfaces as a timeline step: a mesh body's recipe becomes the
// exact shape rebuilt from its mesh, carried as BREP text, so a recalculation
// at a finer Resolution draws real curves and a later op builds on them --
// not on the triangles it started as.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../occ/init.js";
import { ops } from "../occOps.js";
import { convertSource } from "../regenerators/modify.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { convertSummary } from "../../components/ConvertSurfacesDialog.jsx";

const occ = createRequire(import.meta.url)(
  "../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A coarse cylinder mesh body, as an import of one would be: radius 1, y
// from -1 to 1, sixteen facets round, whose middles sit 0.019 inside.
const SIDES = 16;
const meshBody = () => {
  const positions = [0, -1, 0, 0, 1, 0];
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * 2 * Math.PI;
    positions.push(Math.cos(a), -1, Math.sin(a), Math.cos(a), 1, Math.sin(a));
  }
  const lo = (i) => 2 + 2 * (i % SIDES),
    hi = (i) => 3 + 2 * (i % SIDES);
  const indices = [];
  for (let i = 0; i < SIDES; i++) {
    indices.push(0, lo(i), lo(i + 1), 1, hi(i + 1), hi(i));
    indices.push(lo(i), hi(i), hi(i + 1), lo(i), hi(i + 1), lo(i + 1));
  }
  return {
    id: 7,
    type: "csg",
    name: "Imported",
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    geometryData: { positions, indices },
  };
};

const converted = async (body) => {
  const r = await convertSource(body, { toleranceMm: 0.01 }, 0.2);
  return {
    ...body,
    geometryData: r.geometryData,
    regenerator: {
      kind: "meshToSurfaces",
      toleranceMm: 0.01,
      brep: r.brep,
      stats: r.stats,
      source: body,
      basePosition: body.position,
      regeneratedAt: 0.2,
    },
  };
};

// How far the middles of the side wall's facets sit inside the true radius
// 1: an exact cylinder drawn at Resolution 0.01 sags no more than that, the
// coarse mesh's chords far more.
const wallSag = (g) => {
  let worst = 0;
  const p = (t, j) =>
    g.positions.slice(3 * g.indices[3 * t + j], 3 * g.indices[3 * t + j] + 3);
  for (let t = 0; t < g.indices.length / 3; t++) {
    const [a, b, c] = [p(t, 0), p(t, 1), p(t, 2)];
    const u = b.map((x, i) => x - a[i]),
      w = c.map((x, i) => x - a[i]);
    const ny = u[2] * w[0] - u[0] * w[2];
    const nl = Math.hypot(
      u[1] * w[2] - u[2] * w[1],
      ny,
      u[0] * w[1] - u[1] * w[0],
    );
    // The wall's facets face across the axis (y); the caps' along it.
    if (nl === 0 || Math.abs(ny / nl) > 0.1) continue;
    const m = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
    worst = Math.max(worst, 1 - Math.hypot(m[0], m[2]));
  }
  return worst;
};

describe("a converted mesh body", () => {
  it("is the exact cylinder its triangles approximated", async () => {
    const body = meshBody();
    const r = await convertSource(body, { toleranceMm: 0.01 }, 0.2);
    expect(r.stats.faceTypes).toMatchObject({
      plane: 2,
      cylinder: 1,
      triangle: 0,
    });
    // Radius 1, height 2 scene units: the true volume, where the 16-sided
    // mesh holds 2.4% less.
    expect(r.stats.volumeMm3 / 1000).toBeCloseTo(2 * Math.PI, 3);
    expect(r.stats.meshVolumeMm3 / 1000).toBeLessThan(2 * Math.PI * 0.98);
  });

  it("is drawn finer at a finer Resolution, from its curves", async () => {
    const body = meshBody();
    const item = await converted(body);
    const coarse = wallSag(body.geometryData);
    const [fine] = await regenerateItemsForResolution(
      [
        {
          ...item,
          regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
        },
      ],
      0.01,
    );
    expect(fine.regenerator.regenFailed, "rebuild refused").toBe(false);
    expect(fine.regenerator.brep, "BREP carried forward").toBeTruthy();
    const sag = wallSag(fine.geometryData);
    expect(sag, `wall sag at 0.01 (it was ${coarse} at 0.2)`).toBeLessThan(
      0.011,
    );
    expect(coarse, "the source mesh's own sag").toBeGreaterThan(0.015);
  });

  it("hands a later op its exact shape, not its mesh", async () => {
    // A later op builds the body with buildItemShapeLocal, at its own
    // Resolution.  Drawn coarsely here (its 16-sided source mesh), the body
    // must still come back as the exact cylinder from its BREP, drawn as
    // finely as asked -- sewn from its drawing, it would keep the chords.
    const body = meshBody();
    const item = {
      ...(await converted(body)),
      geometryData: body.geometryData,
    };
    const exact = ops.tessellateItem({
      source: item,
      allItems: [item],
      printPrecision: 0.01,
    });
    const sewn = ops.tessellateItem({
      source: body,
      allItems: [body],
      printPrecision: 0.01,
    });
    expect(wallSag(exact.geometryData), "built from the BREP").toBeLessThan(
      0.011,
    );
    expect(wallSag(sewn.geometryData), "built from the mesh").toBeGreaterThan(
      0.015,
    );
  });
});

describe("the dialog's summary", () => {
  it("counts faces and the triangles left", () => {
    expect(
      convertSummary({
        counts: {
          plane: 30,
          cylinder: 1,
          cone: 0,
          sphere: 0,
          torus: 2,
          ellipticCylinder: 0,
        },
        triangleCounts: { mesh: 168 },
      }),
    ).toBe("201 faces: 30 planes, 1 cylinder, 2 tori, 168 triangles left");
  });
});
