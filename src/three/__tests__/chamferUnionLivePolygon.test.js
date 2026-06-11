// Regression (Electron): a chamfer whose source is a union must hand the OCC
// op LIVE-polygon inputs.  The packaged-app bridge can't re-derive an extrude's
// profile from its sketch — it builds each item's stored polygon2D — so the
// renderer has to pre-bake the live polygon into EVERY item it passes as
// `allItems`, not just the chamfer source.  Otherwise a union's extrude input
// rebuilds at the old sketch size and the chamfer stays stale after a
// dimension change.

import { describe, it, expect, vi } from "vitest";

let captured = null;
vi.mock("../occClient.js", () => ({
  chamferOrFilletItem: vi.fn(async (args) => {
    captured = args;
    return {
      geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
      centerOffset: { cx: 0, cy: 0, cz: 0 },
      resolvedSubGeo: args.subGeo,
    };
  }),
  performCsg: vi.fn(async () => null),
}));

import { regenerateItemsForResolution } from "../regenerateItems.js";

const square = (h) => [
  { type: "line", x1: -h, y1: -h, x2: h, y2: -h },
  { type: "line", x1: h, y1: -h, x2: h, y2: h },
  { type: "line", x1: h, y1: h, x2: -h, y2: h },
  { type: "line", x1: -h, y1: h, x2: -h, y2: -h },
];

describe("chamfer-on-union passes live extrude inputs to the op", () => {
  it("re-derives the union's extrude input polygon from the live sketch", async () => {
    captured = null;
    // The sketch is now 4x4 (half=2), but the extrude item still carries a
    // STALE 2x2 polygon2D from when it was created.
    const items = [
      { id: 1, type: "sketch", shapes: square(2) },
      {
        id: 2,
        type: "extrude",
        depth: 2,
        visible: false,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
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
      },
      {
        id: 3,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: {
            id: 4,
            type: "csg",
            regenerator: { kind: "boolean", op: "union", inputIds: [2] },
          },
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: "dirty",
        },
      },
    ];

    await regenerateItemsForResolution(items, null);
    expect(captured).toBeTruthy();
    const ext = captured.allItems.find((i) => i.id === 2);
    expect(ext).toBeTruthy();
    // The extent of the polygon handed to the op must reflect the LIVE 4x4
    // sketch (max |x| ≈ 2), not the stale 2x2 stored polygon (max |x| ≈ 1).
    const maxAbsX = Math.max(
      ...ext.profile.polygon2D.map((p) => Math.abs(p.x)),
    );
    expect(maxAbsX).toBeGreaterThan(1.5);
  });
});
