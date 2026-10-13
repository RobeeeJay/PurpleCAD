// Regression: editing a push/pull's distance must recompute the body's
// bbox-centred position, not just its geometry.  The op centres its result on
// its own bbox, so a larger/smaller distance moves that centre along the
// push/pull direction; keeping the old anchor slid the origin (fixed only by
// navigating the timeline, which ran the full recalc).  This drives the real
// store through updatePushPullParams + recalculateTimeline — the path a
// distance edit now takes, since useSceneSync's regenSig includes the distance.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

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

describe("editing a push/pull distance recenters the origin", () => {
  it("recomputes position.z along the pull direction", async () => {
    useStore.setState({
      history: history(0.5),
      activeHistoryId: "h3",
      items: [],
      variables: [],
      undoStack: [],
      redoStack: [],
    });
    await recalculateTimeline();
    // depth-2 extrude, top (+Z) face pulled 0.5 → spans z 0..2.5, centre 1.25.
    expect(
      useStore.getState().items.find((i) => i.id === 2).position.z,
    ).toBeCloseTo(1.25, 3);

    // Edit the distance to 1.5, then run the full recalc (the path a distance
    // edit now takes).  Origin must follow: spans 0..3.5, centre 1.75.
    useStore.getState().updatePushPullParams("h3", { distance: 1.5 });
    await recalculateTimeline();
    expect(
      useStore.getState().items.find((i) => i.id === 2).position.z,
    ).toBeCloseTo(1.75, 3);
  });
});
