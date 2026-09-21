// Regression: chamfering the rim of an extruded hollow cylinder.  The failure
// report ("geometry rejected the operation") turned out to be a hard geometric
// limit — chamfering ONLY the outer ring by >= the wall thickness would drive
// the chamfer face into the inner wall, which OCC rejects.  Any distance below
// the wall thickness succeeds; selecting the whole top face (both rings) bevels
// both edges of the rim, so there the limit is HALF the wall.  These tests pin
// the supported cases so the extrude->chamfer path can't regress.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { ensureOcc } from "../init.js";
import { makeExtrude } from "../primitives.js";
import { tessellate } from "../tessellate.js";
import { chamferShapeBy } from "../operations.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const circle = (r, n) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
};

const outerTopRingEdges = (outer, depth) => {
  const e = [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    e.push({ ax: a.x, ay: a.y, az: depth, bx: b.x, by: b.y, bz: depth });
  }
  return e;
};

const hollow = (n, rOuter, rInner) =>
  makeExtrude({
    type: "extrude",
    profile: { polygon2D: circle(rOuter, n), holes: [circle(rInner, n)] },
    depth: 2,
  });

describe("hollow cylinder rim chamfer", () => {
  it("chamfers the connected outer top ring below the wall thickness", () => {
    const solid = hollow(64, 3, 2); // wall thickness 1
    const chamfered = chamferShapeBy(
      solid,
      { edges: outerTopRingEdges(circle(3, 64), 2), faces: [] },
      0.5,
    );
    expect(chamfered).not.toBe(solid);
    expect(
      tessellate(chamfered, null).getAttribute("position").count,
    ).toBeGreaterThan(0);
  });

  it("bevels the whole top rim (both rings via the face) below half the wall", () => {
    const solid = hollow(64, 3, 2); // wall thickness 1
    const chamfered = chamferShapeBy(
      solid,
      { edges: [], faces: [{ nx: 0, ny: 0, nz: 1, cx: 2.5, cy: 0, cz: 2 }] },
      0.45,
    );
    expect(chamfered).not.toBe(solid);
    expect(
      tessellate(chamfered, null).getAttribute("position").count,
    ).toBeGreaterThan(0);
  });

  // This case used to "pass" at 0.6: two 0.6 bevels on a 1.0 wall overlap,
  // and OCC reported success with a solid whose surface was open (128
  // unshared mesh edges, measured) -- the same broken result as a 1 mm bevel
  // on a cog's 1.4 mm tooth tips.  An invalid bevel is now refused.
  it("refuses a whole-rim bevel wider than half the wall", () => {
    const solid = hollow(64, 3, 2);
    expect(() =>
      chamferShapeBy(
        solid,
        { edges: [], faces: [{ nx: 0, ny: 0, nz: 1, cx: 2.5, cy: 0, cz: 2 }] },
        0.6,
      ),
    ).toThrow(/invalid solid/);
  });

  it("rejects an outer-ring chamfer wider than the wall (a clear error)", () => {
    const solid = hollow(64, 3, 2.8); // wall thickness 0.2
    expect(() =>
      chamferShapeBy(
        solid,
        { edges: outerTopRingEdges(circle(3, 64), 2), faces: [] },
        0.2, // == wall thickness → geometrically impossible
      ),
    ).toThrow(/Chamfer failed/);
  });
});
