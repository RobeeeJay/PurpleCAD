// Regression: resizing a concentric ring extrude must keep the OUTER loop (+its
// hole), not collapse to the inner disc.  The inner circle appears both as the
// outer entry's hole and as a spurious standalone disc with the same centroid,
// so the area tiebreak (vs the stale stored area) used to pick the disc after a
// resize — extruding a solid inner cylinder instead of the ring.

import { describe, it, expect, vi } from "vitest";

vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class {} }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));

import { extrudeWithLivePolygon } from "../csgUtils.js";

const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
};
// crude polygon ring for the STORED profile (centre (1,0)); only needs holes
// present so the fix recognises the profile was a ring.
const ringPoly = (r) => {
  const pts = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI;
    pts.push({ x: 1 + r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
};

describe("ring extrude live-profile after a resize", () => {
  it("keeps the outer loop and hole, not the inner disc", () => {
    const item = {
      id: 2,
      type: "extrude",
      depth: 2,
      profile: {
        sketchId: 1,
        profileCentroid: { x: 1, y: 0 },
        polygon2D: ringPoly(2.2), // stored OLD outer (r=2.2)
        holes: [ringPoly(1.95)], // stored had a hole → it was a ring
      },
    };
    // Live sketch resized to r=3.2 outer / 2.95 inner.
    const sketch = {
      id: 1,
      type: "sketch",
      shapes: [
        { type: "circle", cx: 1, cy: 0, r: 3.2 },
        { type: "circle", cx: 1, cy: 0, r: 2.95 },
      ],
    };

    const live = extrudeWithLivePolygon(item, [sketch], null);
    const a = area(live.profile.polygon2D);
    // Outer at r=3.2 ⇒ area ≈ π·3.2² ≈ 32, NOT the inner disc (~27) or stale ~15.
    expect(a).toBeGreaterThan(30);
    expect(live.profile.holes.length).toBe(1); // hole preserved → still a ring
  });
});
