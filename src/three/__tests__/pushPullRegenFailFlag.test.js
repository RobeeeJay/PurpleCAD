// Regression: when a push/pull regen can't rebuild (its face vanished or OCC
// rejects it after the geometry changed), regenerateItemsForResolution keeps
// the last-good mesh but flags the regenerator (regenFailed) so the timeline
// can mark the step bad — and clears the flag once it rebuilds.  Mirrors
// chamferRegenFailFlag.test.js.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});
vi.mock("three/addons/lines/Line2.js", () => ({ Line2: class {} }));
vi.mock("three/addons/lines/LineMaterial.js", () => ({
  LineMaterial: class {},
}));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({}) }));
vi.mock("../occClient.js", () => ({
  chamferOrFilletItem: vi.fn(),
  pushPullFaces: vi.fn(),
  performCsg: vi.fn(),
}));

import { pushPullFaces } from "../occClient.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

const pushPullItem = (geom) => ({
  id: 1,
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: {
    kind: "pushpull",
    // A primitive source so withLivePolygons / remap pass it through unchanged.
    source: {
      id: 1,
      type: "cube",
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    subGeo: { faces: [{ nx: 0, ny: 0, nz: 1 }] },
    distance: 0.5,
    regeneratedAt: "dirty",
  },
});

describe("push/pull regen failure flag", () => {
  it("flags regenFailed and keeps the stale mesh when it can't rebuild", async () => {
    pushPullFaces.mockRejectedValueOnce(new Error("geometry rejected"));
    const stale = { positions: [0, 0, 0], normals: null, indices: [0] };
    const out = await regenerateItemsForResolution([pushPullItem(stale)], null);
    const item = out.find((i) => i.id === 1);
    expect(item.regenerator.regenFailed).toBe(true);
    expect(item.geometryData).toBe(stale); // last-good mesh preserved
  });

  it("clears regenFailed once the push/pull rebuilds", async () => {
    pushPullFaces.mockResolvedValueOnce({
      geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      centerOffset: { cx: 0, cy: 0, cz: 0 },
    });
    const item0 = pushPullItem({
      positions: [0, 0, 0],
      normals: null,
      indices: [0],
    });
    item0.regenerator.regenFailed = true; // had failed before
    const out = await regenerateItemsForResolution([item0], null);
    const item = out.find((i) => i.id === 1);
    expect(item.regenerator.regenFailed).toBe(false);
    expect(item.geometryData.positions).toEqual([1, 1, 1]);
  });
});
