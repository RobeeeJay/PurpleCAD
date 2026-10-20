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

// A 40 x 40 slab whose top is the smooth z = 10 + 2 sin(x/5) cos(y/7),
// sampled every `step`, each top vertex moved up or down by up to `jitter`.
const slab = (step, jitter = 0) => {
  let seed = 1;
  const rand = () =>
    ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const n = Math.round(40 / step);
  const top = (i, j) => i * (n + 1) + j;
  const bot = (i, j) => (n + 1) * (n + 1) + i * (n + 1) + j;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const [x, y] = [j * step, i * step];
      positions.push(
        x,
        y,
        10 + 2 * Math.sin(x / 5) * Math.cos(y / 7) + jitter * rand(),
      );
    }
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) positions.push(j * step, i * step, 0);
  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      quad(top(i, j), top(i, j + 1), top(i + 1, j + 1), top(i + 1, j));
      quad(bot(i, j), bot(i + 1, j), bot(i + 1, j + 1), bot(i, j + 1));
    }
  for (let k = 0; k < n; k++) {
    quad(top(0, k), bot(0, k), bot(0, k + 1), top(0, k + 1));
    quad(top(n, k), top(n, k + 1), bot(n, k + 1), bot(n, k));
    quad(top(k, 0), top(k + 1, 0), bot(k + 1, 0), bot(k, 0));
    quad(top(k, n), bot(k, n), bot(k + 1, n), top(k + 1, n));
  }
  return { positions, indices };
};

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
      name: "an oval prism",
      make: () => {
        const p = [];
        for (let i = 0; i < 96; i++) {
          const t = (i / 96) * 2 * Math.PI;
          p.push(1.35 * Math.cos(t), 1.2 * Math.sin(t));
        }
        return occ.makeExtrude(new Float64Array(p), [], 0, 0, 2);
      },
      faces: "2 plane, 1 ellipticCylinder",
      volume: Math.PI * 1.35 * 1.2 * 2,
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

  it("joins a flat top to a curved front along their real curve, not a chord", () => {
    // As in real STLs: a stepped block whose front is four strips of a
    // radius-8 cylinder.  The higher top, over the first strip only, meets the
    // front along that strip's end alone -- a straight chord between two
    // corners, sagging 0.035 off the cylinder.  The edge there must be the
    // curve where the plane and the cylinder really meet.
    const R = 8,
      H = 4,
      H2 = 3,
      D = -20;
    const zf = (x) => Math.sqrt(R * R - x * x) - 5;
    const P = [];
    const ids = new Map();
    const v = (x, y, z) => {
      const k = `${x},${y},${z}`;
      if (!ids.has(k)) {
        ids.set(k, P.length / 3);
        P.push(x, y, z);
      }
      return ids.get(k);
    };
    const f = (x, y) => v(x, y, zf(x));
    // Convex planar polygons, each with the way it faces outward, fanned from
    // their first corner (never one with collinear neighbours: that fan's first
    // triangle would have no area).
    const polys = [
      [
        [f(-3, 0), f(-1.5, 0), f(-1.5, H2), f(-1.5, H), f(-3, H)],
        [0, 0, 1],
      ],
      [
        [f(-1.5, 0), f(0, 0), f(0, H2), f(-1.5, H2)],
        [0, 0, 1],
      ],
      [
        [f(0, 0), f(1.5, 0), f(1.5, H2), f(0, H2)],
        [0, 0, 1],
      ],
      [
        [f(1.5, 0), f(3, 0), f(3, H2), f(1.5, H2)],
        [0, 0, 1],
      ],
      [
        [f(-3, H), f(-1.5, H), v(-1.5, H, D), v(-3, H, D)],
        [0, 1, 0],
      ],
      [
        [
          f(-1.5, H2),
          f(0, H2),
          f(1.5, H2),
          f(3, H2),
          v(3, H2, D),
          v(-1.5, H2, D),
        ],
        [0, 1, 0],
      ],
      [
        [f(-1.5, H2), v(-1.5, H2, D), v(-1.5, H, D), f(-1.5, H)],
        [1, 0, 0],
      ],
      [
        [f(-3, 0), f(-3, H), v(-3, H, D), v(-3, 0, D)],
        [-1, 0, 0],
      ],
      [
        [f(3, 0), v(3, 0, D), v(3, H2, D), f(3, H2)],
        [1, 0, 0],
      ],
      [
        [
          v(-3, 0, D),
          v(-3, H, D),
          v(-1.5, H, D),
          v(-1.5, H2, D),
          v(-1.5, 0, D),
        ],
        [0, 0, -1],
      ],
      [
        [v(-1.5, 0, D), v(-1.5, H2, D), v(3, H2, D), v(3, 0, D)],
        [0, 0, -1],
      ],
      [
        [
          f(-3, 0),
          v(-3, 0, D),
          v(-1.5, 0, D),
          v(3, 0, D),
          f(3, 0),
          f(1.5, 0),
          f(0, 0),
          f(-1.5, 0),
        ],
        [0, -1, 0],
      ],
    ];
    const indices = [];
    for (const [poly, out] of polys)
      for (let i = 1; i + 1 < poly.length; i++) {
        const t = [poly[0], poly[i], poly[i + 1]];
        const p = (k) => P.slice(3 * k, 3 * k + 3);
        const u = p(t[1]).map((x, j) => x - p(t[0])[j]);
        const w = p(t[2]).map((x, j) => x - p(t[0])[j]);
        const n = [
          u[1] * w[2] - u[2] * w[1],
          u[2] * w[0] - u[0] * w[2],
          u[0] * w[1] - u[1] * w[0],
        ];
        const dot = n[0] * out[0] + n[1] * out[1] + n[2] * out[2];
        if (Math.hypot(...n) < 1e-12) continue;
        indices.push(...(dot > 0 ? t : [t[0], t[2], t[1]]));
      }
    const r = rebuild({ positions: P, indices });
    expect(r.faceTypes.cylinder, `faces ${faces(r)}`).toBe(1);
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

  it("gives each separate body in one mesh a solid of its own", () => {
    // An STL can hold several bodies -- a fin and its two plugs -- and one
    // shell of all their faces is refused as not connected.
    const a = meshOf(occ.makeBox(-3, -1, -1, -1, 1, 1));
    const b = meshOf(occ.makeSphere(1));
    const n = a.positions.length / 3;
    const r = rebuild({
      positions: [
        ...a.positions,
        ...b.positions.map((x, i) => (i % 3 === 0 ? x + 3 : x)),
      ],
      indices: [...a.indices, ...b.indices.map((i) => i + n)],
    });
    expect(faces(r), "faces").toBe("6 plane, 1 sphere");
    const volume = 8 + (4 / 3) * Math.PI;
    expect(
      Math.abs(r.volume - volume),
      `volume ${r.volume} against ${volume}`,
    ).toBeLessThan(0.01);
  });

  it("keeps a cavity inside the body around it", () => {
    // The cavity's faces face inward, as the mesh winds them: it is taken
    // out of the box, not added as a second body.
    const r = rebuild(
      meshOf(
        occ.booleanOp(
          [occ.makeBox(-2, -2, -2, 2, 2, 2), occ.makeBox(-1, -1, -1, 1, 1, 1)],
          "difference",
        ),
      ),
    );
    expect(faces(r), "faces").toBe("12 plane");
    expect(r.volume, "volume").toBeCloseTo(64 - 8, 6);
  });

  it("rebuilds a smooth freeform top as B-spline faces, close to its true volume", () => {
    // No plane, cylinder, cone, sphere or torus holds a sin x cos surface;
    // its pieces used to stay triangles or local fits whose faces failed
    // (300 triangles at this sampling, a sphere patch taking the rest of its
    // sphere among them).
    const r = ops.rebuildSurfaces({
      ...slab(1),
      tolerance: 0.01,
      printPrecision: 0.05,
    });
    expect(r.faceTypes.bspline, `faces ${faces(r)}`).toBeGreaterThan(0);
    expect(r.faceTypes.triangle, `faces ${faces(r)}`).toBeLessThan(100);
    // 40 x 40 x 10, plus the integral of the bumps.
    const volume = 16000 + 2 * (5 * (1 - Math.cos(8))) * (7 * Math.sin(40 / 7));
    expect(
      Math.abs(r.volume - volume),
      `volume ${r.volume} against ${volume}`,
    ).toBeLessThan(2);
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
