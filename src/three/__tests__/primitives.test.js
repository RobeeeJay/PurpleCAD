// Parametric primitives: the OCC shape is built at the item's `dimensions`.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../occ/init.js";
import { buildItemShapeLocal } from "../occOps.js";

const occ = createRequire(import.meta.url)(
  "../../../native/occ-addon/build/Release/occ_addon.node",
);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const bbox = (type, dimensions) => {
  const item = {
    id: 1,
    type,
    position: O,
    rotation: O,
    scale: S,
    dimensions,
  };
  const id = buildItemShapeLocal(item, [item], 0.1);
  const t = occ.tessellate(id, 0.05);
  const p = t.positions;
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], p[i + k]);
      mx[k] = Math.max(mx[k], p[i + k]);
    }
  occ.releaseShape(id);
  return { w: mx[0] - mn[0], h: mx[1] - mn[1], d: mx[2] - mn[2] };
};

describe("parametric primitives", () => {
  it("box uses width/height/depth", () => {
    const b = bbox("cube", { width: 4, height: 2, depth: 6 });
    expect(b.w).toBeCloseTo(4, 1);
    expect(b.h).toBeCloseTo(2, 1);
    expect(b.d).toBeCloseTo(6, 1);
  });
  it("sphere uses radius (diameter bbox)", () => {
    const b = bbox("sphere", { radius: 3 });
    expect(b.w).toBeCloseTo(6, 1);
    expect(b.h).toBeCloseTo(6, 1);
  });
  it("cylinder uses radius + height (Y axis)", () => {
    const b = bbox("cylinder", { radius: 2, height: 5 });
    expect(b.w).toBeCloseTo(4, 1); // diameter
    expect(b.h).toBeCloseTo(5, 1); // height along Y
  });
  it("torus uses major + minor", () => {
    const b = bbox("torus", { major: 3, minor: 0.5 });
    expect(b.w).toBeCloseTo(2 * (3 + 0.5), 1); // outer diameter
    expect(b.h).toBeCloseTo(2 * 0.5, 1); // axial thickness
  });
  it("a legacy primitive with no dimensions keeps its default size", () => {
    const b = bbox("sphere", undefined);
    expect(b.w).toBeCloseTo(3, 1); // radius 1.5 → diameter 3
  });
});
