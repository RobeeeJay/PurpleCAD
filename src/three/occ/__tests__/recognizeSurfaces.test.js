// Recognising the surfaces an STL is made of, the first half of turning one
// into exact faces.  Every shape here is an exact OCC body meshed at a real
// Resolution, so the right answer is known: a converted part is only as good
// as this count, and a wrong "cylinder" would become a wrong exact face.
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

// Recognise an exact shape's own mesh at a Resolution.
const recognise = (id, resolution) => {
  const m = occ.tessellate(id, resolution);
  occ.releaseShape(id);
  return ops.recognizeSurfaces({
    positions: Array.from(m.positions),
    indices: Array.from(m.indices),
    tolerance: TOL,
  });
};

const found = (r) =>
  Object.entries(r.counts)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");

describe("recognising the surfaces of a mesh", () => {
  for (const res of [0.05, 0.01]) {
    it(`finds a box's six faces and its bore at Resolution ${res}`, () => {
      const box = occ.makeBox(-2, -1, -2, 2, 1, 2);
      const bore = occ.makeCylinder(-2, 0.7, 4);
      const r = recognise(occ.booleanOp([box, bore], "difference"), res);
      expect(found(r), "surfaces found").toBe("6 plane, 1 cylinder");
      const cyl = r.regions.find((g) => g.type === "cylinder");
      expect(
        Math.abs(cyl.radius - 0.7),
        `bore radius ${cyl.radius}, drilled at 0.7`,
      ).toBeLessThan(TOL);
    });

    it(`finds a cone between two caps at Resolution ${res}`, () => {
      const r = recognise(occ.makeCone(-1, 1, 0.4, 2), res);
      expect(found(r), "surfaces found").toBe("2 plane, 1 cone");
    });
  }

  it("finds a sphere as one surface, poles and all", () => {
    // OCC's sphere mesh has a row of slivers at each pole that weld onto a
    // line; each used to stand alone as a "plane" of zero area.
    const r = recognise(occ.makeSphere(1.5), 0.05);
    expect(found(r), "surfaces found").toBe("1 sphere");
    expect(
      Math.abs(r.regions[0].radius - 1.5),
      `sphere radius ${r.regions[0].radius}`,
    ).toBeLessThan(TOL);
  });

  it("finds a slot's round ends once its flat sides are taken away", () => {
    // The sides run tangentially into the ends, so sides and ends are one
    // smooth region that fits nothing.  Peeling the sides off leaves the two
    // ends as separate pieces, and each is a cylinder of its own.
    const p = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 16;
      p.push(2 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
    }
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 16;
      p.push(0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
    }
    const r = recognise(
      occ.makeExtrude(new Float64Array(p), [], 0, 0, 1),
      0.05,
    );
    expect(found(r), "surfaces found").toBe("4 plane, 2 cylinder");
  });

  it("separates two flat faces that meet at a shallow angle", () => {
    // A roof pitched 10 degrees each way: its two slopes are one smooth
    // region, and two patches of the same size never looked like "a plane
    // among facet strips" to the peeling.
    const t = Math.tan((10 * Math.PI) / 180);
    const house = [0, 0, 4, 0, 4, 1, 2, 1 + 2 * t, 0, 1];
    const r = recognise(
      occ.makeExtrude(new Float64Array(house), [], 0, 0, 3),
      0.05,
    );
    expect(found(r), "surfaces found").toBe("7 plane");
  });

  it("fits no curved surface through a handful of vertices", () => {
    // Four triangles across a slight bend: six vertices, which a cylinder or
    // a sphere passes through exactly whatever they are.
    const positions = [];
    for (let row = 0; row < 2; row++)
      for (let k = 0; k < 3; k++) {
        const a = (k * 4 * Math.PI) / 180;
        positions.push(5 * Math.cos(a), row, 5 * Math.sin(a) + 0.01 * k * k);
      }
    const indices = [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5];
    const r = ops.recognizeSurfaces({ positions, indices, tolerance: TOL });
    const curved = r.regions.filter(
      (g) => g.type !== "plane" && g.type !== "mesh",
    );
    expect(curved, `regions ${found(r)}`).toHaveLength(0);
  });

  for (const res of [0.05, 0.01]) {
    it(`finds a torus and both its radii at Resolution ${res}`, () => {
      const r = recognise(occ.makeTorus(2, 0.5), res);
      expect(found(r), "surfaces found").toBe("1 torus");
      const [t] = r.regions;
      expect(Math.abs(t.radius - 2), `major radius ${t.radius}`).toBeLessThan(
        TOL,
      );
      expect(
        Math.abs(t.minorRadius - 0.5),
        `minor radius ${t.minorRadius}`,
      ).toBeLessThan(TOL);
    });

    it(`finds a fillet round a rim as one torus at Resolution ${res}`, () => {
      // The fillet runs tangentially into the side and the top, so all three
      // are one smooth region, which nothing fits whole: it has to be grown
      // through surface by surface.  A patch of the fillet is a short arc of
      // its centre circle and fits a cylinder too, so this also checks the
      // torus is found from a longer arc and refined to its true radii.
      const cyl = occ.makeCylinder(-1, 1, 2);
      const filleted = occ.filletShape(
        cyl,
        { edges: [{ ax: 1, ay: 1, az: 0, bx: 1, by: 1, bz: 0 }] },
        0.3,
      );
      occ.releaseShape(cyl);
      const r = recognise(filleted, res);
      const tori = r.regions
        .filter((g) => g.type === "torus")
        .sort((a, b) => b.triangles - a.triangles);
      expect(tori.length, `regions ${found(r)}`).toBeGreaterThan(0);
      const [t] = tori;
      expect(
        [t.radius, t.minorRadius].map((x) => +x.toFixed(3)),
        "fillet's radii",
      ).toEqual([0.7, 0.3]);
      expect(
        t.triangles / r.triangleRegion.length,
        `share of the body in the fillet's torus (${found(r)})`,
      ).toBeGreaterThan(0.8);
      expect(r.triangleCounts.mesh, "triangles left unrecognised").toBe(0);
      // Top and bottom.  The top disc is meshed with every vertex on its rim,
      // which lies on the torus too: only its facets' middles, far off the
      // torus, keep the fillet from swallowing it.
      expect(r.counts.plane, `regions ${found(r)}`).toBe(2);
    });
  }

  it("keeps every vertex of a region on its surface, freeform included", () => {
    // The promise everything later relies on: a region's surface is never
    // more than the tolerance from any of its vertices.  A bumpy sphere is
    // no canonical surface, so what is found there is many small local fits,
    // and each must still hold.
    const positions = [];
    const seg = 64;
    const rad = (u, v) => 1 + 0.05 * Math.sin(5 * u) * Math.sin(4 * v);
    for (let i = 0; i <= seg; i++)
      for (let j = 0; j < seg; j++) {
        const v = (i / seg) * Math.PI;
        const u = (j / seg) * 2 * Math.PI;
        const r = rad(u, v);
        positions.push(
          r * Math.sin(v) * Math.cos(u),
          r * Math.cos(v),
          r * Math.sin(v) * Math.sin(u),
        );
      }
    const indices = [];
    const at = (i, j) => i * seg + (j % seg);
    for (let i = 0; i < seg; i++)
      for (let j = 0; j < seg; j++)
        (indices.push(at(i, j), at(i + 1, j), at(i, j + 1)),
          indices.push(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)));
    const r = ops.recognizeSurfaces({ positions, indices, tolerance: TOL });
    const dist = (g, p) => {
      const d = p.map((x, k) => x - g.point[k]);
      const t = d[0] * g.dir[0] + d[1] * g.dir[1] + d[2] * g.dir[2];
      const rho = Math.hypot(...d.map((x, k) => x - g.dir[k] * t));
      switch (g.type) {
        case "plane":
          return Math.abs(t);
        case "sphere":
          return Math.abs(Math.hypot(...d) - g.radius);
        case "cylinder":
          return Math.abs(rho - g.radius);
        case "cone":
          return (
            Math.abs(rho - (g.radius + Math.tan(g.halfAngle) * t)) *
            Math.cos(g.halfAngle)
          );
        case "torus":
          return Math.abs(Math.hypot(rho - g.radius, t) - g.minorRadius);
      }
      return 0;
    };
    // Indices refer to the WELDED mesh, whose triangles are the input's in
    // order, so the input's corners can be read directly.
    let worst = 0;
    r.triangleRegion.forEach((g, t) => {
      const reg = r.regions[g];
      if (reg.type === "mesh") return;
      for (let k = 0; k < 3; k++) {
        const v = indices[3 * t + k];
        worst = Math.max(worst, dist(reg, positions.slice(3 * v, 3 * v + 3)));
      }
    });
    expect(worst, `worst vertex off its surface (${found(r)})`).toBeLessThan(
      TOL * 1.0001,
    );
    // Near a line, a thin facet is within the tolerance of a plane at almost
    // any tilt, so a flat region also needs its facets facing its way; and a
    // torus has to be the ring kind, the only one a face can be built on.
    const cosFlat = Math.cos((0.5 * Math.PI) / 180);
    let worstTilt = 1;
    r.triangleRegion.forEach((g, t) => {
      const reg = r.regions[g];
      if (reg.type !== "plane") return;
      const p = [0, 1, 2].map((k) =>
        positions.slice(3 * indices[3 * t + k], 3 * indices[3 * t + k] + 3),
      );
      const u = p[1].map((x, i) => x - p[0][i]);
      const w = p[2].map((x, i) => x - p[0][i]);
      const n = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const l = Math.hypot(...n);
      if (l < 1e-12) return;
      const c =
        Math.abs(n[0] * reg.dir[0] + n[1] * reg.dir[1] + n[2] * reg.dir[2]) / l;
      worstTilt = Math.min(worstTilt, c);
    });
    expect(
      worstTilt,
      "least-aligned facet of a flat region (cos)",
    ).toBeGreaterThanOrEqual(cosFlat);
    for (const g of r.regions.filter((g) => g.type === "torus"))
      expect(g.radius, `torus ${g.radius}/${g.minorRadius}`).toBeGreaterThan(
        g.minorRadius,
      );
  });

  it("labels every triangle with its region", () => {
    const r = recognise(occ.makeCylinder(-1, 1, 2), 0.05);
    const sizes = r.regions.map(() => 0);
    for (const g of r.triangleRegion) sizes[g]++;
    expect(sizes).toEqual(r.regions.map((g) => g.triangles));
  });
});
