// setItemTransform (live, per-axis) + recordTransformHistory (persist, with the
// Moved/Scaled/Rotated instruction split and merge-in-place of consecutive
// same-type transforms).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createHistorySlice } from "../historySlice.js";

const makeStore = () =>
  create((set, get) => ({
    items: [],
    history: [
      {
        id: 0,
        label: "Scene created",
        instruction: { type: "scene_created" },
        hiddenIds: [],
        _orphaned: false,
      },
    ],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    defaultMaterial: {},
    ...createHistorySlice(set, get),
  }));

const cube = {
  id: 1,
  type: "cube",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

describe("setItemTransform + recordTransformHistory", () => {
  let store;
  const g = () => store.getState();
  const item = () => g().items.find((i) => i.id === 1);
  const transforms = () =>
    g().history.filter((h) => h.instruction.type === "transform");

  beforeEach(() => {
    store = makeStore();
    g().addItem({ ...cube });
  });

  it("applies a per-axis scale live (no uniform coupling)", () => {
    g().setItemTransform(1, null, { x: 2, y: 1, z: 3 }, null);
    expect(item().scale).toEqual({ x: 2, y: 1, z: 3 });
    // position / rotation untouched
    expect(item().position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("records only the matching field per action label", () => {
    g().setItemTransform(1, { x: 5, y: 0, z: 0 }, null, null);
    g().recordTransformHistory(1, "Moved");
    const inst = transforms()[0].instruction;
    expect(inst.position).toEqual({ x: 5, y: 0, z: 0 });
    expect(inst.scale).toBeUndefined();
    expect(inst.rotation).toBeUndefined();

    g().setItemTransform(1, null, { x: 4, y: 1, z: 1 }, null);
    g().recordTransformHistory(1, "Scaled");
    const scaled = transforms().find((t) => t.label === "Scaled").instruction;
    expect(scaled.scale).toEqual({ x: 4, y: 1, z: 1 });
    expect(scaled.position).toBeUndefined();
  });

  it("merges consecutive same-type transforms in place", () => {
    g().setItemTransform(1, { x: 5, y: 0, z: 0 }, null, null);
    g().recordTransformHistory(1, "Moved");
    const afterFirst = g().history.length;

    g().setItemTransform(1, { x: 7, y: 0, z: 0 }, null, null);
    g().recordTransformHistory(1, "Moved");
    // same label → no new entry, value updated in place
    expect(g().history.length).toBe(afterFirst);
    expect(transforms()[0].instruction.position.x).toBe(7);
  });

  it("does not merge across different transform kinds", () => {
    g().setItemTransform(1, { x: 5, y: 0, z: 0 }, null, null);
    g().recordTransformHistory(1, "Moved");
    g().setItemTransform(1, null, null, { x: 0.1, y: 0, z: 0 });
    g().recordTransformHistory(1, "Rotated");
    expect(transforms().length).toBe(2);
  });
});
