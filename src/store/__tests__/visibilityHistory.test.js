// Regression tests for hiding / showing items via the history timeline.
// toggleItemVisibility now emits a `modify` history entry with
// `patches: { visible: ... }`, so replaying up to any earlier point in
// the timeline restores the visibility state the scene had at that step.

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

  it("replayUpTo: a [create, modify(visible:false)] timeline ends with the item hidden", () => {
    const history = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
      },
      {
        id: 2,
        label: "Hidden",
        itemId: 1,
        instruction: {
          type: "modify",
          itemId: 1,
          patches: { visible: false },
        },
      },
    ];
    const items = replayUpTo(history, history.length - 1);
    expect(items).toHaveLength(1);
    expect(items[0].visible).toBe(false);
  });

  it("replayUpTo BEFORE the hide step shows the item as still visible", () => {
    // The whole point of recording visibility in the history: scrubbing
    // the timeline back to a step BEFORE the user hid the cube must
    // restore it to visible.
    const history = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
      },
      {
        id: 2,
        label: "Hidden",
        itemId: 1,
        instruction: {
          type: "modify",
          itemId: 1,
          patches: { visible: false },
        },
      },
    ];
    const beforeHide = replayUpTo(history, 0);
    expect(beforeHide[0].visible).toBe(true);
    const afterHide = replayUpTo(history, 1);
    expect(afterHide[0].visible).toBe(false);
  });

  it("toggling visibility on then off cancels the previous step (no Hidden/Shown noise)", () => {
    // Regression for: "If an object is shown and hidden in subsequent
    // timeline steps, remove the step rather than add an additional one
    // that just toggles."  User hides cube → 1 history entry added.
    // Immediate show → that entry must be REMOVED (not append a 2nd).
    const initial = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
      },
    ];
    const useStore = makeStore(initial);
    expect(useStore.getState().history).toHaveLength(1);
    // Hide the cube.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(2);
    expect(useStore.getState().history[1].label).toBe("Hidden");
    expect(useStore.getState().items[0].visible).toBe(false);
    // Show the cube again — should cancel the Hidden entry, leaving the
    // history at length 1 (just the Added step) and the cube visible.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(1);
    expect(useStore.getState().items[0].visible).toBe(true);
  });

  it("non-adjacent visibility toggles do not cancel each other", () => {
    // Hide A, do an unrelated step, then show A — the Hidden A entry
    // must STAY (only adjacent toggles coalesce).
    const initial = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube", visible: true },
        },
      },
      {
        id: 2,
        label: "Added",
        itemId: 2,
        instruction: {
          type: "create",
          item: { id: 2, type: "sphere", visible: true },
        },
      },
    ];
    const useStore = makeStore(initial);
    // Hide A.
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(3);
    // Hide B (unrelated to A's visibility).
    useStore.getState().toggleItemVisibility(2);
    expect(useStore.getState().history).toHaveLength(4);
    // Show A — should APPEND, not cancel, because the previous step is
    // the unrelated "Hidden B".
    useStore.getState().toggleItemVisibility(1);
    expect(useStore.getState().history).toHaveLength(5);
    expect(useStore.getState().items[0].visible).toBe(true);
    expect(useStore.getState().items[1].visible).toBe(false);
  });

  it("toggling visibility on/off produces two history entries that round-trip correctly", () => {
    const history = [
      {
        id: 1,
        label: "Added",
        itemId: 1,
        instruction: {
          type: "create",
          item: { id: 1, type: "cube" }, // visible defaults to truthy
        },
      },
      {
        id: 2,
        label: "Hidden",
        itemId: 1,
        instruction: {
          type: "modify",
          itemId: 1,
          patches: { visible: false },
        },
      },
      {
        id: 3,
        label: "Shown",
        itemId: 1,
        instruction: {
          type: "modify",
          itemId: 1,
          patches: { visible: true },
        },
      },
    ];
    expect(replayUpTo(history, 0)[0].visible).toBeUndefined();
    expect(replayUpTo(history, 1)[0].visible).toBe(false);
    expect(replayUpTo(history, 2)[0].visible).toBe(true);
  });
});
