// withLivePolygons must re-derive the embedded prism profiles of a FUSED
// extrude (extrudeUnion / extrudeCut), not just a chamfer's nested `source`.
// When such a body is a HOST/input (e.g. an extrude cut's target) the Electron
// bridge rebuilds it from these defs' baked polygon2D — so if they aren't
// re-derived at the current precision the host reverts to the resolution the
// polygons were frozen at, while the same body shown standalone (whose defs
// ARE re-derived per-def) is finer.  That's the "cut reverts to low-res curves"
// bug.
import { describe, it, expect } from "vitest";
import { withLivePolygons } from "../csgUtils.js";

// A sketch with a single circle — its tessellation density tracks precision.
const sketch = () => ({
  id: 9,
  type: "sketch",
  shapes: [{ type: "circle", cx: 0, cy: 0, r: 2 }],
  constraints: [],
});

// A fused extrudeUnion whose one prism references that circle, carrying a
// deliberately COARSE frozen polygon2D (as a saved document would).
const fused = () => ({
  id: 20,
  type: "csg",
  regenerator: {
    kind: "extrudeUnion",
    inputIds: [],
    extrudeDefs: [
      {
        id: 21,
        type: "extrude",
        depth: "10",
        profile: {
          type: "sketchLoop",
          sketchId: 9,
          profileCentroid: { x: 0, y: 0 },
          polygon2D: Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return { x: Math.cos(a) * 2, y: Math.sin(a) * 2 };
          }),
          holes: [],
        },
      },
    ],
  },
});

describe("withLivePolygons re-derives a fused body's embedded prisms", () => {
  it("refines the prism polygon2D at a finer precision", () => {
    const all = [sketch(), fused()];
    const coarse = withLivePolygons(fused(), all, 0.5);
    const fine = withLivePolygons(fused(), all, 0.01);
    const nCoarse = coarse.regenerator.extrudeDefs[0].profile.polygon2D.length;
    const nFine = fine.regenerator.extrudeDefs[0].profile.polygon2D.length;
    // Both were re-derived from the live circle (not left at the frozen 8), and
    // the finer precision has strictly more points.
    expect(nFine).toBeGreaterThan(nCoarse);
    expect(nFine).toBeGreaterThan(8);
  });

  it("returns the same reference when there's nothing to re-derive", () => {
    // A csg with no source and no extrudeDefs (e.g. a plain boolean by id) is
    // untouched — the guard must not clone every item.
    const plain = {
      id: 5,
      type: "csg",
      regenerator: { kind: "boolean", op: "union", inputIds: [1, 2] },
    };
    expect(withLivePolygons(plain, [], 0.1)).toBe(plain);
  });
});
