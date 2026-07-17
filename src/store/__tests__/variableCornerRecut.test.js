// A chamfer/bevel whose size is a variable formula re-cuts when the variable
// changes (bridge geometry is shape-level — the constraint solver doesn't
// drive it).  Uses the real store: variablesSlice can't be imported directly
// (module cycle through geometryParams), and setVariables spans slices.
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";

const bridgeSketch = () => ({
  id: 77,
  type: "sketch",
  name: "S",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [
    { type: "line", x1: -4, y1: 0, x2: -0.4, y2: 0 },
    { type: "line", x1: 0, y1: 0.4, x2: 0, y2: 4 },
    {
      type: "line",
      kind: "chamfer",
      x1: -0.4,
      y1: 0,
      x2: 0,
      y2: 0.4,
      chamferData: { dist: 0.4, aIdx: 0, aKey: "end", bIdx: 1, bKey: "start" },
      distanceFormula: "cs",
    },
  ],
  constraints: [],
});

describe("variable-driven corner re-cut", () => {
  beforeEach(() => {
    useStore.setState({
      items: [bridgeSketch()],
      history: [],
      activeHistoryId: null,
      variables: [],
    });
  });

  it("re-cuts the chamfer to the new evaluated size, keeping the formula", () => {
    useStore.getState().setVariables([{ name: "cs", formula: "9" }]);
    const b = useStore.getState().items[0].shapes[2];
    expect(b.chamferData.dist).toBeCloseTo(0.9, 6);
    expect(b.distanceFormula).toBe("cs");
    // The legs were trimmed to meet the new bridge.
    const legA = useStore.getState().items[0].shapes[0];
    expect(legA.x2).toBeCloseTo(-0.9, 6);
  });

  it("a bare-number formula and unrelated variables leave it alone", () => {
    useStore.getState().setVariables([{ name: "other", formula: "3" }]);
    const b = useStore.getState().items[0].shapes[2];
    // "cs" no longer resolves — the corner keeps its current geometry.
    expect(b.chamferData.dist).toBeCloseTo(0.4, 6);
  });
});
