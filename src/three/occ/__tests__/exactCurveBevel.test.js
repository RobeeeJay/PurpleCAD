// Bevels on bodies built from exact curves.  The rim of an exact cylinder is
// one circular edge, so a chamfer picked on ONE segment of the drawn rim -- as
// the viewport picks it -- bevels the whole rim; and an exact cog bevels at
// the same sizes its facets did (cogBevel.test.js), refusing a bevel too wide
// for the teeth rather than drawing it broken.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";
import {
  regionsWithShapes,
  withWinding,
} from "../../sceneObjects/closedLoops.js";
import { upgradeProfileCurves } from "../../profileBackfill.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Edges (after welding coincident vertices) not shared by exactly two
// triangles: a closed solid's mesh has none.
function unsharedEdges({ positions: P, indices: I }) {
  const key = (i) =>
    [0, 1, 2].map((k) => Math.round(P[i * 3 + k] * 1e5)).join(",");
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = key(I[t + j]),
        b = key(I[t + ((j + 1) % 3)]);
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  return [...edges.values()].filter((n) => n !== 2).length;
}

const O = { x: 0, y: 0, z: 0 };

describe("bevelling an exact cylinder's rim", () => {
  const SHAPES = [{ type: "circle", cx: 0, cy: 0, r: 1 }];
  const sketch = {
    id: 1,
    type: "sketch",
    shapes: SHAPES,
    position: O,
    rotation: O,
  };
  const [g] = regionsWithShapes(SHAPES, 32, 0.05);
  const cylinder = {
    id: 2,
    type: "extrude",
    position: O,
    rotation: O,
    scale: { x: 1, y: 1, z: 1 },
    depth: 1,
    profile: {
      type: "sketchLoop",
      sketchId: 1,
      polygon2D: g.polygon,
      holes: [],
      loopShapes: g.loopShapes,
      curves2D: g.curves,
      profileCentroid: { x: 0.1, y: 0 },
    },
  };
  // One segment of the top rim as drawn: two adjacent polygon vertices.
  const v = withWinding(g.polygon, true);
  const rimSegment = {
    edges: [{ ax: v[3].x, ay: v[3].y, az: 1, bx: v[4].x, by: v[4].y, bz: 1 }],
    faces: [],
  };

  for (const [what, segments] of [
    ["chamfer", 1],
    ["fillet", 3],
  ])
    it(`a ${what} picked on one drawn segment bevels the whole rim, closed`, async () => {
      const res = await ops.chamferOrFilletItem({
        source: cylinder,
        subGeo: rimSegment,
        amount: 0.05,
        segments,
        allItems: [sketch, cylinder],
        printPrecision: 0.05,
      });
      expect(unsharedEdges(res.geometryData)).toBe(0);
      // Rebuilt from its recipe: wall, top, bottom and the bevel round the rim.
      const step = await ops.exportSTEP({
        items: [
          {
            id: 3,
            type: "csg",
            position: O,
            rotation: O,
            scale: { x: 1, y: 1, z: 1 },
            regenerator: {
              kind: "chamfer",
              source: cylinder,
              subGeo: res.resolvedSubGeo,
              amount: 0.05,
              segments,
              centerOffset: res.centerOffset,
            },
          },
        ],
        allItems: [sketch, cylinder],
        precision: 0.05,
      });
      expect((step.match(/ADVANCED_FACE\(/g) || []).length).toBe(4);
    }, 60000);
});

describe("bevelling an exact cog's rim", () => {
  // test-files/bad-cog-fillet.pcad's cog and its rim selection, upgraded to
  // exact curves as a full recalculation would.
  const doc = JSON.parse(
    fs.readFileSync("test-files/bad-cog-fillet.pcad", "utf8"),
  );
  const history = upgradeProfileCurves(doc.history, 0.1);
  const sketch = history[1].instruction.item;
  const bevel = history[4].instruction.patches.regenerator;
  const run = (segments, amount) =>
    ops.chamferOrFilletItem({
      source: bevel.source,
      subGeo: bevel.subGeo,
      amount,
      angleRad: null,
      segments,
      allItems: [sketch, bevel.source],
      printPrecision: 0.1,
    });

  it("is built from exact arcs", () => {
    expect(bevel.source.profile.curvesUpgraded).toBe(true);
    expect(bevel.source.profile.curves2D.outer.length).toBeGreaterThan(50);
  });

  it("takes the chamfers and fillet its facets took, as closed solids", async () => {
    for (const [segments, amount] of [
      [1, 0.01],
      [1, 0.02],
      [3, 0.02],
      [1, 0.03],
    ]) {
      const res = await run(segments, amount);
      const what = `segments ${segments}, ${amount * 10} mm`;
      expect(unsharedEdges(res.geometryData), what).toBe(0);
    }
  }, 120000);

  it("refuses the ones too wide for the teeth", async () => {
    for (const [segments, amount] of [
      [1, 0.04],
      [1, 0.1],
      [3, 0.1],
    ])
      await expect(run(segments, amount)).rejects.toThrow(/doesn't fit/);
  }, 120000);
});
