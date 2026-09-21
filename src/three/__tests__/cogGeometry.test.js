// The sketch cog is an involute spur gear.  These pin the outline to the
// standard proportions it claims, since a gear that merely LOOKS like a gear
// won't mesh: tooth thickness at the pitch circle, tip and root radii, the
// backlash split, a root fillet that actually fits, and a clean closed loop.
import { describe, it, expect } from "vitest";
import {
  cogOutline,
  cogProblem,
  cogRadii,
  cogShapeContours,
  makeCogShape,
} from "../cogGeometry.js";

const GEAR = {
  pitchDiameter: 40,
  teeth: 20,
  backlash: 0,
  rootFillet: 0.5,
  holeDiameter: 8,
};

const radius = (q) => Math.hypot(q.x, q.y);
const signedArea = (pts) =>
  pts.reduce((s, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return s + (a.x * b.y - b.x * a.y) / 2;
  }, 0);

function selfIntersections(pts) {
  const n = pts.length;
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let count = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b] = [pts[i], pts[(i + 1) % n]];
      const [c, d] = [pts[j], pts[(j + 1) % n]];
      const d1 = cross(a, b, c),
        d2 = cross(a, b, d),
        d3 = cross(c, d, a),
        d4 = cross(c, d, b);
      if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) count++;
    }
  return count;
}

// Angles where the outline crosses the pitch circle, interpolated along the
// polyline, sorted.
function pitchCrossings(outline, rp) {
  const out = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const ra = radius(a) - rp,
      rb = radius(b) - rp;
    if (ra < 0 !== rb < 0) {
      const t = ra / (ra - rb);
      out.push(Math.atan2(a.y + (b.y - a.y) * t, a.x + (b.x - a.x) * t));
    }
  });
  return out.sort((u, v) => u - v);
}

describe("a cog's proportions", () => {
  it("follow the standard full-depth rules from pitch diameter and teeth", () => {
    const R = cogRadii(GEAR);
    expect(R.module).toBe(2);
    expect(R.tip).toBe(22); // pitch radius + one module
    expect(R.root).toBe(17.5); // pitch radius - 1.25 modules
    expect(R.base).toBeCloseTo(20 * Math.cos((20 * Math.PI) / 180), 12);
  });

  it("the outline reaches exactly the tip and root circles, never past them", () => {
    const [outline] = cogOutline(GEAR).contours;
    const rs = outline.map(radius);
    expect(Math.max(...rs)).toBeCloseTo(22, 9);
    expect(Math.min(...rs)).toBeCloseTo(17.5, 9);
  });

  it("is one clean counter-clockwise loop with a tooth per pitch", () => {
    const [outline] = cogOutline(GEAR).contours;
    expect(signedArea(outline)).toBeGreaterThan(0);
    expect(selfIntersections(outline)).toBe(0);
    // No zero-length segment: OCC's extrude wire builder rejects one.
    const shortest = Math.min(
      ...outline.map((a, i) => {
        const b = outline[(i + 1) % outline.length];
        return Math.hypot(b.x - a.x, b.y - a.y);
      }),
    );
    expect(shortest).toBeGreaterThan(1e-6);
    // Each tooth crosses the pitch circle twice.
    expect(pitchCrossings(outline, 20)).toHaveLength(40);
  });

  it("a tooth is half the circular pitch thick at the pitch circle, less half the backlash", () => {
    for (const backlash of [0, 0.2, 0.5]) {
      const g = { ...GEAR, backlash };
      const R = cogRadii(g);
      const xs = pitchCrossings(cogOutline(g).contours[0], R.pitch);
      const tooth = xs.filter((a) => Math.abs(a) < Math.PI / g.teeth);
      // Symmetric about its centre line...
      expect(tooth[0] + tooth[1]).toBeCloseTo(0, 9);
      // ...and the right thickness.  The polyline is a chord of the involute,
      // hence the looser tolerance than the tip and root checks.
      const thickness = (tooth[1] - tooth[0]) * R.pitch;
      expect(thickness, `backlash ${backlash}`).toBeCloseTo(
        (Math.PI * R.module) / 2 - backlash / 2,
        2,
      );
    }
  });

  it("works for a small coarse gear whose root is inside the base circle and a large fine one whose isn't", () => {
    for (const g of [
      { ...GEAR, teeth: 6, rootFillet: 1 },
      { ...GEAR, pitchDiameter: 120, teeth: 60 },
    ]) {
      const R = cogRadii(g);
      const [outline] = cogOutline(g).contours;
      expect(selfIntersections(outline), `${g.teeth} teeth`).toBe(0);
      expect(signedArea(outline)).toBeGreaterThan(0);
      expect(Math.min(...outline.map(radius))).toBeCloseTo(R.root, 9);
    }
    expect(cogRadii({ ...GEAR, teeth: 6 }).root).toBeLessThan(
      cogRadii({ ...GEAR, teeth: 6 }).base,
    );
    expect(cogRadii({ pitchDiameter: 120, teeth: 60 }).root).toBeGreaterThan(
      cogRadii({ pitchDiameter: 120, teeth: 60 }).base,
    );
  });
});

describe("the root fillet", () => {
  it("is drawn at the size asked for when it fits", () => {
    expect(cogOutline(GEAR).filletUsed).toBeCloseTo(0.5, 12);
  });

  it("shrinks to the largest that fits instead of breaking the outline", () => {
    const g = { ...GEAR, rootFillet: 50 };
    const { contours, filletUsed } = cogOutline(g);
    expect(filletUsed).toBeGreaterThan(0.5);
    expect(filletUsed).toBeLessThan(50);
    expect(selfIntersections(contours[0])).toBe(0);
  });

  it("rounds the root: the flank leaves the root circle further into the gap", () => {
    // Where the root circle starts, as an angle from the tooth's centre line:
    // with no fillet the flank meets it in a sharp corner; a fillet replaces
    // that corner with an arc, so the root circle begins further out.
    const rootStartsAt = (g) =>
      Math.min(
        ...cogOutline(g)
          .contours[0].filter((q) => Math.abs(radius(q) - 17.5) < 1e-9)
          .map((q) => Math.abs(Math.atan2(q.y, q.x)))
          .filter((a) => a < Math.PI / g.teeth),
      );
    const sharp = rootStartsAt({ ...GEAR, rootFillet: 0 });
    const round = rootStartsAt(GEAR);
    expect(round).toBeGreaterThan(sharp);
  });
});

describe("the centre hole", () => {
  it("is a second contour at the hole's diameter", () => {
    const { contours } = cogOutline(GEAR);
    expect(contours).toHaveLength(2);
    for (const q of contours[1]) expect(radius(q)).toBeCloseTo(4, 12);
  });

  it("is left out at diameter 0", () => {
    expect(cogOutline({ ...GEAR, holeDiameter: 0 }).contours).toHaveLength(1);
  });
});

describe("parameters that can't make a gear", () => {
  it("are explained, not drawn", () => {
    expect(cogProblem(GEAR)).toBeNull();
    expect(cogProblem({ ...GEAR, teeth: 5 })).toMatch(/at least 6/);
    expect(cogProblem({ ...GEAR, teeth: 20.5 })).toMatch(/whole number/);
    expect(cogProblem({ ...GEAR, pitchDiameter: 0 })).toMatch(/Pitch/);
    expect(cogProblem({ ...GEAR, holeDiameter: 35 })).toMatch(/root diameter/);
    expect(cogProblem({ ...GEAR, backlash: 7 })).toMatch(/Backlash/);
    expect(cogProblem({ ...GEAR, backlash: -1 })).toMatch(/negative/);
    expect(cogProblem({ ...GEAR, rootFillet: -1 })).toMatch(/negative/);
  });
});

describe("a cog shape", () => {
  it("keeps its parameters and an outline relative to its centre", () => {
    const shape = makeCogShape({ x: 5, y: -3, ...GEAR });
    expect(shape).toMatchObject({ type: "cog", x: 5, y: -3, ...GEAR });
    expect(shape.contours).toEqual(cogOutline(GEAR).contours);
    // Placed in the sketch, the outline moves with the centre.
    const placed = cogShapeContours(shape);
    expect(placed[0][0].x).toBeCloseTo(shape.contours[0][0].x + 5, 12);
    expect(placed[0][0].y).toBeCloseTo(shape.contours[0][0].y - 3, 12);
  });
});

describe("a cog in a sketch", () => {
  // The loop finder is what fills and extrusions read: a cog must come out as
  // one region -- its outline, with the centre hole as a hole in it -- not two
  // separate fills, or an extruded cog would have its hole filled in.
  it("is one region with the centre hole cut out", async () => {
    const { findClosedLoopsWithShapes, groupLoopsWithHoles } =
      await import("../sceneObjects/closedLoops.js");
    const shape = makeCogShape({ x: 3, y: 4, ...GEAR });
    const loops = findClosedLoopsWithShapes([shape]);
    expect(loops).toHaveLength(2);
    expect(loops.every((l) => l.shapeIndices[0] === 0)).toBe(true);
    const regions = groupLoopsWithHoles(loops.map((l) => l.polygon));
    const outer = regions.filter((r) => r.holes?.length);
    expect(outer).toHaveLength(1);
    expect(outer[0].holes).toHaveLength(1);
  });

  it("is turned, teeth and all, by its rotation", () => {
    const shape = makeCogShape({ x: 0, y: 0, ...GEAR });
    const half = Math.PI / GEAR.teeth; // half a tooth pitch
    const [plain] = cogShapeContours(shape);
    const [turned] = cogShapeContours({ ...shape, rotation: half });
    const a0 = Math.atan2(plain[0].y, plain[0].x);
    const a1 = Math.atan2(turned[0].y, turned[0].x);
    expect(a1 - a0).toBeCloseTo(half, 12);
  });
});
