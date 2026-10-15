// A conform emboss used to boolean its letters against a MESHED copy of the
// body, so an embossed cylinder came back as hundreds of flat faces after
// every recalculation, exact curves or not.  It now embosses the exact body,
// and falls back to the meshed copy only when the result's volume shows OCC
// dropped the body (what it did to a sphere with text turned 90/270 degrees).
// Three things that this exposed are checked here too.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";
import { ops, embossVolumeHolds } from "../../occOps.js";
import { useStore } from "../../../store";
import { recalculateTimeline } from "../../regenerateOrchestrator.js";

const require_ = createRequire(import.meta.url);
const bridge = require_("../../../../electron/occ-bridge.cjs");
const occ = require_(
  "../../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

describe("the emboss volume check", () => {
  // A 4 x 4 x 4 body and a 1 x 1 x 1 stamp half sunk into its top.
  const solids = () => {
    const body = occ.makeBox(0, 0, 0, 4, 4, 4);
    const stamp = occ.makeBox(1, 1, 3.5, 2, 2, 4.5);
    return { body, stamp };
  };
  for (const [name, holds] of [
    ["occOps.js", embossVolumeHolds],
    ["occ-bridge.cjs", bridge.__test.embossVolumeHolds],
  ])
    it(`accepts a real emboss and refuses a dropped body (${name})`, () => {
      const { body, stamp } = solids();
      const fused = occ.booleanOp([body, stamp], "union");
      const cut = occ.booleanOp([body, stamp], "difference");
      expect(holds(body, stamp, fused, false)).toBe(true);
      expect(holds(body, stamp, cut, true)).toBe(true);
      // What OCC returned for the sphere: the letters, without the body.
      expect(holds(body, stamp, stamp, false)).toBe(false);
      // And a "deboss" that gave back the body untouched plus the stamp.
      expect(holds(body, stamp, fused, true)).toBe(false);
      for (const id of [body, stamp, fused, cut]) occ.releaseShape(id);
    });
});

describe("an embossed ring recalculated with exact curves", () => {
  // test-files/failing-recalculate-scene.pcad: a ring with text debossed
  // round it, then two chamfers on its rims -- the second appended to the
  // first and later rebound to its result, so its rim points were stored
  // 14 units off the centred body.  On the meshed body a normal-only match
  // hid that; on the exact one the chamfer failed (782 lettering edges
  // matched one rim segment), and the recalculation pinned the whole ring
  // back to facets after 272 s.
  it("stays exact, with both chamfers on their rims", async () => {
    useStore
      .getState()
      .loadDocument(
        JSON.parse(
          fs.readFileSync("test-files/failing-recalculate-scene.pcad", "utf8"),
        ),
      );
    await recalculateTimeline(true);
    const history = useStore.getState().history;
    let upgraded = 0,
      pinned = 0;
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (v.sketchId != null && Array.isArray(v.polygon2D)) {
        if (v.curvesUpgraded) upgraded++;
        if (v.curves2D === null) pinned++;
      }
      for (const [k, x] of Object.entries(v))
        if (!["geometryData", "polygon2D", "holes", "shapes"].includes(k))
          walk(x);
    };
    walk(history);
    expect(pinned, "profiles pinned back to facets").toBe(0);
    expect(upgraded).toBeGreaterThan(0);
    const failed = history.filter((e) => {
      const g =
        e.instruction?.type === "create"
          ? e.instruction.item
          : e.instruction?.patches;
      return g?.regenerator?.regenFailed;
    });
    expect(failed.map((e) => e.id)).toEqual([]);
  }, 180000);
});

describe("a stored edge's normal fallback", () => {
  // A comb: a block with ten slots, so ten slot walls face +x along the top.
  // A stored top edge whose points are nowhere on the body matches by its
  // normals alone -- and they fit every one of those walls.  One stored
  // segment names one edge, so an ambiguous match takes none.
  it("takes no edge when its normals fit more than a handful", async () => {
    const O = { x: 0, y: 0, z: 0 };
    const S = { x: 1, y: 1, z: 1 };
    const block = {
      id: 1,
      type: "cube",
      position: O,
      rotation: O,
      scale: { x: 5, y: 0.5, z: 0.5 },
    };
    const slots = Array.from({ length: 10 }, (_, i) => ({
      id: 10 + i,
      type: "cube",
      position: { x: -4.5 + i, y: 0.3, z: 0 },
      rotation: O,
      scale: { x: 0.1, y: 0.2, z: 1 },
    }));
    const comb = await ops.performCsg({
      selectedItems: [block, ...slots],
      allItems: [block, ...slots],
      operation: "difference",
      printPrecision: 0.05,
    });
    const body = {
      id: 30,
      type: "csg",
      position: O,
      rotation: O,
      scale: S,
      geometryData: comb.geometryData,
    };
    // A top edge of a +x-facing wall, with its points far from the body.
    const stray = {
      ax: 40,
      ay: 40,
      az: -1,
      bx: 40,
      by: 40,
      bz: 1,
      n1: [0, 1, 0],
      n2: [1, 0, 0],
    };
    await expect(
      ops.chamferOrFilletItem({
        source: body,
        subGeo: { edges: [stray], faces: [] },
        amount: 0.02,
        segments: 1,
        allItems: [body],
        printPrecision: 0.05,
      }),
    ).rejects.toThrow();
  }, 60000);
});

describe("the outline of a body sewn from a mesh", () => {
  // A conform emboss's lettering is sewn triangles; outlined like real
  // faces, every one of its triangles was drawn.  Flat triangles meeting at
  // a shallow angle are a surface the mesh approximates, not an edge.
  it("draws a sewn cylinder's rims, not its triangles", () => {
    const cyl = occ.makeCylinder(-1, 1, 2);
    const mesh = occ.tessellate(cyl, 0.05);
    const sewn = occ.makeSolidFromMesh(
      new Float64Array(mesh.positions),
      new Uint32Array(mesh.indices),
      true,
      true,
    );
    const out = occ.tessellate(sewn, 0.05);
    const P = out.positions;
    const E = out.edges;
    // Every outline segment lies on a rim (y = +-1), none runs up the wall.
    for (let i = 0; i < E.length; i += 2) {
      const ya = P[E[i] * 3 + 1];
      const yb = P[E[i + 1] * 3 + 1];
      expect(
        Math.abs(Math.abs(ya) - 1),
        `segment at y ${ya}..${yb}`,
      ).toBeLessThan(1e-5);
      expect(yb).toBeCloseTo(ya, 5);
    }
    for (const id of [cyl, sewn]) occ.releaseShape(id);
  });
});
