// Text extrude profiles: each glyph is one ring profile (its counters stay as
// holes, not separately-selectable regions).

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildExtrudeSelectGroup } from "../sceneObjects/sketchOverlays.js";
import { makeTextShape } from "../sketchText.js";
import { withLivePolygons } from "../csgUtils.js";

const fillsFor = (shapes) => {
  const item = { id: 1, type: "sketch", shapes, visible: true };
  const objectsRef = { current: { 1: new THREE.Object3D() } };
  const g = buildExtrudeSelectGroup([item], objectsRef, 16, null);
  return g ? g.children : [];
};

const profileCx = (poly) => poly.reduce((s, p) => s + p.x, 0) / poly.length;

describe("text extrude profiles", () => {
  it("a glyph counter stays a hole, not a separate region (o = 1 ring)", () => {
    const fills = fillsFor([
      makeTextShape({ text: "o", height: 4, font: "helvetiker", x: 0, y: 0 }),
    ]);
    expect(fills).toHaveLength(1);
    expect(fills[0].userData.extrudeProfile.holes).toHaveLength(1);
  });

  it("a glyph with two counters is one profile with two holes (B)", () => {
    const fills = fillsFor([
      makeTextShape({ text: "B", height: 4, font: "helvetiker", x: 0, y: 0 }),
    ]);
    expect(fills).toHaveLength(1);
    expect(fills[0].userData.extrudeProfile.holes).toHaveLength(2);
  });

  it("re-deriving profiles after a resolution change keeps each letter on its own region", () => {
    // Commit "Sample" extrude profiles at a coarse (preview) tolerance, then
    // re-match them against the same text re-simplified fine (print).  Each
    // profile must stay on its own glyph — a regression where a counter glyph's
    // centroid stopped landing in its re-simplified loop made the area-only
    // fallback collapse it onto a same-area letter elsewhere in the word.
    const coarse = makeTextShape({
      text: "Sample",
      height: 6,
      font: "helvetiker",
      x: 0,
      y: 0,
      tolerance: 0.05,
    });
    const fills = fillsFor([coarse]);
    const defs = fills.map((f, i) => ({
      id: 100 + i,
      type: "extrude",
      depth: "40",
      profile: f.userData.extrudeProfile,
    }));
    const fine = makeTextShape({
      text: "Sample",
      height: 6,
      font: "helvetiker",
      x: 0,
      y: 0,
      tolerance: 0.001,
    });
    const sketch = { id: 1, type: "sketch", shapes: [fine], visible: true };
    const matched = defs.map((d) => withLivePolygons(d, [sketch], 0.001));
    const before = defs.map((d) => profileCx(d.profile.polygon2D));
    const after = matched.map((d) => profileCx(d.profile.polygon2D));
    // Each letter stays put (no collapse onto a neighbour), and the six regions
    // remain distinct.
    after.forEach((x, i) => expect(x).toBeCloseTo(before[i], 0));
    expect(new Set(after.map((x) => x.toFixed(1))).size).toBe(defs.length);
  });

  it("non-text nested regions still expose their children", () => {
    // A big rect with a small rect inside → outer-with-hole AND the inner
    // region remain separately selectable (unchanged behaviour).
    const fills = fillsFor([
      { type: "rect", x1: 0, y1: 0, x2: 10, y2: 10 },
      { type: "rect", x1: 3, y1: 3, x2: 6, y2: 6 },
    ]);
    expect(fills.length).toBe(2);
  });
});
