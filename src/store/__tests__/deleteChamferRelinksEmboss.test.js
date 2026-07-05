// Regression: an emboss applied on top of a chamfered body stores the chamfer
// as its frozen regenerator.source.  Deleting the chamfer timeline step must
// splice that layer out so the emboss rebuilds on the NON-chamfered object —
// otherwise the chamfer survives inside the emboss's source and keeps coming
// back.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

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

const chamferPatches = {
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: {
    kind: "chamfer",
    source: box,
    subGeo: {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    },
    amount: 0.1,
    segments: 1,
    regeneratedAt: 0.5,
  },
};

// The item state AFTER the chamfer — what the emboss snapshots as its source.
const chamferSnapshot = { ...box, ...chamferPatches };

const embossPatches = {
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: {
    kind: "emboss",
    source: chamferSnapshot,
    profiles: [],
    face: {},
    params: {},
    stamp: {},
    regeneratedAt: 0.5,
  },
};

const history = [
  { id: "h1", instruction: { type: "create", item: box } },
  {
    id: "h2",
    instruction: { type: "modify", itemId: 5, patches: chamferPatches },
  },
  {
    id: "h3",
    instruction: { type: "modify", itemId: 5, patches: embossPatches },
  },
];

const makeStore = () =>
  create((set) => ({
    items: replayUpTo(history, history.length - 1),
    history,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));

describe("deleting a chamfer under an emboss re-points the emboss source", () => {
  it("splices the chamfer out of the emboss's frozen source", () => {
    const useStore = makeStore();
    useStore.getState().deleteHistoryEntry("h2");

    // The emboss step now sources the plain box, not the chamfered csg.
    const embossEntry = useStore.getState().history.find((h) => h.id === "h3");
    const src = embossEntry.instruction.patches.regenerator.source;
    expect(src.type).toBe("cube");
    expect(src.regenerator).toBeUndefined();

    // And the live emboss item points at the non-chamfered source, marked
    // dirty so the recalc rebuilds it.
    const embossItem = useStore.getState().items.find((i) => i.id === 5);
    expect(embossItem.regenerator.kind).toBe("emboss");
    expect(embossItem.regenerator.source.type).toBe("cube");
    expect(embossItem.regenerator.source.regenerator).toBeUndefined();
  });
});
