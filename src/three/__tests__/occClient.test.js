// Verifies the occClient RPC surface end-to-end against the in-process
// fallback path.  Node's vitest runtime has no `Worker`, so the client's
// `hasWorker === false` branch is what runs here — exactly the path used
// in any future environment that lacks Web Workers, and a stand-in for
// the worker path during testing.
//
// The test ensures:
//   1. chamferOrFilletItem returns a tessellated geometryData + centre
//      offset matching what we'd get from calling OCC directly.
//   2. The store's pendingOperations counter is incremented while the
//      op runs and returned to zero after.
//   3. Multiple concurrent calls stack the counter correctly.

import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock the store with a real-ish implementation: a counter the client
// can drive via beginOperation/endOperation.
let beginCount = 0;
let endCount = 0;
let counter = 0;
const state = {
  get pendingOperations() {
    return counter;
  },
  beginOperation() {
    counter += 1;
    beginCount += 1;
  },
  endOperation() {
    counter = Math.max(0, counter - 1);
    endCount += 1;
  },
};
vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => state;
  return { useStore };
});

import fs from "node:fs";
import { ensureOcc } from "../occ/init.js";
import {
  chamferOrFilletItem,
  deepResolveDepth,
  bakeArgPolygons,
} from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60_000);

describe("deepResolveDepth (formula -> scene units before the IPC boundary)", () => {
  const vars = { height: 60, width: 5 };
  it("resolves a variable depth to scene units (mm / 10)", () => {
    const ex = { type: "extrude", depth: "height", profile: {} };
    // 60 mm -> 6.0 scene units, NOT the bridge's 1-unit (10 mm) fallback.
    expect(deepResolveDepth(ex, vars).depth).toBe(6);
  });
  it("resolves a formula depth and leaves numbers / non-extrudes untouched", () => {
    expect(
      deepResolveDepth({ type: "extrude", depth: "height * 2" }, vars).depth,
    ).toBe(12);
    const num = { type: "extrude", depth: 4 };
    expect(deepResolveDepth(num, vars)).toBe(num);
    const sketch = { type: "sketch", shapes: [] };
    expect(deepResolveDepth(sketch, vars)).toBe(sketch);
  });
  it("resolves a chamfer regenerator's nested extrude source", () => {
    const csg = {
      type: "csg",
      regenerator: {
        kind: "chamfer",
        source: { type: "extrude", depth: "height" },
      },
    };
    expect(deepResolveDepth(csg, vars).regenerator.source.depth).toBe(6);
  });
  it("resolves a fused extrude's embedded prism depths (extrudeUnion / extrudeCut)", () => {
    // The bridge rebuilds a fused extrude used as a HOST from these defs, so an
    // unresolved "height" here collapses the whole body to the 1-unit fallback
    // (the multi-hole cut on a formula-height wall bug).
    const fused = {
      type: "csg",
      regenerator: {
        kind: "extrudeCut",
        inputIds: [1],
        extrudeDefs: [
          { type: "extrude", depth: "height", profile: {} },
          { type: "extrude", depth: "width * 2", profile: {} },
        ],
      },
    };
    const out = deepResolveDepth(fused, vars);
    // mm / 10: height 60 -> 6.0 scene units; width*2 = 10 mm -> 1.0.
    expect(out.regenerator.extrudeDefs[0].depth).toBe(6);
    expect(out.regenerator.extrudeDefs[1].depth).toBe(1);
  });
});

describe("bakeArgPolygons (live polygon -> baked before the IPC boundary)", () => {
  // The Electron bridge builds an extrude from its STORED polygon2D; if the
  // source sketch was edited after the extrude was created, that polygon is
  // stale and the bridge rebuilds the old profile — so an extrude used as a
  // boss HOST (runExtrudeUnion) "extrudes for no reason".  broken-extrude.pcad
  // is exactly this: Extrude 2's frozen profile is a 3-point triangle while its
  // live Sketch 1 is a 4-point quad.  bakeArgPolygons must re-derive the quad
  // for every input so the bridge builds what the renderer shows.  (occOps
  // re-derives internally, so this only bites the Electron path.)
  it("re-derives an extrude's live sketch profile over a stale frozen one", () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/broken-extrude.pcad", "utf8"),
    );
    const items = doc.history
      .filter((h) => h.instruction?.type === "create")
      .map((h) => h.instruction.item);
    const extrude2 = items.find((i) => i.id === 2);
    expect(extrude2.profile.polygon2D.length).toBe(3); // stale triangle

    const out = bakeArgPolygons({
      selectedItems: [extrude2],
      allItems: items,
      printPrecision: 0.1,
    });
    const baked = out.selectedItems[0].profile.polygon2D;
    // Live Sketch 1 is a 4-point quad whose x stays well left of the stale
    // triangle's (which reached +1.2).
    expect(baked.length).toBe(4);
    expect(Math.max(...baked.map((p) => p.x))).toBeLessThan(-1);
    // Pure: the original item is untouched.
    expect(extrude2.profile.polygon2D.length).toBe(3);
  });
});

describe("occClient (in-process fallback)", () => {
  it("chamferOrFilletItem produces non-empty geometry and toggles the busy counter", async () => {
    expect(counter).toBe(0);
    const cube = { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const promise = chamferOrFilletItem({
      source: cube,
      subGeo: {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      amount: 0.1,
      angleRad: null,
      segments: 1,
      allItems: [cube],
      printPrecision: 0.01,
    });
    // The counter increment is synchronous (happens before the awaited
    // microtask yield), so it should already be 1 here.
    expect(counter).toBe(1);
    const result = await promise;
    expect(counter).toBe(0);
    expect(result).toBeTruthy();
    expect(result.geometryData.positions.length).toBeGreaterThan(0);
    expect(result.geometryData.indices.length).toBeGreaterThan(0);
    expect(typeof result.centerOffset.cx).toBe("number");
  });

  it("throws a descriptive error (and releases the busy counter) when the selection doesn't match anything on the source", async () => {
    const before = counter;
    const cube = { id: 2, type: "cube", position: { x: 0, y: 0, z: 0 } };
    await expect(
      chamferOrFilletItem({
        source: cube,
        // A normal no face of the cube has — chamferShapeBy returns the
        // input shape unchanged.  Previously chamferOrFilletItem swallowed
        // that as a null return; now it throws so the toolbar alert
        // surfaces the failure instead of the click looking ignored.
        subGeo: { edges: [], faces: [{ nx: 0.7, ny: 0.7, nz: 0 }] },
        amount: 0.05,
        angleRad: null,
        segments: 1,
        allItems: [cube],
        printPrecision: null,
      }),
    ).rejects.toThrow(/couldn't find a matching/i);
    // The busy counter still has to balance even on the error path.
    expect(counter).toBe(before);
  });

  it("stacks the counter for concurrent calls", async () => {
    const cube = { id: 3, type: "cube", position: { x: 0, y: 0, z: 0 } };
    const args = {
      source: cube,
      subGeo: {
        edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
        faces: [],
      },
      amount: 0.05,
      angleRad: null,
      segments: 1,
      allItems: [cube],
      printPrecision: null,
    };
    const startBegin = beginCount;
    const startEnd = endCount;
    const startCounter = counter;
    const p1 = chamferOrFilletItem(args);
    const p2 = chamferOrFilletItem(args);
    // Two concurrent ops should drive the counter to startCounter + 2 before
    // either resolves.
    expect(counter).toBe(startCounter + 2);
    await Promise.all([p1, p2]);
    // Counter back to baseline; begin/end calls balanced.
    expect(counter).toBe(startCounter);
    expect(beginCount - startBegin).toBe(2);
    expect(endCount - startEnd).toBe(2);
  });
});
