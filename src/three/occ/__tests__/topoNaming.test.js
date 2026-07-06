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

  it("selects a face by name alone (no coordinates) for a chamfer", () => {
    const triCount = (id) => {
      const t = occ.tessellate(id, 0.1);
      return t.indices.length / 3;
    };
    const base = occ.makeExtrude(square(1), [], 0, 0, 2);
    const baseTris = triCount(base);

    // Name only — no nx/ny/nz, no cx/cy/cz.  Coordinate/normal matching can't
    // resolve this (zero normal matches nothing); the persistent name does.
    const named = occ.chamferShape(
      base,
      { edges: [], faces: [{ name: "top" }] },
      0.1,
      null,
    );
    expect(triCount(named)).toBeGreaterThan(baseTris); // top edges bevelled

    // Same spec without the name resolves nothing → 0 sentinel (no match).
    const unnamed = occ.chamferShape(base, { edges: [], faces: [{}] }, 0.1, null);
    expect(unnamed).toBe(0);

    occ.releaseShape(base);
    occ.releaseShape(named);
  });

  it("enrichSubGeo stamps the persistent name onto a picked face", () => {
    const id = occ.makeExtrude(square(1), [], 0, 0, 2);
    // A pick on the top cap (hit point at z=2, +Z normal).
    const enriched = occ.enrichSubGeo(id, {
      edges: [],
      faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 2 }],
    });
    expect(enriched.faces[0].name).toBe("top");

    // A pick on the -Y side wall → side edge 0.
    const side = occ.enrichSubGeo(id, {
      edges: [],
      faces: [{ nx: 0, ny: -1, nz: 0, cx: 0, cy: -1, cz: 1 }],
    });
    expect(side.faces[0].name).toBe("side0");

    occ.releaseShape(id);
  });

  it("propagates names through a chamfer (chamfer-on-chamfer by name)", () => {
    const base = occ.makeExtrude(square(1), [], 0, 0, 2);
    // Chamfer the top by name; the bottom face is untouched → keeps its name.
    const c1 = occ.chamferShape(
      base,
      { edges: [], faces: [{ name: "top" }] },
      0.1,
      null,
    );
    expect(occ.faceNames(c1)).toEqual(expect.arrayContaining(["bottom"]));
    // A second chamfer resolves "bottom" by name on the chamfered body.
    const c2 = occ.chamferShape(
      c1,
      { edges: [], faces: [{ name: "bottom" }] },
      0.1,
      null,
    );
    const tri = (id) => occ.tessellate(id, 0.1).indices.length / 3;
    expect(tri(c2)).toBeGreaterThan(tri(c1)); // bottom edges bevelled too

    occ.releaseShape(base);
    occ.releaseShape(c1);
    occ.releaseShape(c2);
  });

  it("carries names through a transform (position + scale)", () => {
    const id = occ.makeExtrude(square(1), [], 0, 0, 2);
    const moved = occ.transformShape(id, 0, 0, 5, 0, 0, 0); // +5 in z
    expect(occ.faceNames(moved)).toEqual(expect.arrayContaining(["top", "side0"]));
    // top cap was at z=2 → now z=7.
    expect(occ.namedFacePoint(moved, "top")[2]).toBeCloseTo(7, 6);

    const scaled = occ.scaleShape(id, 2);
    expect(occ.faceNames(scaled)).toEqual(expect.arrayContaining(["top"]));
    expect(occ.namedFacePoint(scaled, "top")[2]).toBeCloseTo(4, 6); // 2*2

    occ.releaseShape(id);
    occ.releaseShape(moved);
    occ.releaseShape(scaled);
  });

  it("names primitive faces by axis (box) and lateral surface (cylinder)", () => {
    const box = occ.makeBox(-1, -1, -1, 1, 1, 1);
    expect(occ.faceNames(box)).toEqual(
      expect.arrayContaining(["+x", "-x", "+y", "-y", "+z", "-z"]),
    );
    // Chamfer the +z face by name alone.
    const tri = (id) => occ.tessellate(id, 0.1).indices.length / 3;
    const baseTris = tri(box);
    const ch = occ.chamferShape(box, { edges: [], faces: [{ name: "+z" }] }, 0.1, null);
    expect(tri(ch)).toBeGreaterThan(baseTris);

    const cyl = occ.makeCylinder(-1, 1, 2);
    const cn = occ.faceNames(cyl);
    expect(cn).toContain("side"); // lateral surface
    expect(cn).toEqual(expect.arrayContaining(["+y", "-y"])); // caps

    occ.releaseShape(box);
    occ.releaseShape(ch);
    occ.releaseShape(cyl);
  });
});
