// Topological-naming regression: a chamfer/fillet selection must survive a
// parametric resize.  Selections are stored as absolute coordinates, which a
// resize moves off the shape; enrichSubGeo resolves each edge's adjacent face
// normals (resize-invariant) at creation, and the native matcher prefers them
// on later regens.  These tests drive the native addon directly (the same
// backend occOps.js and the Electron bridge use) so they assert the exact
// behaviour the app relies on.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const occ = require("../../../../native/occ-addon/build/Release/occ_addon.node");

describe("chamfer selection survives a resize", () => {
  it("re-matches an edge by adjacent-face normals after the box grows", () => {
    // Small box: the top edge along X at y=1,z=1 borders the +Y and +Z faces.
    const small = occ.makeBox(-1, -1, -1, 1, 1, 1);
    const coordSubGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    const enriched = occ.enrichSubGeo(small, coordSubGeo);
    // enrichSubGeo resolved the two adjacent face normals (+Y, +Z).
    expect(enriched.edges[0].n1).toBeTruthy();
    expect(enriched.edges[0].n2).toBeTruthy();

    // Same topological edge, but resized to y=2,z=2.
    const big = occ.makeBox(-2, -2, -2, 2, 2, 2);
    // The stale endpoint coordinates no longer lie on the resized box, so the
    // legacy coordinate match finds nothing (0 = "no edge matched").
    expect(occ.chamferShape(big, coordSubGeo, 0.2, null)).toBe(0);
    // The adjacent-face normals are resize-invariant, so the enriched
    // selection still matches and chamfers.
    const byNormals = occ.chamferShape(big, enriched, 0.2, null);
    expect(byNormals).not.toBe(0);
    const tess = occ.tessellate(byNormals, 0.5);
    expect(tess.indices.length).toBeGreaterThan(0);
  });

  it("matches a face by normal after a resize (centroid only breaks ties)", () => {
    // +Z top face, centroid stored at the small size (0,0,1).
    const faceSubGeo = {
      edges: [],
      faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 }],
    };
    // Grow the box so the top face centroid moves to z=3 — far beyond the old
    // 0.05 centroid cutoff.  Normal-primary matching still finds it.
    const big = occ.makeBox(-3, -3, -3, 3, 3, 3);
    const r = occ.chamferShape(big, faceSubGeo, 0.2, null);
    expect(r).not.toBe(0);
  });

  it("leaves a coordinate-only selection on the matching shape intact", () => {
    // A legacy selection (no normals) still works when the shape has NOT been
    // resized — enrichSubGeo is opportunistic, never destructive.
    const box = occ.makeBox(-1, -1, -1, 1, 1, 1);
    const coordSubGeo = {
      edges: [{ ax: -1, ay: 1, az: 1, bx: 1, by: 1, bz: 1 }],
      faces: [],
    };
    expect(occ.chamferShape(box, coordSubGeo, 0.2, null)).not.toBe(0);
  });
});
