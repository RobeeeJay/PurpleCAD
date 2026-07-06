// Phase 0 of the JIT timeline: the store mutation actions must set per-entry
// `dirty` flags following the spec's forward-invalidation rules —
//   edit E          → E and every later entry dirty
//   delete E        → every entry after the deleted one dirty
//   insert at P      → the new entry and every later entry dirty
//   resolution toggle → the whole timeline dirty

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
const csgPatches = (kind, extra) => ({
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: { kind, source: box, regeneratedAt: 0.5, ...extra },
});

const history = () => [
  { id: "h1", instruction: { type: "create", item: box } },
  {
    id: "h2",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("chamfer", {
        subGeo: { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
        amount: 0.1,
        segments: 1,
      }),
    },
  },
  {
    id: "h3",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("emboss", {
        source: { ...box, ...csgPatches("chamfer", { amount: 0.1 }) },
      }),
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

const dirty = (s) => s.getState().history.map((e) => !!e.dirty);

describe("timeline forward invalidation", () => {
  it("editing an entry dirties it and every later entry", () => {
    const s = makeStore();
    s.getState().updateChamferParams("h2", { amount: 0.42 });
    expect(dirty(s)).toEqual([false, true, true]); // h1 clean, h2 + h3 dirty
  });

  it("deleting an entry dirties every entry after it", () => {
    const s = makeStore();
    s.getState().deleteHistoryEntry("h2");
    // h2 gone; the entry that followed (h3) is dirty, the base create stays clean.
    expect(dirty(s)).toEqual([false, true]);
  });

  it("inserting a modify (bevel) mid-timeline dirties the later entries", () => {
    const s = makeStore();
    // Park on h2 and insert a shell — it lands between h2 and h3, and h3 (which
    // existed already) must rebuild on top of it, so it must be marked dirty.
    s.setState({ activeHistoryId: "h2" });
    s.getState().modifyItem(
      5,
      csgPatches("shell", { thickness: 0.1 }),
      "Shelled",
    );
    // Order: h1, h2, <new>, h3 → the new step + h3 dirty; h1/h2 stay clean.
    expect(dirty(s)).toEqual([false, false, true, true]);
  });

  it("toggling the resolution dirties the whole timeline", () => {
    const s = makeStore();
    s.getState().toggleCurveResolution();
    expect(dirty(s)).toEqual([true, true, true]);
  });
});
