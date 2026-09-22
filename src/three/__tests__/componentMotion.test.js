// A component's motion: the axis a pick defines, where the motion is at a
// given moment, the transform that puts the component there, and which items
// ride along.  Plus the collision check the animation stops on.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark", variables: [] }) },
}));

import {
  componentMembers,
  motionMatrix,
  motionValueAt,
  referenceFromPick,
} from "../componentMotion.js";
import {
  crossingCentre,
  findCollision,
  restContacts,
} from "../componentCollision.js";

const IDENTITY = new THREE.Matrix4().elements;
const close = (p, q, digits = 9) => {
  expect(p.x).toBeCloseTo(q.x, digits);
  expect(p.y).toBeCloseTo(q.y, digits);
  expect(p.z).toBeCloseTo(q.z, digits);
};

describe("the axis a picked piece of geometry defines", () => {
  it("a flat face: through its centre, along its normal, in world space", () => {
    // The mesh sits at (10, 0, 0), turned 90 degrees about Y.
    const m = new THREE.Matrix4()
      .makeTranslation(10, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    const ref = referenceFromPick(
      { faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 2, cz: 0 }] },
      m.elements,
    );
    expect(ref.kind).toBe("face");
    close(ref.origin, { x: 10, y: 2, z: 0 });
    close(ref.dir, { x: 1, y: 0, z: 0 });
  });

  it("a straight edge: along the edge", () => {
    const ref = referenceFromPick(
      { edges: [{ ax: 0, ay: 0, az: 0, bx: 0, by: 3, bz: 0 }] },
      IDENTITY,
    );
    expect(ref.kind).toBe("edge");
    close(ref.origin, { x: 0, y: 0, z: 0 });
    close(ref.dir, { x: 0, y: 1, z: 0 });
  });

  it("a hole's rim: through the circle's centre, along its normal", () => {
    // A 24-segment ring of radius 2 centred on (5, 1, -3), lying flat (normal Y).
    const edges = [];
    const at = (i) => ({
      x: 5 + 2 * Math.cos((2 * Math.PI * i) / 24),
      y: 1,
      z: -3 + 2 * Math.sin((2 * Math.PI * i) / 24),
    });
    for (let i = 0; i < 24; i++) {
      const a = at(i),
        b = at(i + 1);
      edges.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z });
    }
    const ref = referenceFromPick({ edges }, IDENTITY);
    expect(ref.kind).toBe("circle");
    close(ref.origin, { x: 5, y: 1, z: -3 });
    expect(Math.abs(ref.dir.y)).toBeCloseTo(1, 9);
  });

  it("nothing picked defines nothing", () => {
    expect(referenceFromPick({ edges: [], faces: [] }, IDENTITY)).toBeNull();
  });
});

describe("where the motion is at a moment", () => {
  const swing = { positive: 90, negative: 30, speed: 60 };

  it("starts at rest and moves positive first", () => {
    expect(motionValueAt(swing, 0)).toBe(0);
    expect(motionValueAt(swing, 0.5)).toBeCloseTo(30, 9);
  });

  it("turns back at each extent and passes rest again", () => {
    expect(motionValueAt(swing, 1.5)).toBeCloseTo(90, 9); // +90 after 90 deg
    expect(motionValueAt(swing, 2.5)).toBeCloseTo(30, 9); // coming back
    expect(motionValueAt(swing, 3.5)).toBeCloseTo(-30, 9); // the negative end
    expect(motionValueAt(swing, 4)).toBeCloseTo(0, 9); // one full cycle
  });

  it("never leaves its extents", () => {
    for (let t = 0; t < 20; t += 0.037) {
      const v = motionValueAt(swing, t);
      expect(v).toBeLessThanOrEqual(90 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-30 - 1e-9);
    }
  });

  it("stays at rest with no speed or no range", () => {
    expect(motionValueAt({ ...swing, speed: 0 }, 3)).toBe(0);
    expect(motionValueAt({ positive: 0, negative: 0, speed: 60 }, 3)).toBe(0);
  });
});

describe("the transform that puts a component there", () => {
  it("rotation turns about the axis line, not the world origin", () => {
    const m = motionMatrix(
      {
        type: "rotation",
        axis: { origin: { x: 2, y: 0, z: 0 }, dir: { x: 0, y: 1, z: 0 } },
      },
      90,
    );
    // A point on the axis stays put; one a unit off it swings a quarter turn.
    close(new THREE.Vector3(2, 5, 0).applyMatrix4(m), { x: 2, y: 5, z: 0 });
    close(new THREE.Vector3(3, 0, 0).applyMatrix4(m), { x: 2, y: 0, z: -1 });
  });

  it("axis motion slides along the axis, in mm", () => {
    const m = motionMatrix(
      {
        type: "axis",
        axis: { origin: { x: 9, y: 9, z: 9 }, dir: { x: 0, y: 0, z: 2 } },
      },
      25,
    );
    // 25 mm is 2.5 scene units, whatever the axis origin or direction length.
    close(new THREE.Vector3(1, 1, 1).applyMatrix4(m), { x: 1, y: 1, z: 3.5 });
  });
});

describe("which items move with a component", () => {
  it("everything inside it, through nested components and hosted items", () => {
    const folders = [
      { id: "folder-1", parentId: null },
      { id: "folder-2", parentId: "folder-1" },
      { id: "folder-3", parentId: null },
    ];
    const items = [
      { id: 1, parentId: "folder-1" },
      { id: 2, parentId: "folder-2" },
      { id: 3, parentId: 2 }, // hosted on item 2
      { id: 4, parentId: "folder-3" },
      { id: 5, parentId: null },
    ];
    expect(componentMembers(items, folders, "folder-1").sort()).toEqual([
      1, 2, 3,
    ]);
    expect(componentMembers(items, folders, "folder-3")).toEqual([4]);
  });
});

describe("collisions", () => {
  const box = (id, x, y = 0) => ({
    id,
    geometry: new THREE.BoxGeometry(2, 2, 2),
    matrixWorld: new THREE.Matrix4().makeTranslation(x, y, 0),
  });

  it("two bodies that cross collide, centred on the crossing", () => {
    const hit = findCollision([box(1, 0)], [box(2, 1.5, 0.3)]);
    expect(hit).toMatchObject({ movingId: 1, otherId: 2 });
    // The overlap is x 0.5..1; the crossing lies within it, well off centre.
    expect(hit.point.x).toBeGreaterThan(0.45);
    expect(hit.point.x).toBeLessThan(1.05);
  });

  it("bodies apart don't", () => {
    expect(findCollision([box(1, 0)], [box(2, 3)])).toBeNull();
  });

  it("faces resting flat against each other are contact, not collision", () => {
    expect(crossingCentre(box(1, 0), box(2, 2))).toBeNull();
  });

  it("contact that exists at rest is ignored for that pair only", () => {
    const moving = [box(1, 0)];
    const resting = box(2, 1.5);
    const ignore = restContacts(moving, [resting]);
    expect(ignore.has("1|2")).toBe(true);
    expect(findCollision(moving, [resting], ignore)).toBeNull();
    // A different body the component runs into still counts.
    expect(
      findCollision(moving, [resting, box(3, -1.5)], ignore),
    ).toMatchObject({ otherId: 3 });
  });
});
