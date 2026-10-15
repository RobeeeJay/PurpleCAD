// An extrude whose profile records its exact curves (curves2D) is built from
// those curves: a bore is one cylindrical face, not one plane per sample.
// Booleans keep whatever faces they are given, so a faceted bore stays
// faceted through every later cut and shows as triangles; an exact one is
// tessellated smooth at the Resolution.  A profile WITHOUT curves2D -- every
// document from before -- must still build the faceted prism its saved
// chamfers and face picks were made on.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";
import { makeCogShape } from "../../cogGeometry.js";
import { makeTextShape } from "../../sketchText.js";
import {
  regionsWithShapes,
  windLoopForOcc,
} from "../../sceneObjects/closedLoops.js";

const bridge = createRequire(import.meta.url)(
  "../../../../electron/occ-bridge.cjs",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };

// A 40 x 40 mm plate with a 10 mm-radius bore, extruded 10 mm.
const SHAPES = [
  { type: "rect", x1: -2, y1: -2, x2: 2, y2: 2 },
  { type: "circle", cx: 0.3, cy: -0.2, r: 1 },
];
const sketch = {
  id: 1,
  type: "sketch",
  shapes: SHAPES,
  position: O,
  rotation: O,
};

function plate(withCurves) {
  const region = regionsWithShapes(SHAPES, 32, 0.05).find(
    (g) => g.holes.length === 1,
  );
  return {
    id: 2,
    type: "extrude",
    position: O,
    rotation: O,
    scale: S,
    depth: 1,
    profile: {
      sketchId: 1,
      polygon2D: region.polygon,
      holes: region.holes,
      loopShapes: region.loopShapes,
      ...(withCurves ? { curves2D: region.curves } : {}),
      profileCentroid: { x: 1.5, y: 1.5 },
    },
  };
}

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

const faceCounts = (step) => ({
  faces: (step.match(/ADVANCED_FACE\(/g) || []).length,
  cylinders: (step.match(/CYLINDRICAL_SURFACE\(/g) || []).length,
});

async function exportBoth(item) {
  const args = { items: [item], allItems: [sketch, item], precision: 0.05 };
  return Promise.all([
    ops.exportSTEP(JSON.parse(JSON.stringify(args))),
    bridge.exportSTEP(JSON.parse(JSON.stringify(args))),
  ]);
}

describe("an extrude built from its exact curves", () => {
  it("has a cylindrical bore in both OCC implementations", async () => {
    for (const [name, step] of (await exportBoth(plate(true))).entries()) {
      const c = faceCounts(step);
      // Four sides, top, bottom and the bore.
      expect(c, `implementation ${name}: ${JSON.stringify(c)}`).toEqual({
        faces: 7,
        cylinders: 1,
      });
    }
  }, 30000);

  it("an older profile without curves stays faceted", async () => {
    for (const [name, step] of (await exportBoth(plate(false))).entries()) {
      const c = faceCounts(step);
      expect(c.cylinders, `implementation ${name}`).toBe(0);
      expect(
        c.faces,
        `implementation ${name}: ${c.faces} faces`,
      ).toBeGreaterThan(30);
    }
  }, 30000);

  it("a box cut by the plate keeps the bore exact and agrees across implementations", async () => {
    const box = {
      id: 3,
      type: "cube",
      position: { x: 0.3, y: -0.2, z: 0.5 },
      rotation: O,
      scale: { x: 1.5, y: 1.5, z: 1.5 },
    };
    const item = plate(true);
    const args = {
      selectedItems: [box, item],
      allItems: [sketch, box, item],
      operation: "intersection",
      printPrecision: 0.05,
    };
    const [a, b] = await Promise.all([
      ops.performCsg(JSON.parse(JSON.stringify(args))),
      bridge.performCsg(JSON.parse(JSON.stringify(args))),
    ]);
    expect(b.geometryData.positions.length).toBe(
      a.geometryData.positions.length,
    );
    // The bore's wall: every vertex 10 mm from the bore axis, to the mesher's
    // deflection -- an arc tessellated, not chords of a 32-gon cut again.
    const p = a.geometryData.positions;
    // The result is centred on its bounding box; `position` puts it back.
    const at = a.position;
    let wall = 0;
    let worst = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] + at.x - 0.3;
      const y = p[i + 1] + at.y + 0.2;
      const d = Math.hypot(x, y);
      if (Math.abs(d - 1) < 0.02) {
        wall++;
        worst = Math.max(worst, Math.abs(d - 1));
      }
    }
    expect(wall, "vertices on the bore wall").toBeGreaterThan(50);
    expect(
      worst,
      `worst wall vertex off the true radius by ${worst}`,
    ).toBeLessThan(1e-6);
  }, 30000);

  // A slot's ends and a bezier-closed "D" take the arc and bezier edge paths
  // (partial curves between straight edges); the bore above is a full circle.
  const extrudeOf = (shapes) => {
    const [g] = regionsWithShapes(shapes, 32, 0.05);
    return {
      item: {
        id: 5,
        type: "extrude",
        position: O,
        rotation: O,
        scale: S,
        depth: 1,
        profile: {
          sketchId: 4,
          polygon2D: g.polygon,
          holes: [],
          loopShapes: g.loopShapes,
          curves2D: g.curves,
        },
      },
      sketch: { id: 4, type: "sketch", shapes, position: O, rotation: O },
    };
  };

  it("a slot's ends are two half cylinders", async () => {
    const { item, sketch: sk } = extrudeOf([
      line(0, 0, 2, 0),
      line(2, 1, 0, 1),
      {
        type: "arc",
        cx: 2,
        cy: 0.5,
        r: 0.5,
        startAngle: -Math.PI / 2,
        endAngle: Math.PI / 2,
      },
      {
        type: "arc",
        cx: 0,
        cy: 0.5,
        r: 0.5,
        startAngle: Math.PI / 2,
        endAngle: (3 * Math.PI) / 2,
      },
    ]);
    const args = { items: [item], allItems: [sk, item], precision: 0.05 };
    for (const impl of [ops, bridge]) {
      const c = faceCounts(
        await impl.exportSTEP(JSON.parse(JSON.stringify(args))),
      );
      // Two flat sides, two ends, top and bottom.
      expect(c, JSON.stringify(c)).toEqual({ faces: 6, cylinders: 2 });
    }
  }, 30000);

  it("a bezier-closed D has one curved wall", async () => {
    const { item, sketch: sk } = extrudeOf([
      line(0, 0, 2, 0),
      {
        type: "bezier",
        p0: { x: 2, y: 0 },
        p1: { x: 2, y: 1.5 },
        p2: { x: 0, y: 1.5 },
        p3: { x: 0, y: 0 },
      },
    ]);
    const args = { items: [item], allItems: [sk, item], precision: 0.05 };
    for (const impl of [ops, bridge]) {
      const c = faceCounts(
        await impl.exportSTEP(JSON.parse(JSON.stringify(args))),
      );
      // The flat side, the curved wall, top and bottom.
      expect(c.faces, JSON.stringify(c)).toBe(4);
    }
  }, 30000);
});

// Revolve, sweep and loft build from the same profiles, so they take the same
// exact curves -- and a sweep's PATH too.  A recipe-only csg item (no baked
// mesh) makes STEP export rebuild it, so its faces can be counted.
describe("revolve, sweep and loft built from exact curves", () => {
  const circleSketch = (id, cx, cy, r, extra = [], at = O) => ({
    id,
    type: "sketch",
    position: at,
    rotation: O,
    shapes: [{ type: "circle", cx, cy, r }, ...extra],
  });
  // An extrude-like profile source, as the sweep tools store one.
  const sourceOf = (sk, withCurves) => {
    const [g] = regionsWithShapes(sk.shapes, 32, 0.05);
    return {
      type: "extrude",
      depth: 0,
      position: sk.position,
      rotation: O,
      profile: {
        sketchId: sk.id,
        profileCentroid: { x: sk.shapes[0].cx, y: sk.shapes[0].cy },
        polygon2D: g.polygon,
        holes: [],
        loopShapes: g.loopShapes,
        ...(withCurves ? { curves2D: g.curves } : {}),
        position: sk.position,
        rotation: O,
        normalWorld: { x: 0, y: 0, z: 1 },
      },
    };
  };
  const recipeItem = (regenerator) => ({
    id: 90,
    type: "csg",
    position: O,
    rotation: O,
    scale: S,
    regenerator,
  });
  const countBoth = async (item, allItems) => {
    const args = { items: [item], allItems, precision: 0.05 };
    const out = [];
    for (const impl of [ops, bridge])
      out.push(
        faceCounts(await impl.exportSTEP(JSON.parse(JSON.stringify(args)))),
      );
    return out;
  };
  const torusFaces = (step) => (step.match(/TOROIDAL_SURFACE\(/g) || []).length;

  it("a revolved circle is one toroidal face; an older one stays faceted", async () => {
    // A 5 mm-radius circle 20 mm off the axis line x = 0.
    const sk = circleSketch(40, 2, 0.5, 0.5, [line(0, -1, 0, 2)]);
    const revolveOf = (withCurves) =>
      recipeItem({
        kind: "revolve",
        source: sourceOf(sk, withCurves),
        axis: { sketchId: 40, shapeIdx: 1 },
        angleRad: 2 * Math.PI,
        prismSides: 0,
        offsetPerRotation: 0,
      });
    for (const impl of [ops, bridge]) {
      const args = (w) => ({
        items: [revolveOf(w)],
        allItems: [sk],
        precision: 0.05,
      });
      const exact = await impl.exportSTEP(
        JSON.parse(JSON.stringify(args(true))),
      );
      expect(faceCounts(exact).faces, "exact revolve faces").toBe(1);
      expect(torusFaces(exact)).toBe(1);
      const old = await impl.exportSTEP(
        JSON.parse(JSON.stringify(args(false))),
      );
      expect(faceCounts(old).faces, "older revolve faces").toBeGreaterThan(10);
    }
  }, 30000);

  it("a circle swept along a bezier is one wall and two caps", async () => {
    const profile = circleSketch(41, 0, 0, 0.3);
    const pathSketch = {
      id: 42,
      type: "sketch",
      position: O,
      rotation: O,
      shapes: [
        {
          type: "bezier",
          p0: { x: 0, y: 0 },
          p1: { x: 0, y: 2 },
          p2: { x: 2, y: 3 },
          p3: { x: 4, y: 3 },
        },
      ],
    };
    const item = recipeItem({
      kind: "pipe",
      profileSource: sourceOf(profile, true),
      pathRef: { sketchId: 42, shapeIdx: 0 },
      twistTurns: 0,
      autoRotate: false,
    });
    for (const c of await countBoth(item, [profile, pathSketch]))
      expect(c.faces, JSON.stringify(c)).toBe(3);
  }, 30000);

  // A path sketch standing upright, so the sweep leaves the profile's plane.
  const pathOf = (shape) => ({
    id: 42,
    type: "sketch",
    position: O,
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
    shapes: [shape],
  });
  const pipeOf = (profile, extra = {}) =>
    recipeItem({
      kind: "pipe",
      profileSource: sourceOf(profile, true),
      pathRef: { sketchId: 42, shapeIdx: 0 },
      twistTurns: 0,
      autoRotate: false,
      ...extra,
    });

  it("a circle swept along an arc is one wall and two caps", async () => {
    const profile = circleSketch(41, 0, 0, 0.3);
    const path = pathOf({
      type: "arc",
      cx: 2,
      cy: 0,
      r: 2,
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
    });
    for (const c of await countBoth(pipeOf(profile), [profile, path]))
      expect(c.faces, JSON.stringify(c)).toBe(3);
  }, 30000);

  it("a circle swept round a circle is one closed face, a torus", async () => {
    const profile = circleSketch(41, 0, 0, 0.3);
    const path = pathOf({ type: "circle", cx: 0, cy: 3, r: 2 });
    for (const c of await countBoth(pipeOf(profile), [profile, path]))
      expect(c.faces, JSON.stringify(c)).toBe(1);
  }, 30000);

  const BEZ = {
    type: "bezier",
    p0: { x: 0, y: 0 },
    p1: { x: 0, y: 2 },
    p2: { x: 2, y: 3 },
    p3: { x: 4, y: 3 },
  };

  it("an auto-rotated sweep follows the true path, not its samples", async () => {
    // Every wall vertex sits at the profile's radius from the TRUE bezier.
    // Measured: lofted between sections on the sampled path, 5e-3 mm; swept
    // by OCC's pipe shell along the exact spine, 1.4e-4 mm; lofted through
    // sections placed on the exact spine (what it does), 1.1e-5 mm.
    const profile = circleSketch(41, 0, 0, 0.3);
    const path = pathOf(BEZ);
    const res = await ops.pipeItem({
      profileSource: sourceOf(profile, true),
      pathRef: { sketchId: 42, shapeIdx: 0 },
      twistTurns: 0,
      autoRotate: true,
      allItems: [profile, path],
      printPrecision: 0.005,
    });
    const bez = (t) => {
      const u = 1 - t;
      const f = (k) =>
        u * u * u * BEZ.p0[k] +
        3 * u * u * t * BEZ.p1[k] +
        3 * u * t * t * BEZ.p2[k] +
        t * t * t * BEZ.p3[k];
      return { x: f("x"), y: f("y") };
    };
    const dense = Array.from({ length: 4001 }, (_, i) => bez(i / 4000));
    const P = res.geometryData.positions;
    const at = res.position;
    let worst = 0;
    for (let i = 0; i < P.length; i += 3) {
      // The path sketch is turned +90 deg about X: its (x, y) is world (x, z).
      const lx = P[i] + at.x;
      const ly = P[i + 2] + at.z;
      const lz = -(P[i + 1] + at.y);
      let d = Infinity;
      for (const q of dense)
        d = Math.min(d, Math.hypot(lx - q.x, ly - q.y, lz));
      if (Math.abs(d - 0.3) < 0.05) worst = Math.max(worst, Math.abs(d - 0.3));
    }
    expect(worst * 10, "worst wall vertex off, mm").toBeLessThan(1e-4);
  }, 60000);

  it("a twisted sweep of a curved profile builds", async () => {
    // A circle's exact profile is one closed edge; lofting twisted copies of
    // it failed outright ("pipe sweep (twist) failed") until the loft stopped
    // trying to re-match its single vertex between sections.
    const profile = circleSketch(41, 0, 0, 0.3);
    const path = pathOf(BEZ);
    const item = pipeOf(profile, { autoRotate: true, twistTurns: 0.5 });
    for (const c of await countBoth(item, [profile, path]))
      expect(c.faces, JSON.stringify(c)).toBe(3);
  }, 30000);

  it("a loft from a tilted ellipse to a circle is one wall and two caps", async () => {
    // The ellipse is packed by its world centre, axes and radii; three points
    // on it would not fix it.
    const tilt = { x: 0.3, y: 0, z: 0.2 };
    const a = {
      id: 45,
      type: "sketch",
      position: O,
      rotation: tilt,
      shapes: [{ type: "ellipse", cx: 0.2, cy: -0.1, rx: 1.2, ry: 0.6 }],
    };
    const b = circleSketch(46, 0, 0, 0.5, [], { x: 0, y: 0, z: 4 });
    const src = sourceOf(a, true);
    src.profile.rotation = tilt;
    src.profile.profileCentroid = { x: 0.2, y: -0.1 };
    const item = recipeItem({
      kind: "loft",
      profileSource: src,
      secondProfileSource: sourceOf(b, true),
    });
    const args = { items: [item], allItems: [a, b], precision: 0.05 };
    for (const impl of [ops, bridge]) {
      const step = await impl.exportSTEP(JSON.parse(JSON.stringify(args)));
      const c = faceCounts(step);
      expect(c.faces, JSON.stringify(c)).toBe(3);
      expect((step.match(/= ELLIPSE\(/g) || []).length).toBeGreaterThan(0);
    }
  }, 30000);

  it("a loft between two circles is one wall and two caps", async () => {
    const a = circleSketch(43, 0, 0, 1);
    const b = circleSketch(44, 0, 0, 0.5, [], { x: 0, y: 0, z: 4 });
    const item = recipeItem({
      kind: "loft",
      profileSource: sourceOf(a, true),
      secondProfileSource: sourceOf(b, true),
    });
    for (const c of await countBoth(item, [a, b]))
      expect(c.faces, JSON.stringify(c)).toBe(3);
  }, 30000);
});

// An older document's selections name the faces of its facets: `side7` is the
// wall over polygon edge 7.  Built from exact curves, one face replaces a run
// of facets, so it carries every one of their names, and a recalculated
// older project's `side7` lands on the curved face that facet became.
describe("an exact extrude's face names", () => {
  it("name each curved face for every polygon edge it replaced", () => {
    const occ = createRequire(import.meta.url)(
      "../../../../native/occ-addon/build/Release/occ_addon.node",
    );
    const shapes = [
      line(0, 0, 2, 0),
      line(2, 1, 0, 1),
      {
        type: "arc",
        cx: 2,
        cy: 0.5,
        r: 0.5,
        startAngle: -Math.PI / 2,
        endAngle: Math.PI / 2,
      },
      {
        type: "arc",
        cx: 0,
        cy: 0.5,
        r: 0.5,
        startAngle: Math.PI / 2,
        endAngle: (3 * Math.PI) / 2,
      },
    ];
    const [g] = regionsWithShapes(shapes, 32, 0.05);
    const loop = windLoopForOcc(g.polygon, g.curves.outer, true);
    const id = occ.makeExtrude(loop.flat, [], 0, 0, 1, loop.curves, []);
    const names = occ.faceNames(id);
    const n = g.polygon.length;
    for (let k = 0; k < n; k++) expect(names).toContain(`side${k}`);
    // Each name sits on its own edge's surface: an arc edge's on that end's
    // half cylinder, a straight edge's on its flat side.
    const pts = [];
    for (let i = 0; i < loop.flat.length; i += 2)
      pts.push({ x: loop.flat[i], y: loop.flat[i + 1] });
    for (let k = 0; k < n; k++) {
      const [x, y] = occ.namedFacePoint(id, `side${k}`);
      const a = pts[k];
      const b = pts[(k + 1) % n];
      const mx = (a.x + b.x) / 2;
      if (Math.abs(a.y - b.y) < 1e-9) {
        expect(Math.abs(y - a.y), `side${k} on its flat side`).toBeLessThan(
          1e-9,
        );
      } else {
        const cx = mx > 1 ? 2 : 0;
        const r = Math.hypot(x - cx, y - 0.5);
        expect(Math.abs(r - 0.5), `side${k} on its end`).toBeLessThan(1e-9);
      }
    }
    occ.releaseShape(id);
  });
});

// A cog's root, fillet and tip arcs are true arcs; its involute flanks stay
// their sampled segments (built as splines they made OCC's rim chamfer
// erratic -- see cogGeometry.js).  One face per arc, not one per sample.
describe("an extruded cog", () => {
  it("has a face per tooth arc, in both OCC implementations", async () => {
    const cog = makeCogShape({
      x: 0.5,
      y: -0.3,
      pitchDiameter: 4,
      teeth: 20,
      backlash: 0,
      rootFillet: 0.05,
      holeDiameter: 0,
    });
    const sk = {
      id: 7,
      type: "sketch",
      shapes: [cog],
      position: O,
      rotation: O,
    };
    const [g] = regionsWithShapes([cog], 32, 0.05);
    const item = {
      id: 8,
      type: "extrude",
      position: O,
      rotation: O,
      scale: S,
      depth: 1,
      profile: {
        sketchId: 7,
        textShapeIdx: 0,
        polygon2D: g.polygon,
        holes: [],
        loopShapes: g.loopShapes,
        curves2D: g.curves,
      },
    };
    const args = { items: [item], allItems: [sk, item], precision: 0.05 };
    // One face per arc run and per straight edge, then top and bottom.
    const runs = g.curves.outer;
    const expected =
      runs.length +
      g.polygon.length -
      runs.reduce((n, r) => n + r.count, 0) +
      2;
    for (const impl of [ops, bridge]) {
      const c = faceCounts(
        await impl.exportSTEP(JSON.parse(JSON.stringify(args))),
      );
      expect(c.faces, JSON.stringify(c)).toBe(expected);
      // Tip, two fillets and two root arcs per tooth are cylinders.
      expect(c.cylinders).toBe(5 * 20);
      expect(c.faces).toBeLessThan((g.polygon.length + 2) * 0.75);
    }
  }, 30000);
});

// A letter is built from its glyph's own curves: one face per font curve,
// not one per sample.  "B" has straight stems and curved bowls, and two holes.
describe("extruded text", () => {
  it("has a face per glyph curve, in both OCC implementations", async () => {
    const text = makeTextShape({
      text: "B",
      height: 2,
      font: "helvetiker",
      x: 0,
      y: 0,
      tolerance: 0.005,
    });
    const sk = {
      id: 11,
      type: "sketch",
      shapes: [text],
      position: O,
      rotation: O,
    };
    const [g] = regionsWithShapes([text], 32, 0.05);
    expect(g.holes).toHaveLength(2);
    // Expected faces: per loop, one per curve run and one per straight edge;
    // then top and bottom.
    const edges = (poly, runs) =>
      runs.length + (poly.length - runs.reduce((n, r) => n + r.count, 0));
    const expected =
      edges(g.polygon, g.curves.outer) +
      g.holes.reduce((n, h, i) => n + edges(h, g.curves.holes[i]), 0) +
      2;
    const sampled =
      g.polygon.length + g.holes.reduce((n, h) => n + h.length, 0) + 2;
    const item = {
      id: 12,
      type: "extrude",
      position: O,
      rotation: O,
      scale: S,
      depth: 0.5,
      profile: {
        sketchId: 11,
        textShapeIdx: 0,
        polygon2D: g.polygon,
        holes: g.holes,
        loopShapes: g.loopShapes,
        curves2D: g.curves,
      },
    };
    const args = { items: [item], allItems: [sk, item], precision: 0.05 };
    for (const impl of [ops, bridge]) {
      const c = faceCounts(
        await impl.exportSTEP(JSON.parse(JSON.stringify(args))),
      );
      expect(c.faces, `${JSON.stringify(c)}, ${sampled} sampled`).toBe(
        expected,
      );
      expect(c.faces).toBeLessThan(sampled / 2);
    }
  }, 30000);
});

// With exact curves, Resolution only decides how finely a curved face is
// drawn -- so every setting Settings offers must draw finer than the one
// above it.  The mesher's floor was 0.01 mm: 0.01, 0.005, 0.002 and 0.001 mm
// all gave a cylinder the same 396 triangles.
describe("the Resolution's reach", () => {
  it("meshes a curved face finer at every setting down to 0.001 mm", () => {
    const occ = createRequire(import.meta.url)(
      "../../../../native/occ-addon/build/Release/occ_addon.node",
    );
    const id = occ.makeCylinder(-1, 1, 2);
    const tris = [0.05, 0.01, 0.005, 0.002, 0.001].map(
      (mm) => occ.tessellate(id, mm).indices.length / 3,
    );
    occ.releaseShape(id);
    for (let i = 1; i < tris.length; i++)
      expect(tris[i], `triangles by setting: ${tris}`).toBeGreaterThan(
        tris[i - 1],
      );
  });
});
