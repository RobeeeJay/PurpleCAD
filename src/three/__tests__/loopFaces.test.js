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
  // Each line overhangs the grid by half a unit: the splitter only divides a
  // line where another CROSSES it, not where one merely ends on it.  That
  // gives 213 simple cycles -- past the limit, so this takes the faces path,
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
});
