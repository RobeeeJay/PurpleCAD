// Regression: a multi-area extrude records its prisms as ONE "createGroup"
// timeline step (so the timeline shows a single "Extruded" entry), and the
// union that fuses them is the next, separate entry.  consumeItems must hide
// the grouped prisms in place so a replay doesn't resurrect them beside the
// union.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { applyInstruction, replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const makeStore = (initialHistory) =>
  create((set) => ({
    items: replayUpTo(initialHistory, initialHistory.length - 1),
    history: initialHistory,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));

const sketchEntry = {
  id: 1,
  label: "Added",
  itemId: 1,
  instruction: { type: "create", item: { id: 1, type: "sketch" } },
};

describe("createGroup timeline step", () => {
  it("applyInstruction('createGroup') appends every item at once", () => {
    const next = applyInstruction([{ id: 1, type: "sketch" }], {
      type: "createGroup",
      items: [
        { id: 2, type: "extrude" },
        { id: 3, type: "extrude" },
      ],
    });
    expect(next.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("addItems records ONE entry that creates several prisms", () => {
    const useStore = makeStore([sketchEntry]);
    useStore.getState().addItems(
      [
        { id: 2, name: "Extrude 2", type: "extrude" },
        { id: 3, name: "Extrude 3", type: "extrude" },
      ],
      "Extruded",
    );
    const { history, items } = useStore.getState();
    // One new entry (not two), of the group kind.
    expect(history).toHaveLength(2);
    expect(history[1].instruction.type).toBe("createGroup");
    expect(history[1].label).toBe("Extruded");
    // Both prisms are live in the scene.
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
    // Selection is left alone — the prisms are intermediate.
    expect(useStore.getState().selectedId).not.toBe(3);
  });

  it("consumeItems hides grouped prisms only from the union step onward", () => {
    const useStore = makeStore([sketchEntry]);
    useStore.getState().addItems(
      [
        { id: 2, name: "Extrude 2", type: "extrude", visible: true },
        { id: 3, name: "Extrude 3", type: "extrude", visible: true },
      ],
      "Extruded",
    );
    useStore.getState().addItem({
      id: 4,
      name: "Union 4",
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "boolean",
        op: "union",
        inputIds: [2, 3],
        regeneratedAt: 0.01,
      },
    });
    // The union swallows both prisms.
    useStore.getState().consumeItems([2, 3]);
    // At the createGroup step, the prisms are still visible.
    const atGroup = replayUpTo(useStore.getState().history, 1);
    expect(atGroup.find((i) => i.id === 2).visible).not.toBe(false);
    expect(atGroup.find((i) => i.id === 3).visible).not.toBe(false);
    // At the union step onward, the prisms are hidden.
    const atUnion = replayUpTo(useStore.getState().history, 2);
    expect(atUnion.find((i) => i.id === 2).visible).toBe(false);
    expect(atUnion.find((i) => i.id === 3).visible).toBe(false);
    expect(atUnion.find((i) => i.id === 4).visible).not.toBe(false);
  });

  // A group is resized as a unit: one distance applied to every prism.
  const withGroupAndUnion = () => {
    const useStore = makeStore([sketchEntry]);
    useStore.getState().addItems(
      [
        { id: 2, name: "Extrude 2", type: "extrude", depth: "10" },
        { id: 3, name: "Extrude 3", type: "extrude", depth: "10" },
      ],
      "Extruded",
    );
    useStore.getState().addItem({
      id: 4,
      name: "Union 4",
      type: "csg",
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      regenerator: {
        kind: "boolean",
        op: "union",
        inputIds: [2, 3],
        regeneratedAt: 0.01,
      },
    });
    return useStore;
  };

  it("setExtrudeGroupDepth sets one length on every prism and dirties the union", () => {
    const useStore = withGroupAndUnion();
    useStore.getState().setExtrudeGroupDepth([2, 3], "30");

    const groupItems = useStore.getState().history[1].instruction.items;
    expect(groupItems.map((it) => it.depth)).toEqual(["30", "30"]);
    expect(useStore.getState().items.find((i) => i.id === 2).depth).toBe("30");
    expect(useStore.getState().items.find((i) => i.id === 3).depth).toBe("30");
    expect(
      useStore.getState().items.find((i) => i.id === 4).regenerator
        .regeneratedAt,
    ).toBe("dirty");
  });

  it("retargetGroup rebuilds the group's prisms and re-points the union", () => {
    const useStore = withGroupAndUnion();
    const mkProfile = (tag) => ({
      tag,
      sketchId: 1,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    // Three regions selected where there were two — one prism is added.
    useStore
      .getState()
      .retargetGroup(
        [2, 3],
        [mkProfile("a"), mkProfile("b"), mkProfile("c")],
        "20",
      );

    const groupItems = useStore.getState().history[1].instruction.items;
    expect(groupItems).toHaveLength(3);
    expect(groupItems.map((it) => it.profile.tag)).toEqual(["a", "b", "c"]);
    // Existing ids reused; the extra region gets a fresh id above the union (4).
    expect(groupItems.map((it) => it.id)).toEqual([2, 3, 5]);
    expect(groupItems.every((it) => it.depth === "20")).toBe(true);
    // The union now fuses all three prisms and is dirty for the regen pass.
    const union = useStore.getState().items.find((i) => i.id === 4);
    expect(union.regenerator.inputIds).toEqual([2, 3, 5]);
    expect(union.regenerator.regeneratedAt).toBe("dirty");
  });

  it("retargetGroup with fewer regions drops the surplus prisms", () => {
    const useStore = withGroupAndUnion();
    const mkProfile = (tag) => ({
      tag,
      sketchId: 1,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    useStore.getState().retargetGroup([2, 3], [mkProfile("a")], "12");

    const groupItems = useStore.getState().history[1].instruction.items;
    expect(groupItems.map((it) => it.id)).toEqual([2]);
    expect(useStore.getState().items.find((i) => i.id === 3)).toBeUndefined();
    expect(
      useStore.getState().items.find((i) => i.id === 4).regenerator.inputIds,
    ).toEqual([2]);
  });

  it("retargetGroup re-points a chamfer's nested boolean source too", () => {
    const useStore = withGroupAndUnion();
    // Chamfer the union: its regenerator becomes a chamfer whose FROZEN source
    // is the boolean union (inputIds [2,3]).  This is what a chamfer-on-boss is.
    useStore.getState().modifyItem(
      4,
      {
        regenerator: {
          kind: "chamfer",
          source: {
            id: 4,
            type: "csg",
            regenerator: { kind: "boolean", op: "union", inputIds: [2, 3] },
          },
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 1,
          regeneratedAt: 0.01,
        },
      },
      "Chamfered",
    );

    useStore
      .getState()
      .retargetGroup(
        [2, 3],
        [{ tag: "a", sketchId: 1, position: {}, rotation: {} }],
        "12",
      );

    const chamfer = useStore
      .getState()
      .history.find(
        (h) =>
          h.instruction.type === "modify" &&
          h.instruction.patches?.regenerator?.kind === "chamfer",
      ).instruction.patches.regenerator;
    // The nested boolean source now fuses just the kept prism (not the dropped
    // one), and the chamfer is dirty so the regen rebuilds it.
    expect(chamfer.source.regenerator.inputIds).toEqual([2]);
    expect(chamfer.regeneratedAt).toBe("dirty");
  });
});
