// Refitting a projection (its source body moved) removes that projection's old
// shapes and APPENDS the refit ones, which renumbers every shape that sat after
// them.  The constraints must be remapped to match — the same rule delete/trim
// already follow.  Without it every later constraint silently re-binds to the
// wrong shape ("horizontal" landing on a vertical line, a 145 mm dimension on a
// 30 mm one) and the next drag's repair-solve drags unrelated geometry across
// the sketch.
import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";

const proj = (key) => ({
  sourceId: 9,
  edgeKey: key,
  key,
  localPolyline: [
    [0, 0, 0],
    [0, 1, 0],
  ],
});
// Shapes 0 + 1 are one projection group; 2 + 3 are ordinary geometry carrying
// the constraints that must survive the renumber.
const SHAPES = [
  { type: "line", x1: 0, y1: 0, x2: 5, y2: 0, projection: proj("p") },
  { type: "line", x1: 5, y1: 0, x2: 5, y2: 5, projection: proj("p") },
  { type: "line", x1: 0, y1: 2, x2: 4, y2: 2 }, // horizontal, len 4
  { type: "line", x1: 4, y1: 2, x2: 4, y2: 8 }, // vertical, len 6
];
const CONSTRAINTS = [
  { type: "horizontal", shapeIdx: 2 },
  { type: "vertical", shapeIdx: 3 },
  {
    type: "distance",
    shapeAIdx: 2,
    pointA: "start",
    shapeBIdx: 2,
    pointB: "end",
    distance: "40",
  },
  {
    type: "coincident",
    shapeAIdx: 2,
    pointA: "end",
    shapeBIdx: 3,
    pointB: "start",
  },
];

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
    shapes: SHAPES,
    constraints: CONSTRAINTS,
  };
  store.setState({
    items: [sketch],
    history: [{ id: 1, instruction: { type: "create", item: sketch } }],
  });
  return store;
};
const sketchOf = (store) => store.getState().items.find((i) => i.id === 1);

describe("updateProjectionShapes reindexing", () => {
  it("keeps every constraint bound to its own shape after a refit", () => {
    const store = makeStore();
    // Refit the group to a SINGLE shape: 2 removed, 1 appended, so the two
    // ordinary lines shift from 2,3 down to 0,1.
    store
      .getState()
      .updateProjectionShapes(1, "p", [
        { type: "line", x1: 0, y1: 0, x2: 6, y2: 0, projection: proj("p") },
      ]);
    const s = sketchOf(store);
    const idxOf = (pred) => s.shapes.findIndex(pred);
    const horiz = idxOf((sh) => !sh.projection && sh.y1 === 2 && sh.y2 === 2);
    const vert = idxOf((sh) => !sh.projection && sh.x1 === 4 && sh.x2 === 4);
    expect(horiz).toBeGreaterThanOrEqual(0);
    expect(vert).toBeGreaterThanOrEqual(0);

    // The horizontal/vertical/distance constraints must follow their shapes.
    const h = s.constraints.find((c) => c.type === "horizontal");
    const v = s.constraints.find((c) => c.type === "vertical");
    const d = s.constraints.find((c) => c.type === "distance");
    const co = s.constraints.find((c) => c.type === "coincident");
    expect(h.shapeIdx).toBe(horiz);
    expect(v.shapeIdx).toBe(vert);
    expect(d.shapeAIdx).toBe(horiz);
    expect(co.shapeAIdx).toBe(horiz);
    expect(co.shapeBIdx).toBe(vert);

    // The geometry each constraint now names really does match it.
    const hs = s.shapes[h.shapeIdx];
    expect(Math.abs(hs.y2 - hs.y1)).toBeCloseTo(0, 9); // truly horizontal
    const vs = s.shapes[v.shapeIdx];
    expect(Math.abs(vs.x2 - vs.x1)).toBeCloseTo(0, 9); // truly vertical
  });

  it("persists the remapped constraints into the CREATE entry", () => {
    const store = makeStore();
    store
      .getState()
      .updateProjectionShapes(1, "p", [
        { type: "line", x1: 0, y1: 0, x2: 6, y2: 0, projection: proj("p") },
      ]);
    const entry = store
      .getState()
      .history.find((h) => h.instruction?.item?.id === 1);
    expect(entry.instruction.item.constraints).toEqual(
      sketchOf(store).constraints,
    );
  });

  it("drops a constraint whose projected shape no longer exists", () => {
    const store = makeStore();
    // Constrain something to the SECOND projected shape, then refit to one.
    store.setState({
      items: [
        {
          ...sketchOf(store),
          constraints: [
            ...CONSTRAINTS,
            {
              type: "coincident",
              shapeAIdx: 1,
              pointA: "end",
              shapeBIdx: 2,
              pointB: "start",
            },
          ],
        },
      ],
    });
    store
      .getState()
      .updateProjectionShapes(1, "p", [
        { type: "line", x1: 0, y1: 0, x2: 6, y2: 0, projection: proj("p") },
      ]);
    const s = sketchOf(store);
    // The 4 original constraints survive; the one naming the vanished shape goes.
    expect(s.constraints).toHaveLength(4);
    expect(
      s.constraints.every((c) =>
        [c.shapeIdx, c.shapeAIdx, c.shapeBIdx]
          .filter((n) => typeof n === "number")
          .every((n) => n >= 0 && n < s.shapes.length),
      ),
    ).toBe(true);
  });
});
