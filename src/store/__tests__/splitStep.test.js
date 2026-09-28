// Both kinds of split are recorded as ONE "Split" timeline step: the pieces are
// created there and the original is hidden from there on.  The plane split used
// to add each half as its own "Added" step and hide the original with no step at
// all, so nothing on the timeline said a split had happened.
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";

const s = () => useStore.getState();
const labels = () => s().history.map((h) => h.label);
// Consumed bodies stay in `items` -- rebuilds still look them up by id -- and are
// hidden by the active step's hiddenIds, which is what the view honours.
const visibleIds = () => {
  const st = s();
  const entry =
    st.activeHistoryId != null
      ? st.history.find((h) => h.id === st.activeHistoryId)
      : st.history.at(-1);
  const hidden = new Set(entry?.hiddenIds ?? []);
  return st.items.map((i) => i.id).filter((id) => !hidden.has(id));
};

const reset = () =>
  s().loadDocument({
    version: 1,
    history: [
      {
        id: 0,
        label: "Scene created",
        itemId: null,
        instruction: { type: "scene_created" },
        hiddenIds: [],
      },
    ],
    activeHistoryId: null,
    variables: [],
  });

// A triangle's worth of baked mesh at x offset `dx`.
const tri = (dx) => ({
  positions: [dx, 0, 0, dx + 1, 0, 0, dx, 1, 0],
  indices: [0, 1, 2],
});

const body = (id, name, geometryData) => ({
  id,
  name,
  type: "csg",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  material: { color: "#ff0000" },
  geometryData,
});

beforeEach(reset);

describe("a plane split", () => {
  const cut = () => {
    s().addItem(body(10, "Block", tri(0)));
    s().splitIntoParts(10, [
      body(11, "Block (1)", tri(0)),
      body(12, "Block (2)", tri(5)),
    ]);
  };

  it("is one Split step, not two Added steps", () => {
    cut();
    expect(labels()).toEqual(["Scene created", "Added", "Split"]);
  });

  it("records which body it cut, for the timeline to name it", () => {
    cut();
    expect(s().history.at(-1).instruction.splitFrom).toBe(10);
  });

  it("shows the pieces after the step and the original before it", () => {
    cut();
    expect(visibleIds().sort()).toEqual([11, 12]);
    // Step back onto "Added": the block is whole again.
    s().restoreToHistory(s().history[1].id);
    expect(visibleIds()).toEqual([10]);
  });

  it("undoes as a single step", () => {
    cut();
    s().undo();
    expect(labels()).toEqual(["Scene created", "Added"]);
    expect(visibleIds()).toEqual([10]);
  });

  it("selects the pieces it made", () => {
    cut();
    expect(s().selectedIds.sort()).toEqual([11, 12]);
  });

  it("does nothing for a body that isn't there", () => {
    s().addItem(body(10, "Block", tri(0)));
    s().splitIntoParts(99, [body(11, "Ghost", tri(0))]);
    expect(labels()).toEqual(["Scene created", "Added"]);
  });
});

// The same commit path serves the older split-into-connected-pieces action,
// which had no test of its own.
describe("splitting a body into its connected pieces", () => {
  it("is one Split step with the original hidden", () => {
    const two = {
      positions: [...tri(0).positions, ...tri(5).positions],
      indices: [0, 1, 2, 3, 4, 5],
    };
    s().addItem(body(20, "Pair", two));
    s().splitObject(20);
    expect(labels()).toEqual(["Scene created", "Added", "Split"]);
    expect(visibleIds()).not.toContain(20);
    expect(visibleIds()).toHaveLength(2);
  });
});
