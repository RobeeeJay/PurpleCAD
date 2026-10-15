// The two visibility toggles are independent: hiding dimensions removes only
// the measured annotations (distance / point-line / offset labels + marker
// lines); every other constraint icon stays.  Hiding constraints does the
// reverse.  (Regression: showConstraints used to be a super-gate wrapping the
// whole icon builder, so either toggle could take the other's objects down.)
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark" }) },
}));

import { addConstraintIconsToGroup } from "../sceneObjects/constraintIcons.js";

const shapes = [
  { type: "line", x1: -3, y1: 0, x2: 3, y2: 0 },
  { type: "point", x: 0, y: 2 },
  { type: "line", x1: -3, y1: 4, x2: 3, y2: 4 },
  { type: "point", x: 0, y: 4 },
];
const constraints = [
  { type: "horizontal", shapeIdx: 0 },
  { type: "midpoint", pointShapeIdx: 3, targetShapeIdx: 2 },
  { type: "onLine", pointShapeIdx: 1, pointKey: "point", lineShapeIdx: 0 },
  // Dimension types (their labels need a DOM canvas, so these tests only
  // exercise the combinations where dimensions are hidden).
  {
    type: "pointLineDistance",
    pointShapeIdx: 1,
    lineShapeIdx: 0,
    distance: "20",
  },
  {
    type: "distance",
    shapeAIdx: 0,
    pointA: "start",
    shapeBIdx: 0,
    pointB: "end",
    distance: "60",
  },
];

const build = (showDimensions, showConstraints) => {
  const group = new THREE.Group();
  addConstraintIconsToGroup(
    group,
    constraints,
    shapes,
    (x, y, z = 0) => new THREE.Vector3(x, y, z),
    new THREE.Vector2(1000, 800),
    showDimensions,
    null,
    showConstraints,
  );
  return group;
};

const typesIn = (group) =>
  new Set(group.children.map((o) => o.userData.constraintType));

describe("independent constraint / dimension visibility", () => {
  it("dimensions hidden: constraint icons stay, dimension objects gone", () => {
    const group = build(false, true);
    const types = typesIn(group);
    expect(types.has("horizontal")).toBe(true);
    expect(types.has("midpoint")).toBe(true);
    expect(types.has("onLine")).toBe(true);
    expect(types.has("pointLineDistance")).toBe(false);
    // A distance keeps its constraint MARKER (the toolbar icon, a constraint
    // icon like any other) while its dimension line and label go.
    const distance = group.children.filter(
      (o) => o.userData.constraintType === "distance",
    );
    expect(distance.map((o) => !!o.userData.screenIcon)).toEqual([true]);
  });

  it("both hidden: nothing renders", () => {
    expect(build(false, false).children.length).toBe(0);
  });
});
