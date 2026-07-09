// Reordering timeline steps must re-bind the frozen source chain to the NEW
// order and forward-invalidate — the reorder-timeline-fail regression.  Moving a
// chamfer before an emboss used to keep the chamfer's frozen source = the
// EMBOSSED body (so the chamfer step still showed the emboss) and the emboss
// then re-stamped on top of it (doubled relief): the steps were chained to the
// old order's geometry, not the new order's operations.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";
import { createUiSlice, uiInitial } from "../uiSlice.js";

const box = {
  id: 5,
  type: "cube",
  name: "Box 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  dimensions: { width: 2, height: 2, depth: 2 },
};
const geom = { positions: [0, 0, 0], normals: null, indices: [0] };
const csgPatches = (kind, source, extra) => ({
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: { kind, source, regeneratedAt: 0.5, ...extra },
});

// Old order: create → emboss(on box) → chamfer(on the EMBOSSED body).
const embossedBody = { ...box, ...csgPatches("emboss", box) };
const history = () => [
  { id: "h1", instruction: { type: "create", item: box } },
  {
    id: "h2",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("emboss", box, { stamp: { mode: "center" } }),
    },
  },
  {
    id: "h3",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("chamfer", embossedBody, { amount: 0.1 }),
    },
  },
];

const makeStore = () =>
  create((set) => ({
    ...uiInitial,
    items: replayUpTo(history(), 2),
    history: history(),
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createUiSlice(set),
    ...createHistorySlice(set),
  }));

describe("reorderHistory relinks frozen sources to the new order", () => {
  it("moving the chamfer before the emboss rebinds both sources + dirties", () => {
    const s = makeStore();
    s.getState().reorderHistory("h3", "h2"); // chamfer now BEFORE emboss

    const h = s.getState().history;
    expect(h.map((e) => e.id)).toEqual(["h1", "h3", "h2"]);

    // The chamfer now builds on the PLAIN box — its old frozen source (the
    // embossed body) must be gone, or the chamfer step still shows the emboss.
    const chamferSrc = h[1].instruction.patches.regenerator.source;
    expect(chamferSrc.regenerator).toBeUndefined();
    expect(chamferSrc.type).toBe("cube");

    // The emboss now builds on the CHAMFERED body — not the plain box — or the
    // relief would stamp twice (once baked into its stale input, once fresh).
    const embossSrc = h[2].instruction.patches.regenerator.source;
    expect(embossSrc.regenerator?.kind).toBe("chamfer");

    // Forward invalidation from the first affected index: both moved-span
    // entries rebuild; the create stays clean.
    expect(h.map((e) => !!e.dirty)).toEqual([false, true, true]);
  });
});
