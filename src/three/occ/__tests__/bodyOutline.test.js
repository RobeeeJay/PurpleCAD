// A body's outline is its REAL edges.  The crease detector it used to be drawn
// with (EdgesGeometry at 1 degree) also drew every seam between the triangles
// of a curved face, so an exact cylinder showed 45 lines down its side and
// looked faceted though its surface was exact and smoothly shaded.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import * as THREE from "three";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";
import {
  bodyOutline,
  extrudeOutline,
} from "../../sceneObjects/sceneBuilder.js";
import { regionsWithShapes } from "../../sceneObjects/closedLoops.js";
import {
  packGeometryData,
  unpackGeometryData,
} from "../../../store/geometryPack.js";

const require_ = createRequire(import.meta.url);
const bridge = require_("../../../../electron/occ-bridge.cjs");
const occ = require_(
  "../../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// The edge segments' end points, as [x, y, z] pairs.
const segments = ({ positions: P, edges: E }) => {
  const out = [];
  for (let i = 0; i < E.length; i += 2)
    out.push(
      [E[i], E[i + 1]].map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]),
    );
  return out;
};

describe("the edges OCC hands back with a mesh", () => {
  it("are a cylinder's two rims and nothing down its side", () => {
    // makeCylinder: axis +Y, y from -1 to 1, radius 1.
    const id = occ.makeCylinder(-1, 1, 2);
    const mesh = occ.tessellate(id, 0.05);
    occ.releaseShape(id);
    const segs = segments(mesh);
    expect(segs.length).toBeGreaterThan(20);
    for (const [a, b] of segs) {
      // Both ends on the same rim: no segment runs up the wall.
      expect(Math.abs(Math.abs(a[1]) - 1), `segment ${a} - ${b}`).toBeLessThan(
        1e-6,
      );
      expect(b[1]).toBeCloseTo(a[1], 6);
    }
  });

  it("are a box's twelve edges", () => {
    const id = occ.makeBox(0, 0, 0, 1, 2, 3);
    const mesh = occ.tessellate(id, 0.05);
    occ.releaseShape(id);
    expect(mesh.edges.length / 2).toBe(12);
  });

  it("leave the wall of a bore cut through a box blank", () => {
    const box = occ.makeBox(-2, -1, -2, 2, 1, 2);
    const tool = occ.makeCylinder(-2, 1, 4);
    const cut = occ.booleanOp([box, tool], "difference");
    const mesh = occ.tessellate(cut, 0.05);
    for (const id of [box, tool, cut]) occ.releaseShape(id);
    // The bore's wall is every point 1 from the y axis between its rims; no
    // segment may run along it (one end on each rim).
    for (const [a, b] of segments(mesh)) {
      const onWall = (p) => Math.abs(Math.hypot(p[0], p[2]) - 1) < 1e-6;
      if (onWall(a) && onWall(b))
        expect(b[1], `segment ${a} - ${b} runs up the bore`).toBeCloseTo(
          a[1],
          6,
        );
    }
  });
});

describe("an op's result keeps its edges", () => {
  const O = { x: 0, y: 0, z: 0 };
  const S = { x: 1, y: 1, z: 1 };
  const a = { id: 1, type: "cube", position: O, rotation: O, scale: S };
  const b = {
    id: 2,
    type: "cube",
    position: { x: 0.5, y: 0.4, z: 0.3 },
    rotation: { x: 0, y: 0.3, z: 0 },
    scale: S,
  };
  const args = {
    selectedItems: [a, b],
    allItems: [a, b],
    operation: "difference",
    printPrecision: 0.05,
  };

  it("in both OCC implementations, through a save", async () => {
    const [x, y] = await Promise.all([
      ops.performCsg(JSON.parse(JSON.stringify(args))),
      bridge.performCsg(JSON.parse(JSON.stringify(args))),
    ]);
    expect(x.geometryData.edges.length).toBeGreaterThan(0);
    expect(y.geometryData.edges).toEqual(x.geometryData.edges);
    // Every index names a vertex of the mesh.
    const n = x.geometryData.positions.length / 3;
    expect(Math.max(...x.geometryData.edges)).toBeLessThan(n);
    // A save packs the mesh; the edges must come back out.
    const padded = {
      ...x.geometryData,
      positions: [...x.geometryData.positions, ...new Array(3000).fill(0)],
    };
    const back = unpackGeometryData(
      JSON.parse(JSON.stringify(packGeometryData(padded))),
    );
    expect(back.edges).toEqual(x.geometryData.edges);
  }, 30000);

  it("and the viewport draws exactly those", async () => {
    const res = await ops.performCsg(JSON.parse(JSON.stringify(args)));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(res.geometryData.positions),
        3,
      ),
    );
    geometry.setIndex(
      new THREE.BufferAttribute(new Uint32Array(res.geometryData.indices), 1),
    );
    const outline = bodyOutline(
      { type: "csg", geometryData: res.geometryData },
      geometry,
    );
    expect(Array.from(outline.index.array)).toEqual(res.geometryData.edges);
  }, 30000);
});

describe("a plain extrude's outline", () => {
  // Upright lines in an extrude outline: segments whose ends differ in z.
  const uprights = (g) => {
    const p = g.attributes.position.array;
    let n = 0;
    for (let i = 0; i < p.length; i += 6) if (p[i + 2] !== p[i + 5]) n++;
    return n;
  };
  const outlineOf = (shapes) => {
    const [g] = regionsWithShapes(shapes, 32, 0.05).sort(
      (u, v) => v.holes.length - u.holes.length,
    );
    return extrudeOutline(
      [
        { polygon: g.polygon, runs: g.curves.outer },
        ...g.holes.map((h, i) => ({ polygon: h, runs: g.curves.holes[i] })),
      ],
      { x: 0, y: 0 },
      0,
      1,
    );
  };
  const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

  it("has no line down a cylinder", () => {
    expect(uprights(outlineOf([{ type: "circle", cx: 0, cy: 0, r: 1 }]))).toBe(
      0,
    );
  });

  it("has one at each corner of a plate, and none down its bore", () => {
    const plate = outlineOf([
      { type: "rect", x1: -2, y1: -2, x2: 2, y2: 2 },
      { type: "circle", cx: 0, cy: 0, r: 1 },
    ]);
    expect(uprights(plate)).toBe(4);
  });

  it("has none on a slot, whose arcs meet its sides smoothly", () => {
    const slot = outlineOf([
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
    expect(uprights(slot)).toBe(0);
  });

  it("has one at each corner of a bezier D, and none along its curve", () => {
    // A bezier's inner samples have no closed-form tangent here; it is the
    // run, not the angle between chords, that says they are no corner.
    const d = outlineOf([
      line(0, 0, 2, 0),
      {
        type: "bezier",
        p0: { x: 2, y: 0 },
        p1: { x: 2, y: 1.5 },
        p2: { x: 0, y: 1.5 },
        p3: { x: 0, y: 0 },
      },
    ]);
    expect(uprights(d)).toBe(2);
  });
});
