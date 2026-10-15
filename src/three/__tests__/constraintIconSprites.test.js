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
  nearestConstraintMarker,
} from "../sceneObjects/constraintIconSprites.js";
import {
  addConstraintIconsToGroup,
  lengthDimensionSides,
} from "../sceneObjects/constraintIcons.js";

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
    expect(OFF).toBe(5);
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

  // A cog's centre is a real point (a snap target and drag handle), so its
  // marker sits up and to the right of it like any point's, not on it -- on
  // it, hover and click would find the point underneath instead.
  it("cog: up and to the right of its centre point", async () => {
    const { makeCogShape } = await import("../cogGeometry.js");
    const group = new THREE.Group();
    addConstraintIconsToGroup(
      group,
      [{ type: "cog", shapeIdx: 0 }],
      [
        makeCogShape({
          x: 3,
          y: 2,
          pitchDiameter: 4,
          teeth: 20,
          backlash: 0,
          rootFillet: 0.05,
          holeDiameter: 1,
        }),
      ],
      (x, y, z = 0) => new THREE.Vector3(x, y, z),
      new THREE.Vector2(1000, 800),
      false,
      null,
      true,
    );
    const m = group.children.find((o) => o.userData.screenIcon);
    expect(m.userData.screenIcon.type).toBe("cog");
    expect([m.position.x, m.position.y]).toEqual([3, 2]);
    expect(gapPx(m)).toEqual({ x: OFF, y: OFF });
  });

  // A centre constraint's anchor is a point in open space, not on a line or a
  // vertex, so its marker has nothing to clear and sits ON the anchor.
  it("centre: on the centre it holds, with no gap at all", () => {
    const square = [
      { type: "line", x1: 0, y1: 0, x2: 2, y2: 0 },
      { type: "line", x1: 2, y1: 0, x2: 2, y2: 2 },
      { type: "line", x1: 2, y1: 2, x2: 0, y2: 2 },
      { type: "line", x1: 0, y1: 2, x2: 0, y2: 0 },
      { type: "circle", cx: 8, cy: 8, r: 1 },
    ];
    const group = new THREE.Group();
    addConstraintIconsToGroup(
      group,
      [{ type: "centre", shapesA: [0, 1, 2, 3], shapesB: [4] }],
      square,
      (x, y, z = 0) => new THREE.Vector3(x, y, z),
      new THREE.Vector2(1000, 800),
      false,
      null,
      true,
    );
    const m = group.children.find((o) => o.userData.screenIcon);
    expect([m.position.x, m.position.y]).toEqual([1, 1]);
    expect(gapPx(m)).toEqual({ x: 0, y: 0 });
    expect(m.userData.screenIcon.offsetPx).toEqual({ x: 0, y: 0 });
  });

  it("vertical: to the right of the middle of its line", () => {
    const m = markers().vertical;
    expect([m.position.x, m.position.y]).toEqual([4, 1]);
    expect(gapPx(m)).toEqual({ x: OFF, y: 0 });
  });

  // With its dimension drawn, a distance's marker sits beside the value label
  // instead; that needs a canvas, so the e2e spec checks it.
  it("distance, dimension hidden: up and to the right of what it measures", () => {
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

describe("which side of a line its own dimension is drawn", () => {
  // A horizontal / vertical marker moves to the other side of its line when
  // the line's length dimension is drawn where the marker would go (the e2e
  // spec checks the move itself; the labels need a canvas).
  const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
  const length = (idx, pointA = "start", pointB = "end") => ({
    type: "distance",
    shapeAIdx: idx,
    pointA,
    shapeBIdx: idx,
    pointB,
    distance: "10",
  });

  it("left-to-right line: above it", () => {
    const sides = lengthDimensionSides([length(0)], [line(0, 0, 4, 0)]);
    expect(sides.get(0)).toEqual({ x: -0, y: 1 });
  });

  it("the same line measured end-to-start: below it", () => {
    const sides = lengthDimensionSides(
      [length(0, "end", "start")],
      [line(0, 0, 4, 0)],
    );
    expect(sides.get(0).y).toBe(-1);
  });

  it("downward line: to its right", () => {
    const sides = lengthDimensionSides([length(0)], [line(4, 2, 4, 0)]);
    expect(sides.get(0).x).toBe(1);
  });

  it("only a line's OWN length counts", () => {
    const between = { ...length(0), shapeBIdx: 1 };
    expect(
      lengthDimensionSides([between], [line(0, 0, 4, 0), line(0, 2, 4, 2)])
        .size,
    ).toBe(0);
  });
});

describe("which marker the pointer is on", () => {
  // Markers sit close together (a centre's icon beside a distance's label);
  // hover, click and double-click must all pick the one under the pointer,
  // not whichever was drawn first within reach.
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const sketchMesh = new THREE.Object3D();
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const marker = (type, x, y) => {
    const o = new THREE.Object3D();
    o.userData = {
      isConstraint: true,
      constraintType: type,
      constraintIconLocalPos: { x, y },
    };
    return o;
  };
  // World (x, y) maps to client (50 + x, 50 - y) through this camera.
  const far = marker("distance", 10, 0); // 10px from the pointer
  const near = marker("centre", 3, 0); // 3px from the pointer
  const at = (objs, maxPx, accept) =>
    nearestConstraintMarker(
      objs,
      sketchMesh,
      camera,
      rect,
      50,
      50,
      maxPx,
      accept,
    );

  it("is the nearest one, whatever order they were drawn in", () => {
    expect(at([far, near], 18)?.userData.constraintType).toBe("centre");
    expect(at([near, far], 18)?.userData.constraintType).toBe("centre");
  });

  it("is none when nothing is within reach", () => {
    expect(at([far], 8)).toBeNull();
  });

  it("skips markers the caller does not accept", () => {
    const onlyDistance = (o) => o.userData.constraintType === "distance";
    expect(at([far, near], 18, onlyDistance)).toBe(far);
  });
});
