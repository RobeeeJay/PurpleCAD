// A multi-area extrude fused into ONE object: the prism recipes are embedded in
// an `extrudeUnion` regenerator (so it's one timeline entry), it rebuilds on
// regen, and the fused body can chain into further booleans.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { performCsg } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const ring = (cx) => {
  const o = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return { x: cx + Math.cos(a) * 2, y: Math.sin(a) * 2 };
  });
  const h = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return { x: cx + Math.cos(a) * 1, y: Math.sin(a) * 1 };
  });
  return {
    type: "sketchLoop",
    sketchId: 50,
    polygon2D: o,
    holes: [h],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  };
};
const def = (id, cx) => ({
  id,
  type: "extrude",
  profile: ring(cx),
  depth: "20",
  position: O,
  rotation: O,
  scale: S,
});
const verts = (g) => g?.positions?.length || 0;

describe("extrudeUnion", () => {
  it("regenerates the fused geometry from its embedded prism recipes", async () => {
    const sketch = {
      id: 50,
      type: "sketch",
      shapes: [],
      position: O,
      rotation: O,
    };
    const item = {
      id: 100,
      type: "csg",
      position: O,
      scale: S,
      rotation: O,
      geometryData: { positions: [], normals: null, indices: null },
      regenerator: {
        kind: "extrudeUnion",
        extrudeDefs: [def(101, 0), def(102, 6)],
        inputIds: [],
        originalCenter: O,
        regeneratedAt: 0.5,
      },
    };
    const out = await regenerateItemsForResolution([sketch, item], 0.05);
    const u = out.find((i) => i.id === 100);
    expect(verts(u.geometryData)).toBeGreaterThan(0);
    expect(u.regenerator.regeneratedAt).toBe(0.05);
  });

  it("the fused body chains into a downstream boolean", async () => {
    const item = {
      id: 100,
      type: "csg",
      position: O,
      scale: S,
      rotation: O,
      geometryData: { positions: [0, 0, 0], normals: null, indices: null },
      regenerator: {
        kind: "extrudeUnion",
        extrudeDefs: [def(101, 0), def(102, 6)],
        inputIds: [],
        originalCenter: O,
      },
    };
    const cube = { id: 200, type: "cube", position: O, rotation: O, scale: S };
    const items = [item, cube];
    const res = await performCsg({
      selectedItems: items,
      allItems: items,
      operation: "union",
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    expect(verts(res.geometryData)).toBeGreaterThan(0);
  });
});
