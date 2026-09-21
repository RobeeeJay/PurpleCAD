// The Cog tool in the store: the dialog opens with its Centre button live, a
// click places the centre, Confirm adds a `cog` shape locked by a `cog`
// constraint -- or, with "break into vectors", plain lines that are no longer
// a cog.  Re-opening edits the cog in place.  Deleting its constraint unlocks
// it into lines, the same as text.
import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

// The real store builds the whole app at import time; stub it so the slice
// evaluates in isolation (as the other sketch-slice tests do).
vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [], theme: "dark" }) },
}));

import { createSketchSlice } from "../sketchSlice.js";
import { COG_DEFAULTS, cogParamsFromMm } from "../sketchCogSlice.js";
import { cogOutline } from "../../three/cogGeometry.js";

const MM = 10; // mm per scene unit

// A sketch with one line already in it, so a new cog lands at index 1 and an
// exploded one has something before it to keep.
const makeStore = () => {
  const shapes = [{ type: "line", x1: -5, y1: 0, x2: -3, y2: 0 }];
  const constraints = [{ type: "horizontal", shapeIdx: 0 }];
  return create((set) => ({
    items: [
      {
        id: 1,
        type: "sketch",
        shapes,
        constraints,
        position: {},
        rotation: {},
      },
    ],
    history: [
      {
        id: 0,
        instruction: {
          type: "create",
          item: { id: 1, type: "sketch", shapes, constraints },
        },
      },
    ],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createSketchSlice(set),
  }));
};
const sketch = (store) => store.getState().items[0];
const placeCog = (store, centre = { x: 2, y: 1 }) => {
  store.getState().startCogTool();
  store.getState().pickCogCentre(centre);
};

describe("placing a cog", () => {
  it("opens with the Centre button live and nothing to confirm yet", () => {
    const store = makeStore();
    store.getState().startCogTool();
    const tool = store.getState().sketchCogState;
    expect(store.getState().activeSketchTool).toBe("cog");
    expect(tool.picking).toBe(true);
    expect(tool.centre).toBeNull();
    expect(tool.params).toEqual(COG_DEFAULTS);
    store.getState().confirmCog(1);
    expect(sketch(store).shapes).toHaveLength(1); // nothing added
  });

  it("a picked centre ends the pick, and Confirm adds a locked cog there", () => {
    const store = makeStore();
    placeCog(store);
    expect(store.getState().sketchCogState.picking).toBe(false);
    store.getState().confirmCog(1);
    const { shapes, constraints } = sketch(store);
    expect(shapes[1]).toMatchObject({
      type: "cog",
      x: 2,
      y: 1,
      ...cogParamsFromMm(COG_DEFAULTS),
    });
    // Parameters are stored in scene units, like every other shape.
    expect(shapes[1].pitchDiameter).toBe(40 / MM);
    expect(constraints.at(-1)).toEqual({ type: "cog", shapeIdx: 1 });
    // The dialog closes.
    expect(store.getState().sketchCogState).toBeNull();
    expect(store.getState().activeSketchTool).toBeNull();
  });

  it("the timeline's copy of the sketch gets the cog too, so a reload keeps it", () => {
    const store = makeStore();
    placeCog(store);
    store.getState().confirmCog(1);
    const saved = store.getState().history[0].instruction.item;
    expect(saved.shapes[1].type).toBe("cog");
    expect(saved.constraints.at(-1)).toEqual({ type: "cog", shapeIdx: 1 });
  });

  it("parameters that can't make a gear are refused with a reason", () => {
    const store = makeStore();
    placeCog(store);
    store.getState().setCogParam("teeth", 3);
    store.getState().confirmCog(1);
    expect(sketch(store).shapes).toHaveLength(1);
    expect(store.getState().notification).toMatch(/at least 6/);
    // The dialog stays open to fix it.
    expect(store.getState().sketchCogState).not.toBeNull();
  });
});

describe("breaking a cog into vectors", () => {
  it("adds closed chains of lines instead of a cog, with no cog constraint", () => {
    const store = makeStore();
    placeCog(store);
    store.getState().setCogExplode(true);
    store.getState().confirmCog(1);
    const { shapes, constraints } = sketch(store);
    const params = cogParamsFromMm(COG_DEFAULTS);
    const [outline, hole] = cogOutline(params).contours;
    expect(shapes.some((s) => s.type === "cog")).toBe(false);
    expect(shapes.slice(1).every((s) => s.type === "line")).toBe(true);
    expect(shapes).toHaveLength(1 + outline.length + hole.length);
    expect(constraints.some((c) => c.type === "cog")).toBe(false);
    // Each line's end joins the next line's start, round each loop.
    const joins = constraints.filter((c) => c.type === "coincident");
    expect(joins).toHaveLength(outline.length + hole.length);
    // The line that was already there keeps its constraint.
    expect(constraints[0]).toEqual({ type: "horizontal", shapeIdx: 0 });
  });
});

describe("editing a cog", () => {
  const withCog = () => {
    const store = makeStore();
    placeCog(store);
    store.getState().confirmCog(1);
    const idx = sketch(store).constraints.findIndex((c) => c.type === "cog");
    return { store, idx };
  };

  it("re-opens the dialog with the cog's own values, in mm", () => {
    const { store, idx } = withCog();
    store.getState().beginCogEdit(1, idx);
    expect(store.getState().sketchCogState).toMatchObject({
      picking: false,
      centre: { x: 2, y: 1 },
      editIdx: 1,
      constraintIdx: idx,
    });
    const params = store.getState().sketchCogState.params;
    expect(params.teeth).toBe(20);
    expect(params.pitchDiameter).toBeCloseTo(40, 9);
    expect(params.rootFillet).toBeCloseTo(0.5, 9);
  });

  it("Confirm changes that cog in place instead of adding another", () => {
    const { store, idx } = withCog();
    store.getState().beginCogEdit(1, idx);
    store.getState().setCogParam("teeth", 32);
    store.getState().confirmCog(1);
    const { shapes, constraints } = sketch(store);
    expect(shapes).toHaveLength(2);
    expect(shapes[1].teeth).toBe(32);
    expect(constraints.filter((c) => c.type === "cog")).toHaveLength(1);
  });

  it("breaking an edited cog into vectors replaces it", () => {
    const { store, idx } = withCog();
    store.getState().beginCogEdit(1, idx);
    store.getState().setCogExplode(true);
    store.getState().confirmCog(1);
    const { shapes, constraints } = sketch(store);
    expect(shapes.some((s) => s.type === "cog")).toBe(false);
    expect(constraints.some((c) => c.type === "cog")).toBe(false);
    expect(shapes[0].type).toBe("line"); // the original line is untouched
    expect(constraints[0]).toEqual({ type: "horizontal", shapeIdx: 0 });
  });

  it("deleting the cog's constraint unlocks it into lines, like text", () => {
    const { store, idx } = withCog();
    store.getState().deleteSketchConstraint(1, idx);
    const { shapes } = sketch(store);
    expect(shapes.some((s) => s.type === "cog")).toBe(false);
    expect(shapes.length).toBeGreaterThan(100);
  });
});
