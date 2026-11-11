// An extrude's profile is matched back to its sketch loop through
// profile.profileCentroid -- the point that was CLICKED when the extrude was
// made.  Nothing moves that point when the sketch is edited (and the retarget
// flow deliberately carries it over), so an edit can leave it sitting on bare
// sketch space.  Draw a NEW shape over that spot and the old extrude follows
// the new shape: in test-files/extrude-jump.pcad, adding a second cog moved the
// first cog's extrude onto it.  An anchor outside its own stored polygon is
// stale and must not be containment-tested.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { extrudeWithLivePolygon } from "../csgUtils.js";
import {
  regionsForProfile,
  regionsWithShapes,
} from "../sceneObjects/closedLoops.js";
import { polyCentroid, profileAnchor } from "../sceneObjects/polygonUtil.js";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import { budget } from "../../testBudget.js";

// A square of side `s` centred on (cx, cy), as four sketch lines.
const square = (cx, cy, s) => {
  const h = s / 2;
  const p = [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ];
  return p.map((a, i) => {
    const b = p[(i + 1) % 4];
    return { type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
};

describe("the profile anchor", () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("is the stored click point while that point is still inside the profile", () => {
    const a = profileAnchor({
      polygon2D: poly,
      profileCentroid: { x: 1.5, y: 0.5 },
    });
    expect(a).toEqual({ pc: { x: 1.5, y: 0.5 }, inside: true });
  });

  it("falls back to the polygon's own centroid once the click point is outside it", () => {
    // The shape moved out from under the anchor: (9, 9) is nowhere near it.
    const a = profileAnchor({
      polygon2D: poly,
      profileCentroid: { x: 9, y: 9 },
    });
    expect(a.inside).toBe(false);
    expect(a.pc).toEqual({ x: 1, y: 1 });
  });
});

describe("re-deriving an extrude's profile from its live sketch", () => {
  it("keeps a moved extrude on its own shape when a new shape covers the old click point", () => {
    // Sketch 1: the extruded square, moved away from where it was clicked.
    // Sketch 2: a bigger square drawn afterwards, over that abandoned anchor.
    const sketch = {
      id: 1,
      type: "sketch",
      shapes: [...square(0, 0, 2), ...square(6, 6, 4)],
    };
    const extrude = {
      id: 2,
      type: "extrude",
      profile: {
        type: "sketchLoop",
        sketchId: 1,
        // Live polygon of the small square at its CURRENT place...
        polygon2D: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ],
        // ...but the click anchor is stranded inside the new big square.
        profileCentroid: { x: 6, y: 6 },
        holes: [],
      },
    };
    const out = extrudeWithLivePolygon(extrude, [sketch], null);
    const c = polyCentroid(out.profile.polygon2D);
    expect(c.x, "matched loop centre x").toBeCloseTo(0, 6);
    expect(c.y, "matched loop centre y").toBeCloseTo(0, 6);
  });

  it("still honours a live anchor that picks a nested region over its container", () => {
    // A small square inside a big one: both contain the small one's centre, and
    // the anchor is what says which region was extruded.  The guard must not
    // disturb this -- the anchor here IS inside its own polygon.
    const sketch = {
      id: 1,
      type: "sketch",
      shapes: [...square(0, 0, 10), ...square(0, 0, 2)],
    };
    const inner = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ];
    const extrude = {
      id: 2,
      type: "extrude",
      profile: {
        type: "sketchLoop",
        sketchId: 1,
        polygon2D: inner,
        profileCentroid: { x: 0.5, y: 0.5 },
        holes: [],
      },
    };
    const out = extrudeWithLivePolygon(extrude, [sketch], null);
    const xs = out.profile.polygon2D.map((p) => Math.abs(p.x));
    expect(
      Math.max(...xs),
      "matched the inner square, not the outer",
    ).toBeCloseTo(1, 6);
  });

  it("keeps the first cog's extrude on the first cog after a second is drawn", () => {
    // The reported document: two cogs in one sketch, the extrude built on the
    // first.  Its click anchor (1.336, 0.947) now lies inside cog 2's outline.
    const doc = JSON.parse(
      fs.readFileSync("test-files/extrude-jump.pcad", "utf8"),
    );
    const byId = Object.fromEntries(doc.history.map((e) => [e.id, e]));
    const sketch = byId[1].instruction.item;
    const extrude = byId[2].instruction.item;
    expect(sketch.shapes.map((s) => s.type)).toEqual(["cog", "cog"]);

    const cog1 = sketch.shapes[0];
    const out = extrudeWithLivePolygon(extrude, [sketch], null);
    const c = polyCentroid(out.profile.polygon2D);
    expect(c.x, "extruded loop sits on cog 1").toBeCloseTo(cog1.x, 3);
    expect(c.y, "extruded loop sits on cog 1").toBeCloseTo(cog1.y, 3);
  });
});

describe("a profile built from a named sketch shape", () => {
  const doc = () =>
    JSON.parse(fs.readFileSync("test-files/extrude-jump.pcad", "utf8"));

  it("matches that shape even when its stored outline is stale too", () => {
    // The chamfer's FROZEN source: both its outline and its click anchor sit
    // where cog 1 USED to be, and cog 2 has since been drawn over that spot.
    // Geometry alone cannot separate them -- only the recorded shape index can.
    const byId = Object.fromEntries(doc().history.map((e) => [e.id, e]));
    const sketch = byId[1].instruction.item;
    const frozen = byId[6].instruction.patches.regenerator.source;
    expect(frozen.profile.textShapeIdx, "the shape it was built from").toBe(0);
    const stale = polyCentroid(frozen.profile.polygon2D);
    expect(stale.x, "the frozen outline is at cog 1's OLD place").toBeCloseTo(
      1.336,
      2,
    );

    const c = polyCentroid(
      extrudeWithLivePolygon(frozen, [sketch], null).profile.polygon2D,
    );
    expect(c.x, "rebuilt on cog 1").toBeCloseTo(sketch.shapes[0].x, 3);
    expect(c.y, "rebuilt on cog 1").toBeCloseTo(sketch.shapes[0].y, 3);
  });

  it("falls back to geometry when the named shape is gone", () => {
    // A deleted shape renumbers the rest, so an index can outlive its shape.
    // Rather than bind to whatever now holds that index, hand back everything
    // and let the outline and anchor decide.
    const regions = regionsWithShapes(
      [{ type: "circle", x: 0, y: 0, r: 2 }],
      32,
      null,
    );
    expect(regionsForProfile(regions, { textShapeIdx: 7 })).toEqual(regions);
    expect(regionsForProfile(regions, {})).toEqual(regions);
  });
});

// The end-to-end shape of the bug: the document, through the store and a full
// recalculation, must settle with the body on the cog it was built from.  The
// piecewise checks above all passed while this still came out on cog 2 -- the
// chamfer rebuilds from its own frozen source, which no single-function test
// exercised.
describe("the reported document, recalculated", () => {
  beforeAll(async () => {
    await ensureOcc();
  }, 60000);

  it(
    "settles with the gear on the cog it was extruded from",
    async () => {
      useStore
        .getState()
        .loadDocument(
          JSON.parse(fs.readFileSync("test-files/extrude-jump.pcad", "utf8")),
        );
      await recalculateTimeline();
      const items = useStore.getState().items;
      const sketch = items.find((i) => i.type === "sketch");
      const [cog1, cog2] = sketch.shapes;
      const body = items.find((i) => i.type === "csg");

      // Tip diameter = pitch + 2 modules: cog 1 is 4.4 across, cog 2 is 5.36.
      const P = body.geometryData.positions;
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        lo = Math.min(lo, P[i]);
        hi = Math.max(hi, P[i]);
      }
      const tip = (c) => c.pitchDiameter + (2 * c.pitchDiameter) / c.teeth;
      expect(hi - lo, "built from cog 1, not cog 2").toBeCloseTo(tip(cog1), 1);
      expect(Math.abs(hi - lo - tip(cog2))).toBeGreaterThan(0.5);

      // And it sits ON that cog.  The sketch lies on the ground, so sketch-local
      // (x, y) is world (x, 0, -y).
      expect(body.position.x, "over cog 1 in x").toBeCloseTo(
        sketch.position.x + cog1.x,
        2,
      );
      expect(body.position.z, "over cog 1 in z").toBeCloseTo(
        sketch.position.z - cog1.y,
        2,
      );
    },
    budget(240000),
  );
});
