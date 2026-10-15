// A sketch loop is a polygon sampled from its curves, and an OCC solid built
// from that polygon has one flat face per sample: a cut cylinder comes back as
// 32-77 planes, which every later boolean keeps.  So each loop also records
// which edges lie on which exact curve, for the solid to be built from the
// curve itself.  A run that pointed at the wrong vertices would build an arc
// through the wrong points, so these check every run against its own polygon.
import { describe, it, expect } from "vitest";
import {
  findClosedLoopsWithShapes,
  regionsWithShapes,
  reverseEdgeCurves,
} from "../sceneObjects/closedLoops.js";
import { extrudeWithLivePolygon } from "../csgUtils.js";
import * as THREE from "three";
import { smoothCurvedWalls } from "../sceneObjects/sceneBuilder.js";
import { polyAreaCentroid, withWinding } from "../sceneObjects/polygonUtil.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const circle = (cx, cy, r) => ({ type: "circle", cx, cy, r });

// Every vertex a run spans -- its `count` edges reach count + 1 vertices --
// lies on the run's curve, and no edge is claimed twice.
function checkRuns(polygon, runs, label) {
  const n = polygon.length;
  const claimed = new Set();
  for (const run of runs) {
    expect(run.count, `${label}: empty run`).toBeGreaterThan(0);
    for (let k = 0; k < run.count; k++) {
      const e = (run.start + k) % n;
      expect(claimed.has(e), `${label}: edge ${e} claimed twice`).toBe(false);
      claimed.add(e);
    }
    for (let k = 0; k <= run.count; k++) {
      const v = polygon[(run.start + k) % n];
      if (run.type === "arc") {
        const d = Math.hypot(v.x - run.cx, v.y - run.cy);
        expect(
          Math.abs(d - run.r),
          `${label}: vertex ${(run.start + k) % n} is ${d} from the centre, radius ${run.r}`,
        ).toBeLessThan(1e-9);
      } else if (run.type === "ellipse") {
        const q =
          ((v.x - run.cx) / run.rx) ** 2 + ((v.y - run.cy) / run.ry) ** 2;
        expect(
          Math.abs(q - 1),
          `${label}: off the ellipse by ${q}`,
        ).toBeLessThan(1e-9);
      }
    }
    if (run.type === "bezier") {
      const a = polygon[run.start % n];
      const b = polygon[(run.start + run.count) % n];
      const ends = [run.p0, run.p3];
      const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
      expect(
        (near(a, ends[0]) && near(b, ends[1])) ||
          (near(a, ends[1]) && near(b, ends[0])),
        `${label}: bezier run ends ${JSON.stringify([a, b])} vs ${JSON.stringify(ends)}`,
      ).toBe(true);
    }
  }
  return claimed.size;
}

describe("a loop records the exact curves under its polygon", () => {
  it("a lone circle is one arc run round the whole loop", () => {
    const [loop] = findClosedLoopsWithShapes([circle(1, 2, 0.5)], 32, 0.05);
    expect(loop.curves).toHaveLength(1);
    expect(loop.curves[0]).toMatchObject({ type: "arc", cx: 1, cy: 2, r: 0.5 });
    expect(checkRuns(loop.polygon, loop.curves, "circle")).toBe(
      loop.polygon.length,
    );
  });

  it("a rectangle has no curved edges", () => {
    const [loop] = findClosedLoopsWithShapes(
      [{ type: "rect", x1: 0, y1: 0, x2: 2, y2: 1 }],
      32,
      0.05,
    );
    expect(loop.curves).toEqual([]);
  });

  it("a circle crossing a rectangle gives arc runs on that circle only", () => {
    const shapes = [
      { type: "rect", x1: 0, y1: 0, x2: 2, y2: 2 },
      circle(2, 1, 0.6),
    ];
    const loops = findClosedLoopsWithShapes(shapes, 32, 0.05);
    expect(loops.length).toBeGreaterThan(2);
    let curved = 0;
    loops.forEach((l, i) => {
      curved += checkRuns(l.polygon, l.curves, `loop ${i}`);
      // Straight edges are the rectangle's sides: at most four pieces each.
      expect(
        l.polygon.length - l.curves.reduce((s, r) => s + r.count, 0),
      ).toBeLessThanOrEqual(6);
    });
    expect(curved).toBeGreaterThan(0);
  });

  it("a slot of two arcs and two lines records both arcs", () => {
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
    const [loop] = findClosedLoopsWithShapes(shapes, 32, 0.05);
    expect(loop.curves.map((r) => r.cx).sort()).toEqual([0, 2]);
    expect(checkRuns(loop.polygon, loop.curves, "slot")).toBe(
      loop.polygon.length - 2,
    );
  });

  it("an ellipse and a bezier-closed loop are recorded too", () => {
    const [ell] = findClosedLoopsWithShapes(
      [{ type: "ellipse", cx: 0, cy: 0, rx: 2, ry: 1 }],
      32,
      0.05,
    );
    checkRuns(ell.polygon, ell.curves, "ellipse");
    expect(ell.curves[0].type).toBe("ellipse");

    const shapes = [
      line(0, 0, 2, 0),
      {
        type: "bezier",
        p0: { x: 2, y: 0 },
        p1: { x: 2, y: 1.5 },
        p2: { x: 0, y: 1.5 },
        p3: { x: 0, y: 0 },
      },
    ];
    const [d] = findClosedLoopsWithShapes(shapes, 32, 0.05);
    expect(d.curves.map((r) => r.type)).toEqual(["bezier"]);
    expect(checkRuns(d.polygon, d.curves, "bezier")).toBe(d.polygon.length - 1);
  });

  it("overlapping circles past the cycle limit still carry their arcs", () => {
    // Six circles take the arrangement-faces path, including reversed outlines.
    const radii = [0.2, 0.4, 0.55];
    const shapes = [
      ...radii.map((r) => circle(0, 0, r)),
      ...radii.map((r) => circle(0, 0.5, r)),
    ];
    const loops = findClosedLoopsWithShapes(shapes, 32, 0.05);
    loops.forEach((l, i) => {
      // Every edge of a loop made only of circles is curved.
      expect(checkRuns(l.polygon, l.curves, `face ${i}`)).toBe(
        l.polygon.length,
      );
    });
  });
});

describe("reversing a loop moves its runs with it", () => {
  it("maps each run onto the same vertices of the reversed polygon", () => {
    const shapes = [
      { type: "rect", x1: 0, y1: 0, x2: 2, y2: 2 },
      circle(2, 1, 0.6),
    ];
    for (const l of findClosedLoopsWithShapes(shapes, 32, 0.05)) {
      const rev = l.polygon.slice().reverse();
      const runs = reverseEdgeCurves(l.curves, l.polygon.length);
      expect(checkRuns(rev, runs, "reversed")).toBe(
        checkRuns(l.polygon, l.curves, "forward"),
      );
    }
  });
});

describe("an extrude's curves are re-derived with its polygon", () => {
  // The rebuild re-reads the polygon from the live sketch; curves left from
  // creation would index vertices of a polygon that no longer exists.
  it("a grown bore carries the new radius and the new vertex count", () => {
    const shapes = [
      { type: "rect", x1: -2, y1: -2, x2: 2, y2: 2 },
      circle(0, 0, 0.5),
    ];
    const sketch = { id: 1, type: "sketch", shapes };
    const plate = regionsWithShapes(shapes, 32, 0.05).find(
      (g) => g.holes.length === 1,
    );
    const item = {
      id: 2,
      type: "extrude",
      profile: {
        sketchId: 1,
        polygon2D: plate.polygon,
        holes: plate.holes,
        loopShapes: plate.loopShapes,
        curves2D: plate.curves,
        profileCentroid: { x: 1.5, y: 1.5 },
      },
    };
    const grown = {
      ...sketch,
      shapes: [shapes[0], circle(0, 0, 1.2)],
    };
    const live = extrudeWithLivePolygon(item, [grown, item], 0.05);
    const hole = live.profile.holes[0];
    const [run] = live.profile.curves2D.holes[0];
    expect(run.r).toBe(1.2);
    expect(checkRuns(hole, live.profile.curves2D.holes[0], "bore")).toBe(
      hole.length,
    );
    expect(live.profile.curves2D.outer).toEqual([]);
  });
});

describe("a plain extrude's curved walls shade round", () => {
  // Built the way sceneBuilder builds an extrude: centred on the area centroid,
  // outer loop CCW, holes CW.
  function extrudeOf(shapes) {
    const g =
      regionsWithShapes(shapes, 32, 0.05).find(
        (r) => r.loopShapes.outer.length > 0 && r.holes.length > 0,
      ) || regionsWithShapes(shapes, 32, 0.05)[0];
    const c = polyAreaCentroid(g.polygon);
    const shift = (pts) =>
      pts.map((p) => new THREE.Vector2(p.x - c.x, p.y - c.y));
    const shape = new THREE.Shape(shift(withWinding(g.polygon, true)));
    g.holes.forEach((h) =>
      shape.holes.push(new THREE.Path(shift(withWinding(h, false)))),
    );
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 1,
      bevelEnabled: false,
    });
    geometry.computeVertexNormals();
    const loops = [
      { polygon: g.polygon, runs: g.curves.outer },
      ...g.holes.map((h, i) => ({ polygon: h, runs: g.curves.holes[i] })),
    ];
    return { geometry, loops, c };
  }
  // Wall vertices (normal in plan) as [x, y, nx, ny] in sketch coordinates.
  const wallNormals = (geometry, c) => {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    const out = [];
    for (let i = 0; i < p.count; i++)
      if (Math.abs(n.getZ(i)) < 1e-6)
        out.push([p.getX(i) + c.x, p.getY(i) + c.y, n.getX(i), n.getY(i)]);
    return out;
  };

  it("a bore's wall faces its axis, exactly radially; the plate's sides stay flat", () => {
    const { geometry, loops, c } = extrudeOf([
      { type: "rect", x1: -2, y1: -2, x2: 2, y2: 2 },
      circle(0.3, -0.2, 1),
    ]);
    const before = wallNormals(geometry, c);
    smoothCurvedWalls(geometry, loops, c);
    const after = wallNormals(geometry, c);
    let bore = 0;
    after.forEach(([x, y, nx, ny], i) => {
      const r = Math.hypot(x - 0.3, y + 0.2);
      if (Math.abs(r - 1) < 1e-4) {
        bore++;
        // Inward: the normal is minus the radial direction.
        const err = Math.hypot(nx + (x - 0.3) / r, ny + (y + 0.2) / r);
        expect(err, `bore normal at (${x}, ${y}) off by ${err}`).toBeLessThan(
          1e-5,
        );
      } else {
        expect([nx, ny], `side wall at (${x}, ${y})`).toEqual([
          before[i][2],
          before[i][3],
        ]);
      }
    });
    expect(bore).toBeGreaterThan(100);
  });

  it("a slot's line walls are left alone and its arc walls face outward", () => {
    const { geometry, loops, c } = extrudeOf([
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
    smoothCurvedWalls(geometry, loops, c);
    for (const [x, y, nx, ny] of wallNormals(geometry, c)) {
      if (x > 0 && x < 2) {
        // A flat side: straight up or down.
        expect(Math.abs(nx), `flat wall at (${x}, ${y})`).toBeLessThan(1e-6);
        continue;
      }
      const cx = x >= 2 ? 2 : 0;
      const r = Math.hypot(x - cx, y - 0.5);
      const err = Math.hypot(nx - (x - cx) / r, ny - (y - 0.5) / r);
      expect(err, `end wall at (${x}, ${y}) off by ${err}`).toBeLessThan(1e-5);
    }
  });
});
