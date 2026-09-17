// Sketch constraint markers are the toolbar's icons, placed a fixed number of
// SCREEN pixels beside what they constrain: coincident up and to the right of
// its point, horizontal above a line's middle, vertical to its right, distance
// up and to the right of the middle of what it measures.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark" }) },
}));

import {
  CONSTRAINT_ICON_OFFSET_PX,
  CONSTRAINT_ICON_SIZE_PX,
  ICON_ABOVE,
  ICON_RIGHT,
  ICON_UP_RIGHT,
  makeConstraintIconSprite,
} from "../sceneObjects/constraintIconSprites.js";
import { addConstraintIconsToGroup } from "../sceneObjects/constraintIcons.js";

const S = CONSTRAINT_ICON_SIZE_PX;
const OFF = CONSTRAINT_ICON_OFFSET_PX;

// The gap in pixels between the anchor and the marker's near edge, on each
// axis (0 = the marker is centred on the anchor along that axis).  `center` is
// in sprite-size units, so this holds at every zoom.
const gapPx = (sprite) => ({
  x: sprite.center.x === 0.5 ? 0 : -sprite.center.x * S,
  y: sprite.center.y === 0.5 ? 0 : -sprite.center.y * S,
});

describe("where a marker sits", () => {
  it("starts OFFSET pixels from its anchor, whatever the constants are", () => {
    expect(OFF).toBe(10);
    const up = makeConstraintIconSprite("coincident", ICON_UP_RIGHT, "dark");
    expect(gapPx(up)).toEqual({ x: OFF, y: OFF });
    const right = makeConstraintIconSprite("vertical", ICON_RIGHT, "dark");
    expect(gapPx(right)).toEqual({ x: OFF, y: 0 });
    const above = makeConstraintIconSprite("horizontal", ICON_ABOVE, "dark");
    expect(gapPx(above)).toEqual({ x: 0, y: OFF });
  });

  it("tells the hit tests where its middle is, in client pixels (y down)", () => {
    const reach = OFF + S / 2;
    const at = (dir) =>
      makeConstraintIconSprite("coincident", dir, "dark").userData.screenIcon
        .offsetPx;
    expect(at(ICON_UP_RIGHT)).toEqual({ x: reach, y: -reach });
    expect(at(ICON_RIGHT)).toEqual({ x: reach, y: 0 });
    expect(at(ICON_ABOVE)).toEqual({ x: 0, y: -reach });
  });
});

describe("which marker each constraint gets", () => {
  const shapes = [
    { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
    { type: "line", x1: 4, y1: 0, x2: 4, y2: 2 },
  ];
  const constraints = [
    {
      type: "coincident",
      shapeAIdx: 0,
      pointA: "end",
      shapeBIdx: 1,
      pointB: "start",
    },
    { type: "horizontal", shapeIdx: 0 },
    { type: "vertical", shapeIdx: 1 },
    {
      type: "distance",
      shapeAIdx: 0,
      pointA: "start",
      shapeBIdx: 0,
      pointB: "end",
      distance: "40",
    },
  ];
  const markers = () => {
    const group = new THREE.Group();
    addConstraintIconsToGroup(
      group,
      constraints,
      shapes,
      (x, y, z = 0) => new THREE.Vector3(x, y, z),
      new THREE.Vector2(1000, 800),
      false, // dimension labels need a DOM canvas; the markers don't
      null,
      true,
    );
    return Object.fromEntries(
      group.children
        .filter((o) => o.userData.screenIcon)
        .map((o) => [o.userData.constraintType, o]),
    );
  };

  it("coincident: up and to the right of the shared point", () => {
    const m = markers().coincident;
    expect(m.userData.screenIcon.type).toBe("coincident");
    expect([m.position.x, m.position.y]).toEqual([4, 0]);
    expect(gapPx(m)).toEqual({ x: OFF, y: OFF });
  });

  it("horizontal: above the middle of its line", () => {
    const m = markers().horizontal;
    expect([m.position.x, m.position.y]).toEqual([2, 0]);
    expect(gapPx(m)).toEqual({ x: 0, y: OFF });
  });

  it("vertical: to the right of the middle of its line", () => {
    const m = markers().vertical;
    expect([m.position.x, m.position.y]).toEqual([4, 1]);
    expect(gapPx(m)).toEqual({ x: OFF, y: 0 });
  });

  it("distance: up and to the right of the middle of what it measures", () => {
    const m = markers().distance;
    expect(m.userData.screenIcon.type).toBe("distance");
    expect([m.position.x, m.position.y]).toEqual([2, 0]);
    expect(gapPx(m)).toEqual({ x: OFF, y: OFF });
  });

  it("no constraint is drawn as the old diamond any more", () => {
    // The diamonds were closed 5-point THREE.Line loops around the anchor.
    const group = new THREE.Group();
    addConstraintIconsToGroup(
      group,
      constraints,
      shapes,
      (x, y, z = 0) => new THREE.Vector3(x, y, z),
      new THREE.Vector2(1000, 800),
      false,
      null,
      true,
    );
    const diamonds = group.children.filter(
      (o) =>
        o.isLine &&
        !o.isLineSegments &&
        o.geometry.attributes.position.count === 5,
    );
    expect(diamonds).toEqual([]);
  });
});
