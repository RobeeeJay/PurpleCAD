// A 3D pattern must be usable as an input to a boolean.
//
// It could not be: buildItemShapeLocal had no branch for a `pattern3d`
// regenerator, so it returned null and the pattern contributed NOTHING to the
// fuse -- the body came back unchanged, with no error raised anywhere. Adding
// the pattern to the imported-mesh sew path was not enough either: that shell's
// face count is its triangle count, so a ring of eight small solids was refused
// outright ("too many curved faces") and, when it was not refused, the fuse had
// not finished after five minutes. The pattern is rebuilt from its recipe
// instead, which keeps a handful of faces per copy.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { ensureOcc } from "../init.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

let ops;
beforeAll(async () => {
  await ensureOcc();
  ({ ops } = await import("../../occOps.js"));
}, 60000);

const at = (x, y, z) => ({ x, y, z });

const post = {
  id: 1,
  type: "cylinder",
  name: "Post",
  position: at(0, 2, 0),
  rotation: at(0, 0, 0),
  scale: at(1, 1, 1),
  dimensions: { radius: 0.5, height: 4 },
};

// One knob standing off the post, at radius 1.
const knob = {
  id: 2,
  type: "sphere",
  name: "Knob",
  position: at(1, 3.5, 0),
  rotation: at(0, 0, 0),
  scale: at(1, 1, 1),
  dimensions: { radius: 0.3 },
};

const widthOf = (result) => {
  const p = result.geometryData.positions;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    lo = Math.min(lo, p[i] + result.position.x);
    hi = Math.max(hi, p[i] + result.position.x);
  }
  return hi - lo;
};

describe("a 3D pattern as a boolean input", () => {
  it("contributes its copies to a union", async () => {
    const items = [post, knob];
    const ringResult = await ops.pattern3dItem({
      patternType: "circular",
      sourceId: 2,
      params: {
        origin: at(0, 0, 0),
        axis: at(0, 1, 0),
        count: 4,
        angleRad: 2 * Math.PI,
        axialOffset: 0,
      },
      allItems: items,
      printPrecision: 0.1,
    });
    const ring = {
      id: 3,
      type: "csg",
      name: "Ring",
      position: ringResult.position,
      rotation: at(0, 0, 0),
      scale: at(1, 1, 1),
      geometryData: ringResult.geometryData,
      regenerator: {
        kind: "pattern3d",
        patternType: "circular",
        sourceId: 2,
        axisOrigin: at(0, 0, 0),
        axisDir: at(0, 1, 0),
        count: 4,
        angleRad: 2 * Math.PI,
        axialOffset: 0,
        centerOffset: ringResult.centerOffset,
        regeneratedAt: 0.1,
      },
    };

    // The pattern holds the COPIES; the object it was made from stays its own
    // item, so a coronet is the ring plus the original -- which is how the app
    // presents it after Confirm.
    const fused = await ops.performCsg({
      selectedItems: [post, knob, ring],
      operation: "union",
      printPrecision: 0.1,
      allItems: [...items, ring],
    });
    expect(fused, "the fuse produced nothing").toBeTruthy();

    // Knobs at radius 1 with a 0.3 radius reach 1.3 from the axis, so all four
    // together span about 2.6. With the pattern dropped only the original knob
    // survives and the result spans 1.8 -- the post's far side to that one
    // knob.
    const width = widthOf(fused);
    expect(width, `fused width ${width.toFixed(2)}`).toBeGreaterThan(2.4);
  }, 120000);
});
