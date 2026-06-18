// Text extrude profiles: each glyph is one ring profile (its counters stay as
// holes, not separately-selectable regions).

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildExtrudeSelectGroup } from "../sceneObjects/sketchOverlays.js";
import { makeTextShape } from "../sketchText.js";

const fillsFor = (shapes) => {
  const item = { id: 1, type: "sketch", shapes, visible: true };
  const objectsRef = { current: { 1: new THREE.Object3D() } };
  const g = buildExtrudeSelectGroup([item], objectsRef, 16, null);
  return g ? g.children : [];
};

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
