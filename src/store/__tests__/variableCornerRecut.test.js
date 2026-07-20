// A chamfer/bevel whose size is a variable formula re-cuts when the variable
// changes (bridge geometry is shape-level — the constraint solver doesn't
// drive it).  Uses the real store: variablesSlice can't be imported directly
// (module cycle through geometryParams), and setVariables spans slices.
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";
import { buildBevelArc } from "../../three/sketchGeometry.js";

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

describe("rectangular pattern formulas", () => {
  beforeEach(() => {
    useStore.setState({
      items: [
        {
          id: 88,
          type: "sketch",
          name: "P",
          children: [],
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes: [{ type: "circle", cx: 0, cy: 0, r: 0.5 }],
          constraints: [],
        },
      ],
      history: [],
      activeHistoryId: null,
      variables: [{ name: "gap", formula: "30" }],
      selectedId: 88,
    });
  });

  it("confirm resolves mm formulas and stores them on the constraints", () => {
    const s = useStore.getState();
    s.startRectangularPatternTool();
    s.toggleRectangularPatternShape(0);
    s.setRectangularPatternCountX(2);
    s.setRectangularPatternCountY(1);
    s.setRectangularPatternOffsetX("gap");
    s.setRectangularPatternOffsetY(0);
    useStore.getState().confirmRectangularPattern(88);
    const it = useStore.getState().items[0];
    const c = it.constraints.find((x) => x.type === "rectangularPattern");
    expect(c.dx).toBeCloseTo(3, 6); // 30 mm = 3 units
    expect(c.dxFormula).toBe("gap");
    expect(it.shapes[1].cx).toBeCloseTo(3, 6);
  });

  it("changing the variable re-spaces the copies", () => {
    const s = useStore.getState();
    s.startRectangularPatternTool();
    s.toggleRectangularPatternShape(0);
    s.setRectangularPatternCountX(2);
    s.setRectangularPatternCountY(1);
    s.setRectangularPatternOffsetX("gap");
    s.setRectangularPatternOffsetY(0);
    useStore.getState().confirmRectangularPattern(88);
    useStore.getState().setVariables([{ name: "gap", formula: "50" }]);
    const it = useStore.getState().items[0];
    const c = it.constraints.find((x) => x.type === "rectangularPattern");
    expect(c.dx).toBeCloseTo(5, 6);
    expect(c.dxFormula).toBe("gap");
    expect(it.shapes[1].cx).toBeCloseTo(5, 6);
  });

  it("edit seeding hands back the formula, plain offsets as mm", () => {
    const s = useStore.getState();
    s.startRectangularPatternTool();
    s.toggleRectangularPatternShape(0);
    s.setRectangularPatternCountX(2);
    s.setRectangularPatternCountY(1);
    s.setRectangularPatternOffsetX("gap");
    s.setRectangularPatternOffsetY(20);
    useStore.getState().confirmRectangularPattern(88);
    const idx = useStore
      .getState()
      .items[0].constraints.findIndex((x) => x.type === "rectangularPattern");
    useStore.getState().beginRectangularPatternEdit(88, idx);
    const st = useStore.getState().sketchRectangularPatternState;
    expect(st.offsetX).toBe("gap");
    expect(st.offsetY).toBeCloseTo(20, 6); // mm, not units
  });
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

describe("variable-driven MINUS (flipped) fillet re-cut", () => {
  // A 90° corner at the origin (leg along -x, leg along +y) filleted with a
  // NEGATIVE radius: a concave scoop.  Its formula "-(fr)" resolves to a
  // negative value — which the recut used to skip, freezing the fillet while
  // every other dimension tracked the variable.
  const flippedFilletSketch = () => {
    const arc = buildBevelArc(
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: -0.9, y: 0 },
      { x: 0, y: 0.9 },
      true,
    );
    return {
      id: 55,
      type: "sketch",
      name: "F",
      children: [],
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      shapes: [
        { type: "line", x1: -4, y1: 0, x2: -0.9, y2: 0 },
        { type: "line", x1: 0, y1: 0.9, x2: 0, y2: 4 },
        {
          ...arc,
          kind: "bevel",
          flip: true,
          bevelData: {
            aIdx: 0,
            aKey: "end",
            bIdx: 1,
            bKey: "start",
            dist: 0.9,
            flip: true,
          },
          distanceFormula: "-(fr)",
        },
      ],
      constraints: [],
    };
  };

  beforeEach(() => {
    useStore.setState({
      items: [flippedFilletSketch()],
      history: [],
      activeHistoryId: null,
      variables: [{ name: "fr", formula: "9" }],
    });
  });

  it("re-cuts a minus fillet to the new size and keeps it flipped", () => {
    // fr 9 -> 12 mm: the concave fillet radius grows 0.9 -> 1.2 units.
    useStore.getState().setVariables([{ name: "fr", formula: "12" }]);
    const b = useStore.getState().items[0].shapes[2];
    expect(b.r).toBeCloseTo(1.2, 4);
    expect(!!(b.bevelData?.flip || b.flip)).toBe(true);
    expect(b.distanceFormula).toBe("-(fr)");
    // The legs were re-trimmed to the larger scoop.
    expect(useStore.getState().items[0].shapes[0].x2).toBeCloseTo(-1.2, 4);
  });

  it("leaves the minus fillet untouched when its value is unchanged", () => {
    useStore.getState().setVariables([{ name: "fr", formula: "9" }]);
    const b = useStore.getState().items[0].shapes[2];
    expect(b.r).toBeCloseTo(0.9, 6);
    expect(!!(b.bevelData?.flip || b.flip)).toBe(true);
  });
});
