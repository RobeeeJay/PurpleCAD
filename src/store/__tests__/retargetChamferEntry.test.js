// Regression: retargeting a chamfer/fillet to a new face/edge selection must
// update the EXISTING "Chamfered"/"Filleted" history entry's patches in
// place, not append a new step — see BevelSection's retarget(), which calls
// retargetChamferEntry instead of modifyItem.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const extrudeItem = () => ({
  id: 1,
  type: "extrude",
  name: "Extrude 1",
  children: [],
  parentId: null,
  depth: 2,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
});

const history = [
  { id: "h1", instruction: { type: "create", item: extrudeItem() } },
  {
    id: "h2",
    instruction: {
      type: "modify",
      itemId: 1,
      patches: {
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: extrudeItem(),
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: null,
          centerOffset: { cx: 0, cy: 0, cz: 0 },
        },
        geometryData: { positions: [1, 1, 1], normals: null, indices: [0] },
      },
    },
    label: "Chamfered",
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

describe("retargetChamferEntry", () => {
  it("updates the existing chamfer entry's patches without adding a new history step", () => {
    const useStore = makeStore();
    const newPatches = {
      type: "csg",
      position: { x: 1, y: 0, z: 0 },
      regenerator: {
        kind: "chamfer",
        source: extrudeItem(),
        subGeo: { edges: [], faces: [{ nx: 1, ny: 0, nz: 0 }] },
        amount: 0.2,
        segments: 1,
        regeneratedAt: null,
        centerOffset: { cx: 1, cy: 0, cz: 0 },
      },
      geometryData: { positions: [2, 2, 2], normals: null, indices: [0] },
    };

    useStore.getState().retargetChamferEntry("h2", newPatches);

    const state = useStore.getState();
    expect(state.history).toHaveLength(2);

    const entry = state.history.find((h) => h.id === "h2");
    expect(entry.instruction.patches).toEqual(newPatches);
    expect(entry.label).toBe("Chamfered");

    const item = state.items.find((i) => i.id === 1);
    expect(item.position).toEqual({ x: 1, y: 0, z: 0 });
    expect(item.regenerator.subGeo.faces[0]).toEqual({ nx: 1, ny: 0, nz: 0 });
  });

  it("leaves a non-chamfer modify entry untouched", () => {
    const plainHistory = [
      { id: "h1", instruction: { type: "create", item: extrudeItem() } },
      {
        id: "h2",
        instruction: {
          type: "modify",
          itemId: 1,
          patches: { type: "extrude", depth: 5 },
        },
        label: "Modified",
      },
    ];
    const useStore = create((set) => ({
      items: replayUpTo(plainHistory, plainHistory.length - 1),
      history: plainHistory,
      activeHistoryId: null,
      undoStack: [],
      redoStack: [],
      ...createHistorySlice(set),
    }));

    useStore.getState().retargetChamferEntry("h2", { type: "csg" });

    const entry = useStore.getState().history.find((h) => h.id === "h2");
    expect(entry.instruction.patches).toEqual({ type: "extrude", depth: 5 });
  });
});
