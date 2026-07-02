// Regression: a push/pull on an extrude must follow the sketch when an earlier
// timeline step changes the source geometry.  Driven through the real store +
// recalculateTimeline (the path Viewport runs on an upstream edit), it checks
// BOTH that the body rebuilds AND that its bbox-centred position is recomputed
// — without the recenter the rebuilt body kept its old anchor and looked like
// it hadn't tracked the edit.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A rectangle x:[x0,x1], y:[-h,h] — moving the +X edge shifts the centroid
// without rotating any face.
const rectLines = (x0, x1, h) => [
  { type: "line", x1: x0, y1: -h, x2: x1, y2: -h },
  { type: "line", x1: x1, y1: -h, x2: x1, y2: h },
  { type: "line", x1: x1, y1: h, x2: x0, y2: h },
  { type: "line", x1: x0, y1: h, x2: x0, y2: -h },
];

const profileFor = (x0, x1, h) => ({
  sketchId: 1,
  profileCentroid: { x: (x0 + x1) / 2, y: 0 },
  polygon2D: [
    { x: x0, y: -h },
    { x: x1, y: -h },
    { x: x1, y: h },
    { x: x0, y: h },
  ],
  holes: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  normalWorld: { x: 0, y: 0, z: 1 },
});

const extrudeItem = (x0, x1, h) => ({
  id: 2,
  type: "extrude",
  name: "Extrude 1",
  children: [],
  parentId: null,
  depth: 2,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  profile: profileFor(x0, x1, h),
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
});

const history = (x0, x1, h) => [
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
        shapes: rectLines(x0, x1, h),
        constraints: [],
      },
    },
  },
  { id: "h2", instruction: { type: "create", item: extrudeItem(x0, x1, h) } },
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
          source: extrudeItem(x0, x1, h),
          // Pull the top (+Z) face outward.
          subGeo: { faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 }] },
          distance: 0.5,
          regeneratedAt: null,
        },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
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

describe("push/pull follows an upstream sketch edit", () => {
  it("rebuilds the body and recomputes its position when the sketch grows", async () => {
    useStore.setState({
      history: history(-1, 1, 1),
      activeHistoryId: "h3",
      items: [],
      variables: [],
      curveResolution: "preview",
    });
    await recalculateTimeline();
    const before = useStore.getState().items.find((i) => i.id === 2);
    expect(before.geometryData).toBeTruthy();
    const wBefore = widthX(before.geometryData);
    // Top face pulled by 0.5 on a depth-2 extrude → spans z 0..2.5, centre 1.25.
    expect(before.position.z).toBeCloseTo(1.25, 3);

    // Edit the sketch earlier in the timeline: push the +X edge from 1 to 3.
    useStore.setState({ history: history(-1, 3, 1), activeHistoryId: "h3" });
    await recalculateTimeline();
    const after = useStore.getState().items.find((i) => i.id === 2);
    expect(after.geometryData).toBeTruthy();

    // Geometry tracked the grow…
    expect(widthX(after.geometryData)).toBeGreaterThan(wBefore + 1);
    // …and the bbox-centred position followed the shifted centroid (0 → 1),
    // instead of staying stale at the old anchor.
    expect(after.position.x).toBeCloseTo(1, 3);
  });
});
