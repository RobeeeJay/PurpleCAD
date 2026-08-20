// The reference underlay lives ON the sketch item and must survive save/reload
// — so it has to be written into the sketch's CREATE history entry, the same
// way shape edits are.  It is NOT geometry, so committing one must not mark
// downstream CSG dirty (that would force a full rebuild for a cosmetic guide).
import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

// Importing the slice directly would pull in store.js, which imports the slice
// back — mock it, as the other slice tests do.
vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";

const makeStore = () => {
  const store = create((set) => ({
    items: [],
    history: [],
    activeHistoryId: null,
    variables: [],
    ...createSketchSlice(set),
  }));
  const sketch = {
    id: 1,
    type: "sketch",
    name: "Sketch 1",
    shapes: [],
    constraints: [],
  };
  const csg = {
    id: 2,
    type: "csg",
    geometryData: { positions: [], indices: [] },
    regenerator: { kind: "boolean", regeneratedAt: 0.1 },
  };
  store.setState({
    items: [sketch, csg],
    history: [
      { id: 1, instruction: { type: "create", item: sketch } },
      { id: 2, instruction: { type: "create", item: csg } },
    ],
  });
  return store;
};

const UNDERLAY = {
  dataUrl: "data:image/png;base64,AAAA",
  name: "plan",
  imageAspect: 0.5,
  widthMm: 120,
  offsetX: 1,
  offsetY: -2,
  rotationDeg: 15,
  opacity: 0.4,
};

describe("setSketchUnderlay", () => {
  it("stores the underlay on the item AND its CREATE entry (survives reload)", () => {
    const store = makeStore();
    store.getState().setSketchUnderlay(1, UNDERLAY);
    const s = store.getState();
    expect(s.items.find((i) => i.id === 1).underlay).toEqual(UNDERLAY);
    // The CREATE entry is what a save/replay rebuilds from.
    const entry = s.history.find((h) => h.instruction?.item?.id === 1);
    expect(entry.instruction.item.underlay).toEqual(UNDERLAY);
  });

  it("does not dirty downstream CSG — it is a visual guide, not geometry", () => {
    const store = makeStore();
    const before = store.getState().items.find((i) => i.id === 2);
    store.getState().setSketchUnderlay(1, UNDERLAY);
    const after = store.getState().items.find((i) => i.id === 2);
    expect(after.regenerator.regeneratedAt).toBe(
      before.regenerator.regeneratedAt,
    );
    expect(after.geometryData).toBe(before.geometryData);
  });

  it("removes the underlay (and its stored copy) when passed null", () => {
    const store = makeStore();
    store.getState().setSketchUnderlay(1, UNDERLAY);
    store.getState().setSketchUnderlay(1, null);
    const s = store.getState();
    expect("underlay" in s.items.find((i) => i.id === 1)).toBe(false);
    const entry = s.history.find((h) => h.instruction?.item?.id === 1);
    expect("underlay" in entry.instruction.item).toBe(false);
  });

  it("ignores a non-sketch target", () => {
    const store = makeStore();
    store.getState().setSketchUnderlay(2, UNDERLAY);
    expect(
      store.getState().items.find((i) => i.id === 2).underlay,
    ).toBeUndefined();
  });
});
