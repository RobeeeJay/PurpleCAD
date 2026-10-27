// Region finding enumerated EVERY simple cycle, which also returns every union
// of adjacent regions.  On overlapping geometry that explodes: six circles --
// a pasted set of three concentric circles nudged over its original, in a real
// project -- gave 6211 loops and 1.28M points, and grouping them into regions
// took 142 s on the main thread.  The window stopped taking input mid-nudge.
// Past a limit the finder now returns the arrangement's faces instead.
import { describe, it, expect } from "vitest";
import {
  findClosedLoopsWithShapes,
  groupLoopsWithHoles,
  polyArea,
  regionsWithShapes,
} from "../sceneObjects/closedLoops.js";

// The project's circles: three concentric, and their pasted copy `off` above.
const CX = 0.17172724505066023;
const CY = -1.5682384376548113;
const RADII = [0.19781229496611732, 0.4017125946771189, 0.5482820541260085];
const sixCircles = (off) => [
  ...RADII.map((r) => ({ type: "circle", cx: CX, cy: CY, r })),
  ...RADII.map((r) => ({ type: "circle", cx: CX, cy: CY + off, r })),
];

// Area of the union of two circles of radius r whose centres are d apart.
const unionOfTwo = (r, d) =>
  2 * Math.PI * r * r -
  (2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d));

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });

describe("overlapping circles", () => {
  // 0.6 gave 352 loops before; 0.55 gave 6211, 0.5 more still.
  for (const off of [0.6, 0.55, 0.5]) {
    it(`finds the regions of the copy ${off} above its original, quickly`, () => {
      const t0 = Date.now();
      const loops = findClosedLoopsWithShapes(sixCircles(off), 32, null);
      groupLoopsWithHoles(loops.map((l) => l.polygon));
      const ms = Date.now() - t0;
      expect(ms, `find + group took ${ms} ms`).toBeLessThan(2000);
      expect(loops.length, `${loops.length} loops`).toBeLessThan(60);

      // The faces TILE the union of the two outer circles, and the one piece's
      // outline is that union: overlap anywhere would overshoot, a missed face
      // would fall short.
      const union = unionOfTwo(RADII[2], off);
      const areas = loops.map((l) => polyArea(l.polygon)).sort((a, b) => b - a);
      const [outline, ...faces] = areas;
      const faceSum = faces.reduce((s, a) => s + a, 0);
      // Sampled curves sit a hair inside the true circles.
      expect(outline / union, "outline vs union").toBeCloseTo(1, 1);
      expect(
        faceSum / outline,
        `faces sum ${faceSum} vs ${outline}`,
      ).toBeCloseTo(1, 3);
      for (const a of faces) expect(a).toBeGreaterThan(0);
    });
  }
});

describe("a 3 x 3 grid of crossing lines", () => {
  // Each line overhangs the grid by half a unit, so every line crosses every
  // other through its interior.  That gives 213 simple cycles -- past the limit, so this takes the faces path,
  // where the right answer is plain: nine unit cells and their outline.
  const grid = () => {
    const shapes = [];
    for (let i = 0; i <= 3; i++) {
      shapes.push(line(-0.5, i, 3.5, i));
      shapes.push(line(i, -0.5, i, 3.5));
    }
    return shapes;
  };

  it("is nine cells and their outline", () => {
    const areas = findClosedLoopsWithShapes(grid(), 32, null)
      .map((l) => polyArea(l.polygon))
      .sort((a, b) => a - b);
    expect(areas).toHaveLength(10);
    for (const a of areas.slice(0, 9)) expect(a).toBeCloseTo(1, 6);
    expect(areas[9]).toBeCloseTo(9, 6);
  });

  it("leaves the overhanging stubs out of every region", () => {
    // The stubs bound nothing; a face traced round one would carry a
    // zero-width spike that OCC's wire builder rejects.
    for (const l of findClosedLoopsWithShapes(grid(), 32, null))
      for (const p of l.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(3 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(3 + 1e-9);
      }
  });
});

describe("a line that ends on two sides of a rectangle", () => {
  // A T-junction at each end: the line stops ON the top and bottom without
  // crossing them.  The splitter used to divide a line only where another
  // crossed it, so the sides were never split there and the only region was
  // the whole rectangle -- a 0.2-wide strip down a cabinet panel, drawn this
  // way, could not be picked to extrude.
  it("divides it into the strip and the rest", () => {
    const shapes = [
      line(-25.365, 5.54, 1.335, 5.54),
      line(1.335, 5.54, 1.335, -16.86),
      line(1.335, -16.86, -25.365, -16.86),
      line(-25.365, -16.86, -25.365, 5.54),
      line(1.135, 5.54, 1.135, -16.86),
    ];
    const areas = findClosedLoopsWithShapes(shapes, 32, null)
      .map((l) => polyArea(l.polygon))
      .sort((a, b) => a - b);
    expect(areas, `regions ${areas.map((a) => a.toFixed(3))}`).toHaveLength(3);
    expect(areas[0], "the strip").toBeCloseTo(0.2 * 22.4, 6);
    expect(areas[1], "the rest").toBeCloseTo(26.5 * 22.4, 6);
    expect(areas[2], "the whole").toBeCloseTo(26.7 * 22.4, 6);
  });

  it("makes no region of nothing: the whole rectangle has no holes", () => {
    // The panel and the strip touch the rectangle's own outline, so they are
    // regions inside it, not holes in it.  As holes they left a rectangle of
    // no area whose holes shared its edges; a click on the dividing line
    // picked it, OCC built it into a broken prism, and the extrude fused
    // from it lost the strip.
    const shapes = [
      line(-25.365, 5.54, 1.335, 5.54),
      line(1.335, 5.54, 1.335, -16.86),
      line(1.335, -16.86, -25.365, -16.86),
      line(-25.365, -16.86, -25.365, 5.54),
      line(1.135, 5.54, 1.135, -16.86),
    ];
    const net = regionsWithShapes(shapes, 32, null)
      .map(
        (r) =>
          polyArea(r.polygon) - r.holes.reduce((a, h) => a + polyArea(h), 0),
      )
      .sort((a, b) => a - b)
      .map((a) => +a.toFixed(3));
    expect(net).toEqual([4.48, 593.6, 598.08]);
    // The whole rectangle runs straight past where the divider meets its top
    // and bottom: four corners, not six.
    const whole = regionsWithShapes(shapes, 32, null).find(
      (r) => Math.abs(polyArea(r.polygon) - 598.08) < 1e-3,
    );
    expect(whole.polygon, "the whole rectangle's outline").toHaveLength(4);
  });

  it("leaves screw-hole legs along the sides out of the plate's outline", () => {
    // A circle at each corner, tied there by a leg ALONG the side and a leg
    // up to its centre (the project box lid).  The second leg starts on the
    // side, so the side is split there -- and the first leg then duplicates
    // that piece of the side.  The duplicate made a cycle of no area and
    // stood in for the side, so the outline named the leg and the plate's
    // extrude no longer matched it.
    const w = 3,
      d = 2,
      t = 0.1;
    const shapes = [
      line(0, 0, w, 0),
      line(w, 0, w, d),
      line(w, d, 0, d),
      line(0, d, 0, 0),
    ];
    for (const [cx, cy, sx, sy] of [
      [0, 0, 1, 1],
      [w, 0, -1, 1],
      [w, d, -1, -1],
      [0, d, 1, -1],
    ]) {
      shapes.push(line(cx, cy, cx + sx * t, cy));
      shapes.push(line(cx + sx * t, cy, cx + sx * t, cy + sy * t));
      shapes.push({
        type: "circle",
        cx: cx + sx * t,
        cy: cy + sy * t,
        r: 0.04,
      });
    }
    const regions = regionsWithShapes(shapes, 32, null);
    for (const r of regions)
      expect(polyArea(r.polygon), "a region of no area").toBeGreaterThan(1e-6);
    const plate = regions.find(
      (r) => Math.abs(polyArea(r.polygon) - w * d) < 1e-6,
    );
    expect(plate, "the plate's region").toBeDefined();
    expect(plate.loopShapes.outer.sort()).toEqual([0, 1, 2, 3]);
    expect(plate.holes, "the four circles as holes").toHaveLength(4);
    // Each side is still ONE edge where a leg ends on it: a vertex there made
    // the extrude build the side as two faces, and push/pull on the lid could
    // no longer offset its faces together.
    expect(
      plate.polygon.length,
      `outline ${JSON.stringify(plate.polygon)}`,
    ).toBe(4);
  });

  it("leaves parallel lines that overlap alone", () => {
    // A collinear overlap is no junction; splitting both at each other's ends
    // would double the edge between.
    const shapes = [
      line(0, 0, 4, 0),
      line(4, 0, 4, 2),
      line(4, 2, 0, 2),
      line(0, 2, 0, 0),
      line(1, 0, 3, 0),
    ];
    const areas = findClosedLoopsWithShapes(shapes, 32, null).map((l) =>
      polyArea(l.polygon),
    );
    expect(areas).toHaveLength(1);
    expect(areas[0]).toBeCloseTo(8, 6);
  });
});

describe("a small sketch", () => {
  // Below the limit nothing changes, including the union loops -- an extrude
  // made from a rectangle before a diagonal was drawn across it is matched
  // back to the rectangle, which only the cycle search returns.
  it("still gets every cycle: both triangles and the whole rectangle", () => {
    const shapes = [
      line(0, 0, 4, 0),
      line(4, 0, 4, 2),
      line(4, 2, 0, 2),
      line(0, 2, 0, 0),
      line(0, 0, 4, 2),
    ];
    const areas = findClosedLoopsWithShapes(shapes, 32, null)
      .map((l) => polyArea(l.polygon))
      .sort((a, b) => a - b);
    expect(areas).toHaveLength(3);
    expect(areas[0]).toBeCloseTo(4, 6);
    expect(areas[1]).toBeCloseTo(4, 6);
    expect(areas[2]).toBeCloseTo(8, 6);
  });

  it("keeps the triangles' region of their rectangle a whole one", () => {
    // The triangles tile the rectangle, touching its outline: neighbours in
    // it, not holes, so the rectangle's region (kept for an extrude made
    // before the diagonal) is the rectangle, not a shape with no area.
    const shapes = [
      line(0, 0, 4, 0),
      line(4, 0, 4, 2),
      line(4, 2, 0, 2),
      line(0, 2, 0, 0),
      line(0, 0, 4, 2),
    ];
    const whole = regionsWithShapes(shapes, 32, null).find(
      (r) => Math.abs(polyArea(r.polygon) - 8) < 1e-6,
    );
    expect(whole.holes).toEqual([]);
  });

  it("still cuts a hole strictly inside", () => {
    const shapes = [
      line(0, 0, 4, 0),
      line(4, 0, 4, 2),
      line(4, 2, 0, 2),
      line(0, 2, 0, 0),
      { type: "circle", cx: 2, cy: 1, r: 0.5 },
    ];
    const outer = regionsWithShapes(shapes, 32, null).find(
      (r) => Math.abs(polyArea(r.polygon) - 8) < 1e-6,
    );
    expect(outer.holes).toHaveLength(1);
  });
});
