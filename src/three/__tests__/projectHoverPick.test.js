// The Project tool picks what to project from the edges as they lie ON the
// sketch plane: the projected line nearest the cursor, and every projected
// line connected to it -- not every edge of the body under a perspective ray.
import { describe, it, expect } from "vitest";
import { connectedChainGroups, nearestChain } from "../sketchProjection.js";

const seg = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y2 },
];

describe("picking projected edges on the sketch plane", () => {
  // Two separate outlines: a square, and a triangle off to one side.
  const chains = [
    seg(0, 0, 1, 0),
    seg(1, 0, 1, 1),
    seg(1, 1, 0, 1),
    seg(0, 1, 0, 0),
    seg(3, 0, 4, 0),
    seg(4, 0, 3.5, 1),
    seg(3.5, 1, 3, 0),
  ];

  it("groups lines whose ends meet into one connected set", () => {
    const groups = connectedChainGroups(chains).map((g) => g.sort());
    expect(groups).toHaveLength(2);
    expect(groups).toContainEqual([0, 1, 2, 3]);
    expect(groups).toContainEqual([4, 5, 6]);
  });

  it("joins ends a hair apart, as edges of one body come out after projection", () => {
    const groups = connectedChainGroups([
      seg(0, 0, 1, 0),
      seg(1.00005, 0, 1, 1),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("finds the line under the cursor, and nothing away from every line", () => {
    expect(nearestChain(chains, { x: 0.5, y: 0.02 }, 0.05)?.index).toBe(0);
    expect(nearestChain(chains, { x: 3.5, y: 0.4 }, 0.05)).toBeNull();
    // Inside the square, away from its sides: no line is there to project.
    expect(nearestChain(chains, { x: 0.5, y: 0.5 }, 0.05)).toBeNull();
  });
});
