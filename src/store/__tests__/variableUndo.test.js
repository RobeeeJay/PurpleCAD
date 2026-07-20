// A variable change is a single undo step: undo restores the previous variable
// values AND the sketch geometry that was recalculated against them; redo
// re-applies both.  Uses the real store (setVariables spans slices).
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";

// A sketch whose one horizontal line's length is driven by the variable W.
const sketch = () => ({
  id: 7,
  type: "sketch",
  name: "S",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [
    { type: "line", x1: 0, y1: -5, x2: 0, y2: 5 },
    { type: "line", x1: 0, y1: 0, x2: 3, y2: 0 },
  ],
  constraints: [
    { type: "onLine", pointShapeIdx: 1, pointKey: "start", lineShapeIdx: 0 },
    { type: "horizontal", shapeIdx: 1 },
    {
      type: "distance",
      shapeAIdx: 1,
      pointA: "start",
      shapeBIdx: 1,
      pointB: "end",
      distance: "W",
    },
  ],
});

describe("variable change is undoable", () => {
  beforeEach(() => {
    useStore.setState({
      items: [sketch()],
      history: [
        {
          id: 0,
          label: "Scene created",
          instruction: { type: "scene_created" },
        },
        {
          id: 1,
          label: "Added",
          itemId: 7,
          instruction: { type: "create", item: sketch() },
        },
      ],
      activeHistoryId: null,
      variables: [{ name: "W", formula: "30" }],
      undoStack: [],
      redoStack: [],
      selectedId: 7,
    });
  });

  it("undo restores the old variables and geometry; redo re-applies", () => {
    const len = () => {
      const s = useStore.getState().items[0].shapes[1];
      return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    };
    // 30 mm = 3 units baseline.
    expect(len()).toBeCloseTo(3, 4);
    const undoBefore = useStore.getState().undoStack.length;

    useStore.getState().setVariables([{ name: "W", formula: "80" }]);
    expect(useStore.getState().variables[0].formula).toBe("80");
    expect(len()).toBeCloseTo(8, 4);
    // Exactly one undo step was pushed.
    expect(useStore.getState().undoStack.length).toBe(undoBefore + 1);

    useStore.getState().undo();
    expect(useStore.getState().variables[0].formula).toBe("30");
    expect(len()).toBeCloseTo(3, 4);

    useStore.getState().redo();
    expect(useStore.getState().variables[0].formula).toBe("80");
    expect(len()).toBeCloseTo(8, 4);
  });
});
