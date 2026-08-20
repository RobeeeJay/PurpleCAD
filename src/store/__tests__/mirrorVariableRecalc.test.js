// A variable change re-solves a sketch's sources, so its MIRROR (and circular /
// rectangular) copies must be re-derived too — else the copies stay at their
// old positions, breaking the closed loops downstream extrudes depend on.  Uses
// the real store: setVariables spans slices and variablesSlice can't be
// imported standalone (module cycle through geometryParams).
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";
import { mirrorShapeGeometry } from "../../three/sketchMirror.js";

// Y-axis mirror line (0), a horizontal source line whose length is driven by
// the variable W (1), and its mirror copy across the Y axis (2).
const mirrorSketch = () => ({
  id: 42,
  type: "sketch",
  name: "M",
  children: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes: [
    { type: "line", x1: 0, y1: -5, x2: 0, y2: 5 },
    { type: "line", x1: 0, y1: 2, x2: 3, y2: 2 },
    { type: "line", x1: 0, y1: 2, x2: -3, y2: 2 },
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
    { type: "mirror", shapeIdx: 2, origIdx: 1, lineIdx: 0 },
  ],
});

describe("variable change re-derives mirror geometry", () => {
  beforeEach(() => {
    useStore.setState({
      items: [mirrorSketch()],
      history: [],
      activeHistoryId: null,
      variables: [{ name: "W", formula: "3" }],
      selectedId: 42,
    });
  });

  it("moving the source via a variable moves the mirror copy with it", () => {
    const before = { ...useStore.getState().items[0].shapes[2] };
    useStore.getState().setVariables([{ name: "W", formula: "80" }]);
    const sk = useStore.getState().items[0];
    const [axis, source, copy] = sk.shapes;
    // The source really moved (a distance formula of 80 mm = 8 units drove it).
    expect(
      Math.hypot(source.x2 - source.x1, source.y2 - source.y1),
    ).toBeCloseTo(8, 4);
    // The mirror copy was RE-DERIVED from the moved source + axis, not left at
    // its stale position: it equals the live reflection, and it changed.
    const expected = mirrorShapeGeometry(source, axis);
    expect(copy.x1).toBeCloseTo(expected.x1, 6);
    expect(copy.y1).toBeCloseTo(expected.y1, 6);
    expect(copy.x2).toBeCloseTo(expected.x2, 6);
    expect(copy.y2).toBeCloseTo(expected.y2, 6);
    expect(
      Math.hypot(copy.x2 - before.x2, copy.y2 - before.y2),
    ).toBeGreaterThan(0.5);
  });
});
