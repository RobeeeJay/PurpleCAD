// Regression: editing an extrude from the timeline preselected the WRONG
// region.  The old matcher took "the smallest region containing the stored
// profile centroid" — but a ring-shaped profile's centroid sits inside its own
// hole, so the real region was skipped by the hole test and a nested region
// won instead.  Starting the edit on the wrong geometry then forced corrective
// clicks, which accumulated a second profile and spawned extra timeline
// entries.  bestProfileMatchIndex matches on the polygon itself.

import { describe, it, expect } from "vitest";
import { bestProfileMatchIndex } from "../extrudeGeometry.js";

const rect = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];
// A closed regular polygon approximating a circle, for the "hole" region.
const circle = (cx, cy, r, n = 32) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

describe("bestProfileMatchIndex", () => {
  it("picks the ring, not the nested hole region, for a holed profile", () => {
    // The real case: an 8x6 plate with a circular hole.  Its stored centroid
    // (0,0) lies INSIDE the hole — what broke the old containment matcher.
    const stored = {
      sketchId: 300,
      polygon2D: rect(-4, -3, 4, 3),
      holes: [circle(0, 0, 1.5)],
      profileCentroid: { x: 0, y: 0 },
    };
    const candidates = [
      {
        sketchId: 300,
        polygon2D: rect(-4, -3, 4, 3),
        holes: [circle(0, 0, 1.5)],
      },
      { sketchId: 300, polygon2D: circle(0, 0, 1.5), holes: [] },
    ];
    expect(bestProfileMatchIndex(stored, candidates)).toBe(0);
  });

  it("separates two equal-area regions by centroid", () => {
    const stored = {
      sketchId: 300,
      polygon2D: rect(1, -2, 4, 2),
      holes: [],
      profileCentroid: { x: 2.5, y: 0 },
    };
    const candidates = [
      { sketchId: 300, polygon2D: rect(-4, -2, -1, 2), holes: [] },
      { sketchId: 300, polygon2D: rect(1, -2, 4, 2), holes: [] },
    ];
    expect(bestProfileMatchIndex(stored, candidates)).toBe(1);
  });

  it("ignores regions from a different sketch", () => {
    const stored = {
      sketchId: 300,
      polygon2D: rect(0, 0, 2, 2),
      holes: [],
    };
    const candidates = [
      { sketchId: 999, polygon2D: rect(0, 0, 2, 2), holes: [] }, // identical but wrong sketch
      { sketchId: 300, polygon2D: rect(0, 0, 3, 3), holes: [] },
    ];
    expect(bestProfileMatchIndex(stored, candidates)).toBe(1);
  });

  it("tolerates a curve tessellated at a different resolution", () => {
    const stored = { sketchId: 300, polygon2D: circle(0, 0, 2, 16), holes: [] };
    const candidates = [
      { sketchId: 300, polygon2D: circle(0, 0, 2, 64), holes: [] },
      { sketchId: 300, polygon2D: circle(0, 0, 3, 64), holes: [] },
    ];
    expect(bestProfileMatchIndex(stored, candidates)).toBe(0);
  });

  it("returns -1 when nothing is from the same sketch", () => {
    const stored = { sketchId: 300, polygon2D: rect(0, 0, 2, 2), holes: [] };
    expect(
      bestProfileMatchIndex(stored, [
        { sketchId: 1, polygon2D: rect(0, 0, 2, 2), holes: [] },
      ]),
    ).toBe(-1);
    expect(bestProfileMatchIndex({ sketchId: 300 }, [])).toBe(-1);
  });
});
