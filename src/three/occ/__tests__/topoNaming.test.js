// Phase B (persistent topological naming), increment 1: an extrude's faces are
// named by creation provenance (top/bottom/side{i} keyed to the profile edge
// order), and a name resolves to the SAME face after a dimension change — the
// resolved point moves with the geometry, the name does not.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { ensureOcc } from "../init.js";

let occ;
beforeAll(async () => {
  await ensureOcc();
  occ = createRequire(import.meta.url)(
    "../../../../native/occ-addon/build/Release/occ_addon.node",
  );
}, 60000);

// CCW square of half-size h, centroid at origin.  Edge 0 is the -Y face.
const square = (h) => new Float64Array([-h, -h, h, -h, h, h, -h, h]);

describe("extrude persistent face names", () => {
  it("labels top/bottom/side faces", () => {
    const id = occ.makeExtrude(square(1), [], 0, 0, 2);
    const names = occ.faceNames(id);
    expect(names).toEqual(
      expect.arrayContaining(["top", "bottom", "side0", "side1", "side2", "side3"]),
    );
    occ.releaseShape(id);
  });

  it("a name resolves to the same face after the profile is resized", () => {
    const small = occ.makeExtrude(square(1), [], 0, 0, 2);
    const big = occ.makeExtrude(square(3), [], 0, 0, 2);

    // Top cap: still at z = depth on both, independent of profile size.
    expect(occ.namedFacePoint(small, "top")[2]).toBeCloseTo(2, 6);
    expect(occ.namedFacePoint(big, "top")[2]).toBeCloseTo(2, 6);

    // side0 = the -Y face: its name is stable, but the point tracks the resize
    // (y ≈ -1 small, ≈ -3 big) — proving the name followed the geometry.
    const s0 = occ.namedFacePoint(small, "side0");
    const b0 = occ.namedFacePoint(big, "side0");
    expect(s0[1]).toBeCloseTo(-1, 6);
    expect(b0[1]).toBeCloseTo(-3, 6);

    occ.releaseShape(small);
    occ.releaseShape(big);
  });
});
