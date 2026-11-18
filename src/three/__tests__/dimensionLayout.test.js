// Sketch dimensions that would land on each other are pushed out: the first
// keeps the usual offset, and each later one moves out just far enough that
// its line and label clear every dimension before it, keeping its witness
// lines and end ticks.  All of them sat at the same 0.55 offset, so two
// dimensions along the same edge, or vertical ones side by side, drew over
// each other and neither could be read.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark" }) },
}));

import {
  DIM_OFFSET,
  dimensionOffsets,
} from "../sceneObjects/dimensionLayout.js";
import { addConstraintIconsToGroup } from "../sceneObjects/constraintIcons.js";

const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const length = (i, distance = "10") => ({
  type: "distance",
  shapeAIdx: i,
  pointA: "start",
  shapeBIdx: i,
  pointB: "end",
  distance,
});
const between = (a, pa, b, pb) => ({
  type: "distance",
  shapeAIdx: a,
  pointA: pa,
  shapeBIdx: b,
  pointB: pb,
  distance: "10",
});

describe("where overlapping dimensions go", () => {
  it("a dimension with nothing near it keeps the usual offset", () => {
    const shapes = [line(0, 0, 4, 0), line(0, 6, 4, 6)];
    const offsets = dimensionOffsets([length(0), length(1)], shapes);
    expect([...offsets.values()]).toEqual([DIM_OFFSET, DIM_OFFSET]);
  });

  it("a second dimension along the same edge moves out past the first's label", () => {
    // The edge's own length, then the same two corners measured point to
    // point: identical lines, identical labels.
    const shapes = [line(0, 0, 4, 0)];
    const offsets = dimensionOffsets(
      [length(0), between(0, "start", 0, "end")],
      shapes,
    );
    expect(offsets.get(0)).toBe(DIM_OFFSET);
    const gap = offsets.get(1) - offsets.get(0);
    // A label is 0.22 tall; the second line must clear it, and not by much
    // more than a label.
    expect(gap, `second dimension ${gap} further out`).toBeGreaterThan(0.22);
    expect(gap, `second dimension ${gap} further out`).toBeLessThan(0.6);
  });

  it("vertical dimensions side by side clear each other's upright labels", () => {
    // Two heights measured on the right of nested rectangles' right sides,
    // 0.3 apart: labels are upright, so each sticks out sideways by half its
    // 0.9 width and the second has to move a whole label over.
    const shapes = [line(4, 4, 4, 0), line(3.7, 3.5, 3.7, 0.5)];
    const offsets = dimensionOffsets([length(0), length(1)], shapes);
    const x0 = 4 + offsets.get(0);
    const x1 = 3.7 + offsets.get(1);
    expect(
      Math.abs(x1 - x0),
      `dimension lines at x ${x0} and ${x1}`,
    ).toBeGreaterThan(0.9);
  });
});

// The labels need a canvas; enough of one for the drawing to run in node.
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      measureText: (t) => ({ width: t.length * 10 }),
      clearRect() {},
      fillText() {},
    }),
  }),
};

describe("the drawn dimensions", () => {
  it("put the second line at its stacked offset, with a tick at each end", () => {
    const shapes = [line(0, 0, 4, 0)];
    const constraints = [length(0), between(0, "start", 0, "end")];
    const group = new THREE.Group();
    addConstraintIconsToGroup(
      group,
      constraints,
      shapes,
      (x, y, z = 0) => new THREE.Vector3(x, y, z),
      new THREE.Vector2(1000, 800),
      true,
      null,
      false,
    );
    const offsets = dimensionOffsets(constraints, shapes);
    for (const ci of [0, 1]) {
      const own = group.children.filter((o) => o.userData.constraintIdx === ci);
      // The line the double-click lands on sits at the dimension's offset
      // (the left normal of start -> end is +y here).
      const hotspot = own.find((o) => o.userData.constraintIconLocalPos);
      expect(hotspot.userData.constraintIconLocalPos.y).toBeCloseTo(
        offsets.get(ci),
        9,
      );
      // Ticks are the fixed-size marks, centred on each end of that line.
      const ticks = own
        .filter((o) => o.userData.constraintMark)
        .map((o) => [o.position.x, o.position.y]);
      expect(ticks).toEqual([
        [0, expect.closeTo(offsets.get(ci), 9)],
        [4, expect.closeTo(offsets.get(ci), 9)],
      ]);
    }
  });
});
