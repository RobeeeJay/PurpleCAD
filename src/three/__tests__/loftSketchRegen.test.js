// Regression: a loft must follow its source sketches through an upstream edit —
// recalculateTimeline rebuilds it from both live profiles, so widening the
// first profile widens the lofted solid (and re-centres its origin).

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Sketch A (id 1): a square of half-width `h` on the XY plane at z=0.
const squareShapes = (h) => [
  { type: "line", x1: -h, y1: -h, x2: h, y2: -h },
  { type: "line", x1: h, y1: -h, x2: h, y2: h },
  { type: "line", x1: h, y1: h, x2: -h, y2: h },
  { type: "line", x1: -h, y1: h, x2: -h, y2: -h },
];

const sourceFor = (sketchId, half, z) => ({
  type: "extrude",
  depth: 0,
  position: { x: 0, y: 0, z },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half },
    ],
    holes: [],
    position: { x: 0, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

const history = (hA) => [
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
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        shapes: squareShapes(hA),
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
        position: { x: 0, y: 0, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        shapes: squareShapes(0.5),
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
        name: "Loft 1",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
        regenerator: {
          kind: "loft",
          profileSource: sourceFor(1, 1, 0),
          secondProfileSource: sourceFor(2, 0.5, 4),
          regeneratedAt: null,
        },
      },
    },
  },
];

const widthX = (g) => {
  const p = g.positions;
  let mn = Infinity,
    mx = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    mn = Math.min(mn, p[i]);
    mx = Math.max(mx, p[i]);
  }
  return mx - mn;
};

describe("loft follows an upstream sketch edit", () => {
  it("widens the solid when the first profile grows", async () => {
    useStore.setState({
      history: history(1),
      activeHistoryId: "h3",
      items: [],
      variables: [],
      curveResolution: "preview",
    });
    await recalculateTimeline();
    const before = useStore.getState().items.find((i) => i.id === 3);
    expect(before.geometryData).toBeTruthy();
    expect(widthX(before.geometryData)).toBeCloseTo(2, 1);

    // Grow sketch A's square from half-width 1 to 2 (base spans 4 across X).
    useStore.setState({ history: history(2), activeHistoryId: "h3" });
    await recalculateTimeline();
    const after = useStore.getState().items.find((i) => i.id === 3);
    expect(widthX(after.geometryData)).toBeCloseTo(4, 1);
  });
});
