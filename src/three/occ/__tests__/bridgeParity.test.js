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

  it("weldMesh welds identically in both implementations", async () => {
    // An STL-style triangle soup: a cube with three private vertices per
    // triangle.  Both impls must return the same welded mesh and topology.
    const soup = [];
    const g = { positions: [], indices: null };
    const box = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const faces = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [2, 3, 7],
      [2, 7, 6],
      [1, 2, 6],
      [1, 6, 5],
      [3, 0, 4],
      [3, 4, 7],
    ];
    for (const f of faces) for (const v of f) soup.push(...box[v]);
    g.positions = soup;
    const a = await ops.weldMesh(JSON.parse(JSON.stringify(g)));
    const b = bridge.weldMesh(JSON.parse(JSON.stringify(g)));
    expect(a).toEqual(b);
    expect(a.verticesAfter).toBe(8);
    expect(a.openEdges).toBe(0);
  });

  it("recognizeSurfaces reports identically in both implementations", async () => {
    // A box's soup: six planes, the same regions and labels from both.
    const box = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const faces = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [2, 3, 7],
      [2, 7, 6],
      [1, 2, 6],
      [1, 6, 5],
      [3, 0, 4],
      [3, 4, 7],
    ];
    const g = {
      positions: faces.flat().flatMap((v) => box[v]),
      tolerance: 0.001,
    };
    const a = await ops.recognizeSurfaces(JSON.parse(JSON.stringify(g)));
    const b = bridge.recognizeSurfaces(JSON.parse(JSON.stringify(g)));
    expect(a).toEqual(b);
    expect(a.counts.plane).toBe(6);
  });

  it("rebuildSurfaces rebuilds identically in both implementations", async () => {
    const box = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    const faces = [
      [0, 2, 1],
      [0, 3, 2],
      [4, 5, 6],
      [4, 6, 7],
      [0, 1, 5],
      [0, 5, 4],
      [2, 3, 7],
      [2, 7, 6],
      [1, 2, 6],
      [1, 6, 5],
      [3, 0, 4],
      [3, 4, 7],
    ];
    const g = {
      positions: faces.flat().flatMap((v) => box[v]),
      tolerance: 0.001,
      printPrecision: 0.1,
    };
    const a = await ops.rebuildSurfaces(JSON.parse(JSON.stringify(g)));
    const b = bridge.rebuildSurfaces(JSON.parse(JSON.stringify(g)));
    expect({ ...a, brep: null }).toEqual({ ...b, brep: null });
    expect(a.faceTypes.plane).toBe(6);
    expect(a.volume).toBeCloseTo(1, 9);
  });

  it("simplifyMesh simplifies identically in both implementations", async () => {
    // A flat 24x24 grid: detail both impls must collapse the same way, to the
    // same bound.
    const positions = [];
    const indices = [];
    const n = 24;
    const at = (i, j) => i * (n + 1) + j;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) positions.push(i / n, 1, j / n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        indices.push(
          at(i, j),
          at(i, j + 1),
          at(i + 1, j + 1),
          at(i, j),
          at(i + 1, j + 1),
          at(i + 1, j),
        );
    const g = { positions, indices, mode: "deviation", value: 0.001 };
    const a = await ops.simplifyMesh(JSON.parse(JSON.stringify(g)));
    const b = bridge.simplifyMesh(JSON.parse(JSON.stringify(g)));
    expect(a).toEqual(b);
    expect(a.trianglesAfter).toBeLessThan(a.trianglesBefore);
  });

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

  it("chamfer on a Split piece, re-cut from its recipe", async () => {
    const c = cube(14);
    const plane = { position: O, rotation: O };
    const halves = await ops.splitItem({
      target: c,
      plane,
      allItems: [c],
      printPrecision: 0.1,
    });
    const piece = {
      id: 15,
      type: "csg",
      position: halves.partA.position,
      rotation: O,
      scale: S,
      geometryData: halves.partA.geometryData,
      regenerator: {
        kind: "split",
        sourceId: 14,
        plane,
        side: "a",
        center: halves.partA.position,
        regeneratedAt: 0.1,
      },
    };
    // The piece's top edge along X, in its own (centred) frame.
    const z = 1 - halves.partA.position.z;
    await parity("chamferOrFilletItem", {
      source: piece,
      subGeo: {
        edges: [{ ax: -1, ay: 1, az: z, bx: 1, by: 1, bz: z }],
        faces: [],
      },
      amount: 0.2,
      segments: 1,
      allItems: [c, piece],
      printPrecision: 0.1,
    });
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

  it("importStep round-trips an exported solid identically", async () => {
    // No STEP fixture is needed: export one, then read it back through both
    // implementations.  importStep returns a raw {positions, indices} rather
    // than a geometryData wrapper, so it can't use the parity() helper.
    const item = cube(16, { position: { x: 0, y: 1, z: 0 } });
    const stepText = await ops.exportSTEP({
      items: [item],
      allItems: [item],
      precision: 0.1,
    });
    const args = { stepText, printPrecision: 0.1 };
    const a = await ops.importStep(JSON.parse(JSON.stringify(args)));
    const b = await bridge.importStep(JSON.parse(JSON.stringify(args)));
    expect(summarize(b)).toEqual(summarize(a));
  }, 30000);

  it("releaseShape frees a retained id and tolerates an unknown one", async () => {
    const occ = createRequire(import.meta.url)(
      "../../../../native/occ-addon/build/Release/occ_addon.node",
    );
    // A chamfered cube's baked mesh -- a raw cube tessellation won't sew.
    const gd = (
      await ops.chamferOrFilletItem({
        source: cube(17),
        subGeo: edgeYZ,
        amount: 0.2,
        segments: 1,
        allItems: [cube(17)],
        printPrecision: 0.1,
      })
    ).geometryData;
    // One retained shape per implementation, each released by its own impl.
    const a = await ops.solidFromMesh(JSON.parse(JSON.stringify(gd)));
    const b = bridge.solidFromMesh(JSON.parse(JSON.stringify(gd)));
    expect(await ops.releaseShape({ id: a.shapeId })).toBeNull();
    expect(bridge.releaseShape({ id: b.shapeId })).toBeNull();
    // The id is gone afterwards, identically on both sides.
    expect(() => occ.tessellate(a.shapeId, 0.1)).toThrow();
    expect(() => occ.tessellate(b.shapeId, 0.1)).toThrow();
    // Releasing an unknown / null id is a no-op, never a throw.
    for (const id of [987654321, null]) {
      expect(await ops.releaseShape({ id })).toBeNull();
      expect(bridge.releaseShape({ id })).toBeNull();
    }
  }, 30000);

  // Guards a future split of occOps.js: if an op is dropped, renamed or added
  // on one side only, the two surfaces diverge and every parity test above
  // would still pass while the app lost an operation.
  it("both implementations expose the same op surface", () => {
    const bridgeOps = Object.keys(bridge)
      .filter((k) => typeof bridge[k] === "function")
      // Cancellation plumbing is native-only and has no occOps counterpart.
      .filter((k) => k !== "setCancelBuffer")
      .sort();
    expect(bridgeOps).toEqual(Object.keys(ops).sort());
  });
});
