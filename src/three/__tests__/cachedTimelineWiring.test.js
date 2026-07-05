// Phase 2 wiring: regenerateItemsForResolution's solidCtx path caches each op's
// retained result solid and consumes a cached input solid.  Proven end-to-end
// through the dispatcher (not just the op) with real OCC in-process.

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

import { regenerateItemsForResolution } from "../regenerateItems.js";
import { releaseShape } from "../occClient.js";

const square = (h) => [
  { type: "line", x1: -h, y1: -h, x2: h, y2: -h },
  { type: "line", x1: h, y1: -h, x2: h, y2: h },
  { type: "line", x1: h, y1: h, x2: -h, y2: h },
  { type: "line", x1: -h, y1: h, x2: -h, y2: -h },
];

const chamferItems = () => [
  { id: 1, type: "sketch", shapes: square(1) },
  {
    id: 2,
    type: "csg",
    position: { x: 0, y: 0, z: 0 },
    regenerator: {
      kind: "chamfer",
      source: {
        id: 1,
        type: "extrude",
        depth: 2,
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
      subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
      amount: 0.2,
      segments: 1,
      regeneratedAt: "dirty",
    },
  },
];

const sig = (geo) => {
  const p = geo.positions;
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += p[i];
  return `${p.length}:${sum.toFixed(4)}`;
};

describe("solidCtx timeline cache wiring", () => {
  it("caches the op's retained result and leaves geometry unchanged", async () => {
    const plain = await regenerateItemsForResolution(chamferItems(), null);
    const plainGeo = plain.find((i) => i.id === 2).geometryData;

    const solidCtx = { inputs: new Map(), results: new Map() };
    const cached = await regenerateItemsForResolution(
      chamferItems(),
      null,
      null,
      solidCtx,
    );
    const cachedGeo = cached.find((i) => i.id === 2).geometryData;

    // Result solid retained + handed to the cache.
    const shapeId = solidCtx.results.get(2);
    expect(shapeId).toBeGreaterThan(0);
    // The cache path is transparent — identical tessellation to the plain path.
    expect(sig(cachedGeo)).toBe(sig(plainGeo));

    releaseShape(shapeId);
  });

  it("consumes the supplied cached input solid (dispatcher honours inputs)", async () => {
    // First pass produces the chamfered body's solid and caches it.
    const ctx1 = { inputs: new Map(), results: new Map() };
    const first = await regenerateItemsForResolution(
      chamferItems(),
      null,
      null,
      ctx1,
    );
    const firstGeo = first.find((i) => i.id === 2).geometryData;
    const chamferedSolid = ctx1.results.get(2);
    expect(chamferedSolid).toBeGreaterThan(0);

    // Second pass feeds that already-chamfered solid back in as item 2's input.
    // The chamfer now bevels an already-bevelled body → a DIFFERENT result than
    // rebuilding from the extrude recipe.  If the dispatcher ignored the input,
    // the geometry would be identical to the first pass.
    const ctx2 = {
      inputs: new Map([[2, chamferedSolid]]),
      results: new Map(),
    };
    const second = await regenerateItemsForResolution(
      chamferItems(),
      null,
      null,
      ctx2,
    );
    const secondGeo = second.find((i) => i.id === 2).geometryData;
    const doubleSolid = ctx2.results.get(2);
    expect(doubleSolid).toBeGreaterThan(0);
    expect(sig(secondGeo)).not.toBe(sig(firstGeo));

    releaseShape(chamferedSolid);
    releaseShape(doubleSolid);
  });
});
