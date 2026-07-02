// Regression: editing a committed push/pull's distance (the timeline "Edit"
// button → updatePushPullParams) must rebuild the body at the new distance.
// Driven through the real store action + a regen pass.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { regenerateItemsForResolution } from "../regenerateItems.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const square = (h) => [
  { type: "line", x1: -h, y1: -h, x2: h, y2: -h },
  { type: "line", x1: h, y1: -h, x2: h, y2: h },
  { type: "line", x1: h, y1: h, x2: -h, y2: h },
  { type: "line", x1: -h, y1: h, x2: -h, y2: -h },
];

const extrudeItem = () => ({
  id: 2,
  type: "extrude",
  name: "Extrude 1",
  children: [],
  parentId: null,
  depth: 2,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  profile: {
    sketchId: 1,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
});

const history = (distance) => [
  {
    id: "h1",
    instruction: {
      type: "create",
      item: {
        id: 1,
        type: "sketch",
        name: "Sketch 1",
        children: [],
        parentId: null,
        shapes: square(1),
        constraints: [],
      },
    },
  },
  { id: "h2", instruction: { type: "create", item: extrudeItem() } },
  {
    id: "h3",
    instruction: {
      type: "modify",
      itemId: 2,
      patches: {
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "pushpull",
          source: extrudeItem(),
          subGeo: { faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 }] },
          distance,
          regeneratedAt: null,
        },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
      },
    },
  },
];

const heightZ = (g) => {
  const p = g.positions;
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 2; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return mx - mn;
};

describe("editing a push/pull distance rebuilds the body", () => {
  it("a larger distance pulls the top face further (taller body)", async () => {
    useStore.setState({
      history: history(0.5),
      activeHistoryId: "h3",
      items: [],
      variables: [],
      curveResolution: "preview",
      undoStack: [],
      redoStack: [],
    });

    // Baseline: regenerate the distance-0.5 push/pull.
    const base = history(0.5)[2].instruction.patches.regenerator;
    const beforeItems = await regenerateItemsForResolution(
      [
        { id: 1, type: "sketch", shapes: square(1) },
        {
          id: 2,
          type: "csg",
          position: { x: 0, y: 0, z: 0 },
          regenerator: { ...base, regeneratedAt: "dirty" },
        },
      ],
      null,
    );
    const hBefore = heightZ(beforeItems.find((i) => i.id === 2).geometryData);
    // depth 2 + 0.5 pull = 2.5 tall.
    expect(hBefore).toBeCloseTo(2.5, 3);

    // Edit the distance to 1.0 via the store action, then regen.
    useStore.getState().updatePushPullParams("h3", { distance: 1.0 });
    const edited = useStore.getState();
    const editedItem = edited.items.find((i) => i.id === 2);
    expect(editedItem.regenerator.distance).toBe(1.0);
    expect(editedItem.regenerator.regeneratedAt).toBe("dirty");

    const afterItems = await regenerateItemsForResolution(edited.items, null);
    const hAfter = heightZ(afterItems.find((i) => i.id === 2).geometryData);
    // depth 2 + 1.0 pull = 3.0 tall.
    expect(hAfter).toBeCloseTo(3.0, 3);
  });
});
