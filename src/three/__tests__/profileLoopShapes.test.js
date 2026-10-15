// An extrusion re-derived from an edited sketch must take the same region it
// was made from.  Matching went by the click anchor, then centroid, then area
// against the stored (pre-edit) outline: concentric rings share an anchor and a
// centroid, and once grown a ring's old area can be nearer its neighbour's than
// its own -- in test-files/recalc-overload.pcad, growing Sketch 4's rings 20 %
// gave Extruded 5 the INNER ring twice (narrower, where it had grown).  A
// profile now records which sketch shapes bound it (loopShapes), matched
// first; older documents get it at load where the sketch still matches.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import { regionsWithShapes } from "../sceneObjects/closedLoops.js";
import { extrudeWithLivePolygon } from "../csgUtils.js";
import { backfillLoopShapes } from "../profileBackfill.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const ring = (r) =>
  [0, 1, 2].map((i) => ({ type: "circle", cx: 0, cy: 0, r: r[i] }));
const maxRadius = (poly) => Math.max(...poly.map((p) => Math.hypot(p.x, p.y)));

describe("re-finding a profile after its sketch is edited", () => {
  it("keeps the outer of two concentric rings when they grow", () => {
    const before = ring([0.197, 0.401, 0.553]);
    const outer = regionsWithShapes(before, 32, null).find(
      (g) => g.holes.length === 1 && maxRadius(g.polygon) > 0.5,
    );
    expect(outer.loopShapes).toEqual({ outer: [2], holes: [[1]] });
    const sketch = {
      id: 4,
      type: "sketch",
      shapes: ring([0.236, 0.481, 0.664]),
    };
    const extrude = {
      id: 9,
      type: "extrude",
      profile: {
        type: "sketchLoop",
        sketchId: 4,
        profileCentroid: { x: 0, y: 0 },
        polygon2D: outer.polygon,
        holes: outer.holes,
        loopShapes: outer.loopShapes,
      },
    };
    const live = extrudeWithLivePolygon(extrude, [sketch], null);
    expect(maxRadius(live.profile.polygon2D)).toBeCloseTo(0.664, 2);
    // Without loopShapes the old area rule takes the inner ring.
    const { loopShapes, ...noShapes } = extrude.profile;
    const old = extrudeWithLivePolygon(
      { ...extrude, profile: noShapes },
      [sketch],
      null,
    );
    expect(maxRadius(old.profile.polygon2D)).toBeCloseTo(0.481, 2);
  });

  it("stamps an older document's profiles at load, only where the sketch still matches", () => {
    const shapes = ring([0.197, 0.401, 0.553]);
    const outer = regionsWithShapes(shapes, 32, null).find(
      (g) => g.holes.length === 1 && maxRadius(g.polygon) > 0.5,
    );
    const profile = {
      type: "sketchLoop",
      sketchId: 4,
      polygon2D: outer.polygon,
      holes: outer.holes,
    };
    const history = (sketchShapes) => [
      {
        id: 1,
        instruction: {
          type: "create",
          item: { id: 4, type: "sketch", shapes: sketchShapes },
        },
      },
      {
        id: 2,
        instruction: {
          type: "create",
          item: { id: 9, type: "extrude", profile },
        },
      },
    ];
    const stamped = backfillLoopShapes(history(shapes));
    expect(stamped[1].instruction.item.profile.loopShapes).toEqual({
      outer: [2],
      holes: [[1]],
    });
    // A sketch already edited away from the outline: no guess.
    const edited = backfillLoopShapes(history(ring([0.3, 0.6, 0.9])));
    expect(edited[1].instruction.item.profile.loopShapes).toBeUndefined();
  });

  it("recalc-overload.pcad: Extruded 5 grows with its rings", async () => {
    useStore
      .getState()
      .loadDocument(
        JSON.parse(fs.readFileSync("test-files/recalc-overload.pcad", "utf8")),
      );
    const defs = () =>
      useStore.getState().items.find((i) => i.id === 5).regenerator.extrudeDefs;
    useStore.getState().restoreToHistory(5);
    await recalculateTimeline();
    // Each boss's two rings, by the circles bounding them (prism order aside).
    expect(
      defs()
        .map((d) => JSON.stringify(d.profile.loopShapes))
        .sort(),
    ).toEqual(
      [
        { outer: [1], holes: [[0]] },
        { outer: [2], holes: [[1]] },
        { outer: [4], holes: [[3]] },
        { outer: [5], holes: [[4]] },
      ]
        .map((x) => JSON.stringify(x))
        .sort(),
    );
    const extent = () => {
      const p = useStore.getState().items.find((i) => i.id === 5)
        .geometryData.positions;
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        mn = Math.min(mn, p[i]);
        mx = Math.max(mx, p[i]);
      }
      return mx - mn;
    };
    const before = extent();
    for (let i = 0; i < 6; i++) {
      const s = useStore.getState().items.find((it) => it.id === 4).shapes[i];
      useStore.getState().updateSketchShape(4, i, { ...s, r: s.r * 1.2 });
    }
    await recalculateTimeline();
    // Each boss's outer ring (0.553) is 20 % bigger on its far side.
    expect(extent() - before, `extent ${before} -> ${extent()}`).toBeCloseTo(
      2 * 0.553 * 0.2,
      2,
    );
  }, 300000);
});
