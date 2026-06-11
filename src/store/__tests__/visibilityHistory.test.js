// Regression tests for hiding / showing items via the timeline's per-step
// `hiddenIds` snapshot. toggleItemVisibility no longer inserts a "Shown" /
// "Hidden" history entry — it edits `hiddenIds` on the current (or last)
// entry and every later entry, so scrubbing back to an earlier step
// restores the visibility state the scene had at that step.

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

describe("visibility in the history timeline", () => {
  it("applyInstruction('modify', { visible: false }) flips the visible field", () => {
    const items = [
      { id: 1, type: "cube", visible: true },
      { id: 2, type: "cube", visible: true },
    ];
    const next = applyInstruction(items, {
      type: "modify",
      itemId: 1,
      patches: { visible: false },
    });
    expect(next[0].visible).toBe(false);
    expect(next[1].visible).toBe(true);
  });

  it("replayUpTo applies hiddenIds from the target step's snapshot", () => {
    const history = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
        hiddenIds: [],
      },
      {
        id: 2,
        label: "Added",
        itemId: 2,
        instruction: {
          type: "create",
          item: { id: 2, type: "sphere", visible: true },
        },
        hiddenIds: [1],
      },
    ];
    const items = replayUpTo(history, history.length - 1);
    expect(items.find((i) => i.id === 1).visible).toBe(false);
    expect(items.find((i) => i.id === 2).visible).toBe(true);
  });

  it("replayUpTo BEFORE the hiding step shows the item as still visible", () => {
    // Scrubbing the timeline back to a step BEFORE the user hid the cube
    // must restore it to visible.
    const history = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
        hiddenIds: [],
      },
      {
        id: 2,
        label: "Added",
        itemId: 2,
        instruction: {
          type: "create",
          item: { id: 2, type: "sphere", visible: true },
        },
        hiddenIds: [1],
      },
    ];
    const beforeHide = replayUpTo(history, 0);
    expect(beforeHide[0].visible).toBe(true);
    const afterHide = replayUpTo(history, 1);
    expect(afterHide.find((i) => i.id === 1).visible).toBe(false);
  });

  it("toggling visibility does not add a history entry", () => {
    const initial = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
        hiddenIds: [],
      },
    ];
    const useStore = makeStore(initial);
    expect(useStore.getState().history).toHaveLength(1);
    // Hide the cube — edits hiddenIds on the existing entry, no new entry.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(1);
    expect(useStore.getState().history[0].hiddenIds).toEqual([1]);
    expect(useStore.getState().items[0].visible).toBe(false);
    // Show it again — back to the original snapshot.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(1);
    expect(useStore.getState().history[0].hiddenIds).toEqual([]);
    expect(useStore.getState().items[0].visible).toBe(true);
  });

  it("hiding an item from a later step doesn't affect earlier steps", () => {
    const initial = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
        hiddenIds: [],
      },
      {
        id: 2,
        label: "Added",
        itemId: 2,
        instruction: {
          type: "create",
          item: { id: 2, type: "sphere", visible: true },
        },
        hiddenIds: [],
      },
    ];
    const useStore = makeStore(initial);
    // Hide item 1 at the current (last) step.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history[1].hiddenIds).toEqual([1]);
    expect(useStore.getState().history[0].hiddenIds).toEqual([]);
    // Replaying the earlier step still shows item 1 visible.
    const atStep0 = replayUpTo(useStore.getState().history, 0);
    expect(atStep0.find((i) => i.id === 1).visible).toBe(true);
    // Replaying the current step shows it hidden.
    const atStep1 = replayUpTo(useStore.getState().history, 1);
    expect(atStep1.find((i) => i.id === 1).visible).toBe(false);
  });
});
