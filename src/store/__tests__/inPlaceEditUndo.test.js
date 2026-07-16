// Undoing an IN-PLACE entry edit (the timeline Edit flows: updateChamferEntry /
// updateEmbossEntry) must restore the original entry payload and the prior
// view, and redo must re-apply the edit.  The edit flows replace the entry's
// whole patches object, so a missing withUndo would silently lose the original
// recipe with no way back.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";
import { createHistoryNavSlice } from "../historyNavSlice.js";

const box = {
  id: 5,
  type: "cube",
  name: "Box 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const geom = { positions: [0, 0, 0], normals: null, indices: [0] };

const chamferPatches = (amount) => ({
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
    amount,
    segments: 1,
    regeneratedAt: 0.5,
  },
});

const embossPatches = (source, depth) => ({
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: {
    kind: "emboss",
    source,
    profiles: [],
    face: {},
    params: { distanceMm: depth },
    stamp: {},
    regeneratedAt: 0.5,
  },
});

const makeStore = () => {
  const history = [
    { id: "h1", instruction: { type: "create", item: box } },
    {
      id: "h2",
      instruction: { type: "modify", itemId: 5, patches: chamferPatches(0.1) },
    },
    {
      id: "h3",
      instruction: {
        type: "modify",
        itemId: 5,
        patches: embossPatches({ ...box, ...chamferPatches(0.1) }, 4),
      },
    },
  ];
  return create((set) => ({
    items: replayUpTo(history, history.length - 1),
    history,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
    ...createHistoryNavSlice(set),
  }));
};

const chamferAmount = (s) =>
  s.history.find((h) => h.id === "h2").instruction.patches.regenerator.amount;
const embossDepth = (s) =>
  s.history.find((h) => h.id === "h3").instruction.patches.regenerator.params
    .distanceMm;

describe("undo/redo of in-place entry edits", () => {
  it("updateChamferEntry is undoable and redoable", () => {
    const useStore = makeStore();
    useStore.getState().updateChamferEntry("h2", chamferPatches(0.42));
    expect(chamferAmount(useStore.getState())).toBe(0.42);
    expect(useStore.getState().undoStack.length).toBeGreaterThan(0);

    useStore.getState().undo();
    expect(chamferAmount(useStore.getState())).toBe(0.1);
    // The relinked downstream emboss source came back too.
    expect(
      useStore.getState().history.find((h) => h.id === "h3").instruction.patches
        .regenerator.source.regenerator.amount,
    ).toBe(0.1);

    useStore.getState().redo();
    expect(chamferAmount(useStore.getState())).toBe(0.42);
  });

  it("updateEmbossEntry is undoable and restores the prior view", () => {
    const useStore = makeStore();
    // The overlay edit flow views the pre-emboss step while editing; commit
    // lands on the entry.  Undo must return payload AND view.
    useStore.getState().restoreToHistory("h2");
    const viewBefore = useStore.getState().activeHistoryId;
    useStore
      .getState()
      .updateEmbossEntry(
        "h3",
        embossPatches({ ...box, ...chamferPatches(0.1) }, 9),
      );
    expect(embossDepth(useStore.getState())).toBe(9);
    // Confirm landed back on the edited entry (tip → null convention).
    expect(useStore.getState().activeHistoryId).toBe(null);

    useStore.getState().undo();
    expect(embossDepth(useStore.getState())).toBe(4);
    expect(useStore.getState().activeHistoryId).toBe(viewBefore);

    useStore.getState().redo();
    expect(embossDepth(useStore.getState())).toBe(9);
  });
});
