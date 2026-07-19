// Pure helpers of the chamfer commit pipeline: frame shifting of selections,
// the preview-reuse cache key, and the result transform that anchors a
// bbox-centred result to its source's brush position.
import { describe, it, expect } from "vitest";
import {
  shiftSelectionToSource,
  chamferPreviewKey,
  stashChamferPreview,
  takeChamferPreview,
  chamferResultTransform,
} from "../cameraControls/chamferCommit.js";

describe("shiftSelectionToSource", () => {
  it("translates edges and faces by the centre offset; ids untouched", () => {
    const sel = {
      edges: [{ ax: 0, ay: 1, az: 2, bx: 3, by: 4, bz: 5, n: "keep" }],
      faces: [{ nx: 0, ny: 1, nz: 0, cx: 1, cy: 2, cz: 3 }],
    };
    const out = shiftSelectionToSource(sel, { cx: 10, cy: 20, cz: 30 });
    expect(out.edges[0]).toMatchObject({
      ax: 10,
      ay: 21,
      az: 32,
      bx: 13,
      by: 24,
      bz: 35,
      n: "keep",
    });
    expect(out.faces[0]).toMatchObject({
      cx: 11,
      cy: 22,
      cz: 33,
      nx: 0,
      ny: 1,
      nz: 0,
    });
  });

  it("a face with no centre point passes through unchanged", () => {
    const f = { nx: 1, ny: 0, nz: 0 };
    expect(
      shiftSelectionToSource({ faces: [f] }, { cx: 5, cy: 5, cz: 5 }).faces[0],
    ).toBe(f);
  });

  it("null offset is a no-op shift", () => {
    const out = shiftSelectionToSource(
      { edges: [{ ax: 1, ay: 1, az: 1, bx: 2, by: 2, bz: 2 }] },
      null,
    );
    expect(out.edges[0].ax).toBe(1);
  });
});

describe("chamfer preview cache", () => {
  const recipe = {
    source: {
      id: 5,
      position: { x: 0, y: 0, z: 0 },
      rotation: null,
      scale: null,
    },
    subGeo: { edges: [1], faces: [] },
    amount: 0.3,
    angleRad: null,
    segments: 1,
    printPrecision: 0.1,
  };

  it("take returns the stash only for an identical key, and consumes it", () => {
    const key = chamferPreviewKey(recipe);
    stashChamferPreview(key, { hit: true });
    expect(takeChamferPreview(key)).toEqual({ hit: true });
    expect(takeChamferPreview(key)).toBe(null); // consumed

    stashChamferPreview(chamferPreviewKey(recipe), { hit: true });
    const other = chamferPreviewKey({ ...recipe, amount: 0.4 });
    expect(takeChamferPreview(other)).toBe(null); // mismatch consumes too
  });

  it("key changes when any geometry-relevant input changes", () => {
    const base = chamferPreviewKey(recipe);
    expect(chamferPreviewKey({ ...recipe, segments: 3 })).not.toBe(base);
    expect(chamferPreviewKey({ ...recipe, printPrecision: 0.01 })).not.toBe(
      base,
    );
    expect(
      chamferPreviewKey({
        ...recipe,
        source: { ...recipe.source, position: { x: 1, y: 0, z: 0 } },
      }),
    ).not.toBe(base);
  });
});

describe("chamferResultTransform", () => {
  it("adds the rotated centre offset to the source brush position", () => {
    const source = {
      type: "cube",
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const { position, basePos, rotation } = chamferResultTransform(source, {
      cx: 1,
      cy: 0,
      cz: 0,
    });
    // +90° about Y maps local +x to world -z... (three.js Euler convention:
    // x' = z·sin + x·cos). Local (1,0,0) → world (0,0,-1).
    expect(position.x).toBeCloseTo(basePos.x + 0, 6);
    expect(position.z).toBeCloseTo(basePos.z - 1, 6);
    expect(rotation).toEqual(source.rotation);
    // basePos is the source brush point alone (re-anchor key — see the
    // resolveChainedPosition landmine).
    expect(basePos.y).toBeCloseTo(2, 6);
  });
});
