// Machine-enforced lockstep between the TWO OCC implementations: every op
// runs through src/three/occOps.js (what vitest normally exercises) AND
// electron/occ-bridge.cjs (what the shipped Electron app actually runs), and
// the results must agree.  A change to op/transform/CSG logic made in one
// file but not the other passes every other unit test while silently doing
// nothing (or the wrong thing) in the app — the most expensive recurring bug
// class in this codebase (see the ⚠️ lockstep rule in CLAUDE.md).
//
// Both implementations load the SAME native addon module (node's require
// cache resolves them to one instance), so any result drift is JS-side
// recipe/transform drift — exactly what this suite exists to catch.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";
import { buildEmbossStamp } from "../../embossGeometry.js";

const bridge = createRequire(import.meta.url)(
  "../../../../electron/occ-bridge.cjs",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = (id, over = {}) => ({
  id,
  type: "cube",
  position: O,
  rotation: O,
  scale: S,
  ...over,
});

const summarize = (g) => {
  const p = g.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  return {
    vertCount: p.length / 3,
    triCount: (g.indices?.length ?? p.length / 3) / 3,
    bbox: [...min, ...max].map((v) => Number(v.toFixed(6))),
  };
};

// Run the op through both implementations and require identical geometry
// summaries and centerOffsets.  Args are JSON-cloned per run so neither
// implementation can leak mutations into the other.
async function parity(op, args) {
  const a = await ops[op](JSON.parse(JSON.stringify(args)));
  const b = await bridge[op](JSON.parse(JSON.stringify(args)));
  expect(b).toBeTruthy();
  expect(a).toBeTruthy();
  expect(summarize(b.geometryData)).toEqual(summarize(a.geometryData));
  if (a.centerOffset || b.centerOffset) {
    for (const k of ["cx", "cy", "cz"])
      expect(b.centerOffset[k]).toBeCloseTo(a.centerOffset[k], 6);
  }
  return a;
}

const edgeYZ = {
  edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
  faces: [],
};
const topFaceSel = { faces: [{ nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 }] };

describe("occOps.js ↔ occ-bridge.cjs parity", () => {
  it("chamfer (plain, off-centre, rotated, non-uniform scale)", async () => {
    const variants = [
      cube(1),
      cube(1, { position: { x: 2, y: 1, z: -0.5 } }),
      cube(1, { rotation: { x: 0, y: Math.PI / 5, z: 0 } }),
      cube(1, { scale: { x: 1, y: 2, z: 1 } }),
    ];
    for (const c of variants) {
      await parity("chamferOrFilletItem", {
        source: c,
        subGeo: edgeYZ,
        amount: 0.25,
        segments: 1,
        allItems: [c],
        printPrecision: 0.1,
      });
    }
  }, 60000);

  it("fillet", async () => {
    const c = cube(2);
    await parity("chamferOrFilletItem", {
      source: c,
      subGeo: edgeYZ,
      amount: 0.3,
      segments: 3,
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 30000);

  it("boolean union / difference / intersection, incl. scaled + rotated inputs", async () => {
    for (const operation of ["union", "difference", "intersection"]) {
      const a = cube(3, { scale: { x: 1, y: 2, z: 1 } });
      const b = cube(4, {
        position: { x: 1, y: 0.5, z: 0.25 },
        rotation: { x: 0, y: Math.PI / 7, z: 0 },
      });
      await parity("performCsg", {
        selectedItems: [a, b],
        allItems: [a, b],
        operation,
        printPrecision: 0.1,
      });
    }
  }, 60000);

  it("push/pull", async () => {
    const c = cube(5);
    await parity("pushPullFaces", {
      source: c,
      subGeo: topFaceSel,
      distance: 0.5,
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 30000);

  it("shell", async () => {
    const c = cube(6);
    await parity("shellItem", {
      source: c,
      thickness: 0.2,
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 30000);

  it("hole (plain and threaded)", async () => {
    const c = cube(7);
    for (const threaded of [false, true]) {
      await parity("holeItem", {
        source: c,
        hole: {
          point: { x: 0, y: 1, z: 0 },
          dir: { x: 0, y: -1, z: 0 },
          length: 12,
          diameter: 6,
          pitch: 1,
          tolerance: 0,
          threaded,
        },
        allItems: [c],
        printPrecision: 0.1,
      });
    }
  }, 60000);

  it("emboss (raised pad on the top face)", async () => {
    const c = cube(8);
    const profile = {
      polygon2D: [
        { x: -0.3, y: -0.3 },
        { x: 0.3, y: -0.3 },
        { x: 0.3, y: 0.3 },
        { x: -0.3, y: 0.3 },
      ],
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    const topFace = { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 };
    const stamp = buildEmbossStamp(
      [profile],
      topFace,
      { deboss: false, angleDeg: 0, offsetMm: 0, scale: 1, distanceMm: 4 },
      [],
      null,
    );
    expect(stamp).toBeTruthy();
    await parity("embossItem", {
      source: c,
      stamp,
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 60000);

  it("solidFromMesh retains identical solids", async () => {
    // Baked-mesh sew: both impls must produce the same solid from the same
    // mesh.  Compare via tessellation of the retained shapes.
    const base = await ops.chamferOrFilletItem({
      source: cube(9),
      subGeo: edgeYZ,
      amount: 0.2,
      segments: 1,
      allItems: [cube(9)],
      printPrecision: 0.1,
    });
    const gd = base.geometryData;
    const a = await ops.solidFromMesh(JSON.parse(JSON.stringify(gd)));
    const b = bridge.solidFromMesh(JSON.parse(JSON.stringify(gd)));
    expect(a?.shapeId).toBeTruthy();
    expect(b?.shapeId).toBeTruthy();
    const occ = createRequire(import.meta.url)(
      "../../../../native/occ-addon/build/Release/occ_addon.node",
    );
    const ta = occ.tessellate(a.shapeId, 0.1);
    const tb = occ.tessellate(b.shapeId, 0.1);
    expect(summarize(tb)).toEqual(summarize(ta));
    occ.releaseShape(a.shapeId);
    occ.releaseShape(b.shapeId);
  }, 30000);

  it("tessellateItem", async () => {
    const c = cube(11, {
      position: { x: 1, y: 0.5, z: 0 },
      scale: { x: 1, y: 2, z: 1 },
    });
    const args = { source: c, allItems: [c], printPrecision: 0.1 };
    const a = await ops.tessellateItem(JSON.parse(JSON.stringify(args)));
    const b = bridge.tessellateItem(JSON.parse(JSON.stringify(args)));
    expect(summarize(b.geometryData)).toEqual(summarize(a.geometryData));
  }, 30000);

  it("draft", async () => {
    const c = cube(12);
    await parity("draftItem", {
      source: c,
      neutral: { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 },
      faces: [{ nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 }],
      angleDeg: 12,
      flip: false,
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 30000);

  it("split (both halves)", async () => {
    const c = cube(13);
    const args = {
      target: c,
      plane: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      allItems: [c],
      printPrecision: 0.1,
    };
    const a = await ops.splitItem(JSON.parse(JSON.stringify(args)));
    const b = await bridge.splitItem(JSON.parse(JSON.stringify(args)));
    expect(summarize(b.partA.geometryData)).toEqual(
      summarize(a.partA.geometryData),
    );
    expect(summarize(b.partB.geometryData)).toEqual(
      summarize(a.partB.geometryData),
    );
  }, 30000);

  it("revolve", async () => {
    const sketch = {
      id: 21,
      type: "sketch",
      shapes: [
        { type: "line", x1: 2, y1: 0, x2: 3, y2: 0 },
        { type: "line", x1: 3, y1: 0, x2: 3, y2: 1 },
        { type: "line", x1: 3, y1: 1, x2: 2, y2: 1 },
        { type: "line", x1: 2, y1: 1, x2: 2, y2: 0 },
        { type: "line", x1: 0, y1: 0, x2: 0, y2: 1 },
      ],
    };
    const source = {
      type: "extrude",
      depth: 0,
      position: O,
      rotation: O,
      profile: {
        sketchId: 21,
        profileCentroid: { x: 2.5, y: 0.5 },
        polygon2D: [
          { x: 2, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 1 },
          { x: 2, y: 1 },
        ],
        holes: [],
        position: O,
        rotation: O,
        normalWorld: { x: 0, y: 0, z: 1 },
      },
    };
    await parity("revolveItem", {
      source,
      axis: { sketchId: 21, shapeIdx: 4 },
      angleRad: 2 * Math.PI,
      prismSides: 0,
      allItems: [sketch],
      printPrecision: 0.05,
    });
  }, 60000);

  it("pipe", async () => {
    const profileSketch = {
      id: 22,
      type: "sketch",
      position: O,
      rotation: O,
      shapes: [
        { type: "line", x1: -0.3, y1: -0.3, x2: 0.3, y2: -0.3 },
        { type: "line", x1: 0.3, y1: -0.3, x2: 0.3, y2: 0.3 },
        { type: "line", x1: 0.3, y1: 0.3, x2: -0.3, y2: 0.3 },
        { type: "line", x1: -0.3, y1: 0.3, x2: -0.3, y2: -0.3 },
      ],
    };
    const pathSketch = {
      id: 23,
      type: "sketch",
      position: O,
      rotation: O,
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 0, y2: 5 }],
    };
    await parity("pipeItem", {
      profileSource: {
        type: "extrude",
        depth: 0,
        position: O,
        rotation: O,
        profile: {
          sketchId: 22,
          profileCentroid: { x: 0, y: 0 },
          polygon2D: [
            { x: -0.3, y: -0.3 },
            { x: 0.3, y: -0.3 },
            { x: 0.3, y: 0.3 },
            { x: -0.3, y: 0.3 },
          ],
          holes: [],
          position: O,
          rotation: O,
          normalWorld: { x: 0, y: 0, z: 1 },
        },
      },
      pathRef: { sketchId: 23, shapeIdx: 0 },
      allItems: [profileSketch, pathSketch],
      printPrecision: 0.05,
    });
  }, 60000);

  it("loft", async () => {
    const sk = (id, half, z) => ({
      id,
      type: "sketch",
      position: { x: 0, y: 0, z },
      rotation: O,
      shapes: [
        { type: "line", x1: -half, y1: -half, x2: half, y2: -half },
        { type: "line", x1: half, y1: -half, x2: half, y2: half },
        { type: "line", x1: half, y1: half, x2: -half, y2: half },
        { type: "line", x1: -half, y1: half, x2: -half, y2: -half },
      ],
    });
    const src = (sketchId, half, z) => ({
      type: "extrude",
      depth: 0,
      position: { x: 0, y: 0, z },
      rotation: O,
      profile: {
        sketchId,
        profileCentroid: { x: 0, y: 0 },
        polygon2D: [
          { x: -half, y: -half },
          { x: half, y: -half },
          { x: half, y: half },
          { x: -half, y: half },
        ],
        holes: [],
        position: { x: 0, y: 0, z },
        rotation: O,
        normalWorld: { x: 0, y: 0, z: 1 },
      },
    });
    await parity("loftItem", {
      profileSource: src(31, 1, 0),
      secondProfileSource: src(32, 0.5, 4),
      allItems: [sk(31, 1, 0), sk(32, 0.5, 4)],
      printPrecision: 0.05,
    });
  }, 60000);

  it("pattern3d circular + rectangular", async () => {
    const c = cube(16, { position: { x: 3, y: 0, z: 0 } });
    await parity("pattern3dItem", {
      patternType: "circular",
      sourceId: 16,
      params: {
        origin: O,
        axis: { x: 0, y: 0, z: 1 },
        count: 4,
        angleRad: 2 * Math.PI,
      },
      allItems: [c],
      printPrecision: 0.1,
    });
    await parity("pattern3dItem", {
      patternType: "rectangular",
      sourceId: 16,
      params: { countX: 3, countY: 1, dx: 5, dy: 0 },
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 60000);

  it("pattern3d mirror", async () => {
    const c = cube(14, { position: { x: 3, y: 0, z: 0 } });
    await parity("pattern3dItem", {
      patternType: "mirror",
      sourceId: 14,
      params: { origin: O, normal: { x: 1, y: 0, z: 0 } },
      allItems: [c],
      printPrecision: 0.1,
    });
  }, 30000);

  it("STEP export is identical apart from timestamps", async () => {
    const item = cube(15, { position: { x: 0, y: 1, z: 0 } });
    const args = { items: [item], allItems: [item], precision: 0.1 };
    const a = await ops.exportSTEP(JSON.parse(JSON.stringify(args)));
    const b = await bridge.exportSTEP(JSON.parse(JSON.stringify(args)));
    const scrub = (t) =>
      t
        .replace(/^.*DATE_TIME.*$/gm, "")
        .replace(/'[0-9-]+T[0-9:+]+'/g, "''")
        // The shared addon's STEP writer numbers each in-process export
        // ('translator 8.0 1', '... 2'); the counter isn't drift.
        .replace(/STEP translator [\d.]+ \d+/g, "STEP translator N");
    expect(scrub(b)).toBe(scrub(a));
  }, 30000);

  it("STL export is byte-identical", async () => {
    const item = cube(10, { position: { x: 0, y: 1, z: 0 } });
    const args = { items: [item], allItems: [item], precision: 0.1 };
    const a = await ops.exportSTL(JSON.parse(JSON.stringify(args)));
    const b = await bridge.exportSTL(JSON.parse(JSON.stringify(args)));
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  }, 30000);
});
