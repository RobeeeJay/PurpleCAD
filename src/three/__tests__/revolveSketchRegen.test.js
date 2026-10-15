// Regression: a revolve must follow its source sketch through an upstream edit
// — recalculateTimeline rebuilds the revolve from the live profile + axis, so
// growing the profile grows the revolved solid and its origin recentres.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Sketch: a square at x:[2, x1] y:[0,1] (4 lines = the profile loop) + an axis
// line on the Y axis (index 4).  Growing x1 widens the profile and the ring.
const sketchShapes = (x1) => [
  { type: "line", x1: 2, y1: 0, x2: x1, y2: 0 },
  { type: "line", x1, y1: 0, x2: x1, y2: 1 },
  { type: "line", x1, y1: 1, x2: 2, y2: 1 },
  { type: "line", x1: 2, y1: 1, x2: 2, y2: 0 },
  { type: "line", x1: 0, y1: 0, x2: 0, y2: 1 }, // axis
];

const profile = (x1) => ({
  sketchId: 1,
  profileCentroid: { x: (2 + x1) / 2, y: 0.5 },
  polygon2D: [
    { x: 2, y: 0 },
    { x: x1, y: 0 },
    { x: x1, y: 1 },
    { x: 2, y: 1 },
  ],
  holes: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  normalWorld: { x: 0, y: 0, z: 1 },
});

const history = (x1) => [
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
        shapes: sketchShapes(x1),
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
        type: "csg",
        name: "Revolve 1",
        children: [],
        parentId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
        regenerator: {
          kind: "revolve",
          source: { type: "extrude", depth: 0, profile: profile(x1) },
          axis: { sketchId: 1, shapeIdx: 4 },
          angleRad: 2 * Math.PI,
          prismSides: 0,
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

describe("revolve follows an upstream sketch edit", () => {
  it("rebuilds the ring when the profile grows", async () => {
    useStore.setState({
      history: history(3),
      activeHistoryId: "h2",
      items: [],
      variables: [],
    });
    await recalculateTimeline();
    const before = useStore.getState().items.find((i) => i.id === 2);
    expect(before.geometryData).toBeTruthy();
    // Outer radius 3 → ring spans 6 across X.
    expect(widthX(before.geometryData)).toBeCloseTo(6, 1);

    // Grow the profile's outer edge from x=3 to x=5 (outer radius 5).
    useStore.setState({ history: history(5), activeHistoryId: "h2" });
    await recalculateTimeline();
    const after = useStore.getState().items.find((i) => i.id === 2);
    expect(widthX(after.geometryData)).toBeCloseTo(10, 1);
  });

  // Regression: a multi-turn helical revolve must keep its rotations + offset
  // through a regen (e.g. a resolution toggle) — it used to revert to a flat
  // 360° ring because the regen path dropped offsetPerRotation.
  it("keeps a helical coil's turns + offset across a recalc", async () => {
    const h = history(3);
    h[1].instruction.item.regenerator.angleRad = 3 * 2 * Math.PI; // 3 turns
    h[1].instruction.item.regenerator.offsetPerRotation = 2; // advance 2 per turn
    useStore.setState({
      history: h,
      activeHistoryId: "h2",
      items: [],
      variables: [],
    });
    await recalculateTimeline();
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
    const item = useStore.getState().items.find((i) => i.id === 2);
    // 3 turns × 2 advance + profile height 1 ≈ 7 along the axis (a flat ring
    // would be ~1).
    expect(heightY(item.geometryData)).toBeCloseTo(7, 0);
  });
});
