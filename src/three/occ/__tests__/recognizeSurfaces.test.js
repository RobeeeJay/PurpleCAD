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

  it("leaves a torus as triangles rather than inventing a surface", () => {
    // No torus fit yet: what it can't name must stay mesh, not come back as a
    // cylinder or sphere that only roughly matches.
    const r = recognise(occ.makeTorus(2, 0.5), 0.05);
    const t = r.triangleCounts;
    const total = r.triangleRegion.length;
    expect(t.cylinder + t.cone + t.sphere, `regions ${found(r)}`).toBe(0);
    expect(t.mesh / total, `mesh share ${t.mesh}/${total}`).toBeGreaterThan(
      0.9,
    );
  });

  it("labels every triangle with its region", () => {
    const r = recognise(occ.makeCylinder(-1, 1, 2), 0.05);
    const sizes = r.regions.map(() => 0);
    for (const g of r.triangleRegion) sizes[g]++;
    expect(sizes).toEqual(r.regions.map((g) => g.triangles));
  });
});
