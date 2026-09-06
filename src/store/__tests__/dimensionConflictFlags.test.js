// A variable change that a sketch's other constraints won't allow leaves the
// sketch alone -- the dimension then READS the new value while the geometry
// stays at the old one.  setVariables records which variable-driven dimensions
// were refused so the sketch view can draw them in red; without that record
// the only feedback is a document-wide notification that names nothing.
//
// Uses the real store: setVariables spans slices and variablesSlice can't be
// imported standalone (module cycle through geometryParams).
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";
import { conflictingDimensions } from "../../three/sketchDimensionConflicts.js";

const lineLength = (constraint) => ({
  type: "distance",
  shapeAIdx: 0,
  pointA: "start",
  shapeBIdx: 0,
  pointB: "end",
  ...constraint,
});

// One horizontal line carrying TWO length dimensions: a variable-driven one
// and a fixed 40mm.  They agree at W = 40 and cannot both hold at any other W.
const overConstrained = () => ({
  id: 7,
  type: "sketch",
  name: "S",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [{ type: "line", x1: 0, y1: 0, x2: 4, y2: 0 }],
  constraints: [
    { type: "horizontal", shapeIdx: 0 },
    lineLength({ distance: "W" }),
    lineLength({ distance: "40" }),
  ],
});

const conflicts = () => useStore.getState().dimensionConflicts;

describe("a refused variable update flags the dimension that refused it", () => {
  beforeEach(() => {
    useStore.setState({
      items: [overConstrained()],
      history: [],
      activeHistoryId: null,
      variables: [{ name: "W", formula: "40" }],
      selectedId: 7,
      dimensionConflicts: new Set(),
    });
  });

  it("flags the variable-driven dimension, not the fixed one it fights", () => {
    useStore.getState().setVariables([{ name: "W", formula: "60" }]);
    const sk = useStore.getState().items[0];
    // The sketch really was left alone -- this is the state the user sees.
    expect(Math.hypot(sk.shapes[0].x2 - sk.shapes[0].x1, 0)).toBeCloseTo(4, 6);
    expect(useStore.getState().notification).toMatch(/red/);
    expect([...conflicts()]).toEqual([sk.constraints[1]]);
  });

  it("clears the flag once the value can be satisfied again", () => {
    useStore.getState().setVariables([{ name: "W", formula: "60" }]);
    expect(conflicts().size).toBe(1);
    useStore.getState().setVariables([{ name: "W", formula: "40" }]);
    expect(conflicts().size).toBe(0);
  });

  it("flags nothing when the sketch can take the new value", () => {
    useStore.setState({
      items: [
        {
          ...overConstrained(),
          constraints: [
            { type: "horizontal", shapeIdx: 0 },
            lineLength({ distance: "W" }),
          ],
        },
      ],
    });
    useStore.getState().setVariables([{ name: "W", formula: "60" }]);
    const sk = useStore.getState().items[0];
    expect(Math.hypot(sk.shapes[0].x2 - sk.shapes[0].x1, 0)).toBeCloseTo(6, 4);
    expect(conflicts().size).toBe(0);
  });

  it("reports the dimension as conflicting only while it stays unsatisfied", () => {
    const sk = overConstrained();
    const vars = { W: 60 };
    // The stale geometry does not meet W...
    expect(conflictingDimensions(sk.shapes, sk.constraints, vars)).toEqual([
      sk.constraints[1],
    ]);
    // ...and the same check clears itself once the geometry does meet it, which
    // is what stops a flag surviving a later drag that fixes the sketch.
    const fixed = [{ type: "line", x1: 0, y1: 0, x2: 6, y2: 0 }];
    expect(conflictingDimensions(fixed, sk.constraints, vars)).toEqual([]);
  });
});
