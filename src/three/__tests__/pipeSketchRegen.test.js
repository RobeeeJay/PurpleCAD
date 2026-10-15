// Regression: a pipe must follow its source sketches through an upstream edit —
// recalculateTimeline rebuilds the pipe from the live profile + path, so
// lengthening the path sketch lengthens the swept tube (and re-centres it).

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Profile sketch (id 1): a 0.6×0.6 square loop.
const profileShapes = [
  { type: "line", x1: -0.3, y1: -0.3, x2: 0.3, y2: -0.3 },
  { type: "line", x1: 0.3, y1: -0.3, x2: 0.3, y2: 0.3 },
  { type: "line", x1: 0.3, y1: 0.3, x2: -0.3, y2: 0.3 },
  { type: "line", x1: -0.3, y1: 0.3, x2: -0.3, y2: -0.3 },
];

// Path sketch (id 2): a single straight line of length `len` along +Y.
const pathShapes = (len) => [{ type: "line", x1: 0, y1: 0, x2: 0, y2: len }];

const profileSource = () => ({
  type: "extrude",
  depth: 0,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId: 1,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -0.3, y: -0.3 },
      { x: 0.3, y: -0.3 },
      { x: 0.3, y: 0.3 },
      { x: -0.3, y: 0.3 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

const history = (len) => [
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
        shapes: profileShapes,
        constraints: [],
      },
    },
  },
  {
    id: "h2",
    instruction: {
      type: "create",
      item: {
        id: 2,
        type: "sketch",
        name: "Sketch 2",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        shapes: pathShapes(len),
        constraints: [],
      },
    },
  },
  {
    id: "h3",
    instruction: {
      type: "create",
      item: {
        id: 3,
        type: "csg",
        name: "Pipe 1",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
        regenerator: {
          kind: "pipe",
          profileSource: profileSource(),
          pathRef: { sketchId: 2, shapeIdx: 0 },
          regeneratedAt: null,
        },
      },
    },
  },
];

const heightY = (g) => {
  const p = g.positions;
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return mx - mn;
};

describe("pipe follows an upstream sketch edit", () => {
  it("re-lengthens the tube when the path grows", async () => {
    useStore.setState({
      history: history(5),
      activeHistoryId: "h3",
      items: [],
      variables: [],
    });
    await recalculateTimeline();
    const before = useStore.getState().items.find((i) => i.id === 3);
    expect(before.geometryData).toBeTruthy();
    expect(heightY(before.geometryData)).toBeCloseTo(5, 1);

    // Grow the path from 5 to 9 long.
    useStore.setState({ history: history(9), activeHistoryId: "h3" });
    await recalculateTimeline();
    const after = useStore.getState().items.find((i) => i.id === 3);
    expect(heightY(after.geometryData)).toBeCloseTo(9, 1);
  });
});
