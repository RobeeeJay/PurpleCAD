// Rebuilding a mesh as exact faces.  The proof that a face is exact and not a
// good imitation is the volume: an exact cylinder bore encloses pi r^2 h, and
// the mesh it was rebuilt from, whose facets cut inside the curve, encloses
// visibly less.  So the rebuilt body must match the TRUE volume much more
// closely than the mesh does.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";

const occ = createRequire(import.meta.url)(
  "../../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const TOL = 0.001;

const meshOf = (id, resolution = 0.05) => {
  const m = occ.tessellate(id, resolution);
  occ.releaseShape(id);
  return { positions: Array.from(m.positions), indices: Array.from(m.indices) };
};

const rebuild = (mesh) =>
  ops.rebuildSurfaces({ ...mesh, tolerance: TOL, printPrecision: 0.05 });

const faces = (r) =>
  Object.entries(r.faceTypes)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");

describe("rebuilding a mesh as exact faces", () => {
  const exact = [
    {
      name: "a box with a bore",
      make: () =>
        occ.booleanOp(
          [occ.makeBox(-2, -1, -2, 2, 1, 2), occ.makeCylinder(-2, 0.7, 4)],
          "difference",
        ),
      faces: "6 plane, 1 cylinder",
      volume: 32 - Math.PI * 0.49 * 2,
    },
    {
      name: "a sphere",
      make: () => occ.makeSphere(1.5),
      faces: "1 sphere",
      volume: (4 / 3) * Math.PI * 1.5 ** 3,
    },
    {
      name: "a torus",
      make: () => occ.makeTorus(2, 0.5),
      faces: "1 torus",
      volume: 2 * Math.PI ** 2 * 2 * 0.25,
    },
    {
      name: "a cone",
      make: () => occ.makeCone(-1, 1, 0.4, 2),
      faces: "2 plane, 1 cone",
      volume: (Math.PI * 2 * (1 + 0.4 + 0.16)) / 3,
    },
  ];
  for (const c of exact)
    it(`gives ${c.name} its exact faces and its true volume`, () => {
      const r = rebuild(meshOf(c.make()));
      expect(faces(r), "faces").toBe(c.faces);
      // Joined by the shared edges themselves, not rescued by sewing.
      expect(r.sewn, "needed the sewing fallback").toBe(false);
      const meshErr = Math.abs(r.meshVolume - c.volume);
      const exactErr = Math.abs(r.volume - c.volume);
      expect(
        exactErr,
        `volume ${r.volume} against ${c.volume}; the mesh was ${r.meshVolume}`,
      ).toBeLessThan(meshErr / 10);
    });

  it("keeps a fillet round a rim as a torus, with tight edges", () => {
    // The fillet runs tangentially into the side and the top, and its mesh
    // has long chords across the flattest stretch that no surface holds:
    // those stay triangles, and the rest must still close up tight.
    const cyl = occ.makeCylinder(-1, 1, 2);
    const filleted = occ.filletShape(
      cyl,
      { edges: [{ ax: 1, ay: 1, az: 0, bx: 1, by: 1, bz: 0 }] },
      0.3,
    );
    occ.releaseShape(cyl);
    const r = rebuild(meshOf(filleted));
    expect(r.faceTypes.torus, `faces ${faces(r)}`).toBe(1);
    expect(r.faceTypes.cylinder, `faces ${faces(r)}`).toBe(1);
    expect(r.faceTypes.plane, `faces ${faces(r)}`).toBe(2);
    expect(r.maxEdgeTolerance, "loosest edge").toBeLessThan(2 * TOL);
  });

  it("hands back a body that reopens from its BREP text", () => {
    const r = rebuild(meshOf(occ.makeSphere(1.5)));
    const id = occ.shapeFromBrep(r.brep);
    try {
      expect(occ.shapeVolume(id)).toBeCloseTo(r.volume, 9);
    } finally {
      occ.releaseShape(id);
    }
    expect(r.geometryData.indices.length).toBeGreaterThan(0);
  });

  it("refuses a mesh with a hole in it", () => {
    // A solid can't be made of an open surface; the caller keeps the mesh.
    const m = meshOf(occ.makeBox(-1, -1, -1, 1, 1, 1));
    m.indices = m.indices.slice(3);
    expect(() => rebuild(m)).toThrow(/not closed/);
  });

  it("refuses a mesh over the size limit before starting", () => {
    // 100,001 triangles of soup: the refusal must come first, not after
    // minutes of work.
    const positions = new Array(100001 * 9).fill(0).map((_, i) => i % 7);
    const t = Date.now();
    expect(() => rebuild({ positions, indices: null })).toThrow(
      /too many triangles/,
    );
    expect(Date.now() - t, "ms to refuse").toBeLessThan(2000);
  });
});
