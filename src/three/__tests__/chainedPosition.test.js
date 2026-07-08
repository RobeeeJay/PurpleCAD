// Regression: a chained op (chamfer/emboss/hole/…) must re-anchor to its LIVE
// source every recalc, so inserting/editing an upstream op can't leave the body
// pinned to a stale source ("insert a chamfer after a chamfer moves the body").
// resolveChainedPosition is the shared re-anchor: position = fresh source base +
// the user's preserved move-delta.

import { describe, it, expect, vi } from "vitest";

// regenerateItems pulls occClient (worker RPC); we only exercise the pure
// position helper, so the mock just needs to exist.
vi.mock("../occClient.js", () => ({
  chamferOrFilletItem: vi.fn(),
  pushPullFaces: vi.fn(),
  shellItem: vi.fn(),
  holeItem: vi.fn(),
  embossItem: vi.fn(),
  draftItem: vi.fn(),
  revolveItem: vi.fn(),
  pipeItem: vi.fn(),
  loftItem: vi.fn(),
  pattern3dItem: vi.fn(),
  performCsg: vi.fn(),
}));
vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

const { resolveChainedPosition } = await import("../regenerateItems.js");

// A non-extrude source's brush position is just its item.position.
const src = (p) => ({
  type: "csg",
  position: p,
  rotation: { x: 0, y: 0, z: 0 },
});
const CO0 = { cx: 0, cy: 0, cz: 0 };

describe("resolveChainedPosition", () => {
  it("keeps the current position when there is no stored base (legacy item)", () => {
    const r = resolveChainedPosition(
      src({ x: 1, y: 2, z: 3 }),
      CO0,
      { x: 5, y: 5, z: 5 },
      null,
    );
    expect(r.position).toEqual({ x: 5, y: 5, z: 5 });
    expect(r.base).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("re-anchors the user move-delta onto the new source base (the insert fix)", () => {
    // Old source base (10,0,0); the user moved the op +2 in x → currentPosition
    // (12,0,0).  The source is repointed to a body at (30,0,0): the op must
    // follow to (32,0,0), preserving the +2 delta.
    const r = resolveChainedPosition(
      src({ x: 30, y: 0, z: 0 }),
      CO0,
      { x: 12, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    );
    expect(r.position).toEqual({ x: 32, y: 0, z: 0 });
    expect(r.base).toEqual({ x: 30, y: 0, z: 0 });
  });

  it("follows the source exactly when the user never moved it (no residual)", () => {
    // currentPosition == storedBase (no user delta): the body tracks its source
    // and lands on the fresh base — this is exactly the case that used to shift.
    const r = resolveChainedPosition(
      src({ x: 30, y: 0, z: 0 }),
      CO0,
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    );
    expect(r.position).toEqual({ x: 30, y: 0, z: 0 });
  });

  it("does NOT move on a resolution toggle (same source, changed centre-offset)", () => {
    // Same source brush (10,0,0) with a +2 user move → currentPosition (12,0,0).
    // A re-tessellation nudges centerOffset, but the brush point is unchanged, so
    // the position must stay put — otherwise the object jitters on every toggle
    // (the reason the old code kept the position fixed on a resolution change).
    const r = resolveChainedPosition(
      src({ x: 10, y: 0, z: 0 }),
      { cx: 0.73, cy: 0, cz: 0 }, // different CO — must be ignored
      { x: 12, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    );
    expect(r.position).toEqual({ x: 12, y: 0, z: 0 });
  });

  it("anchors to the base when there is no current position (fresh rebuild)", () => {
    const r = resolveChainedPosition(
      src({ x: 4, y: 0, z: 0 }),
      { cx: 1, cy: 0, cz: 0 },
      null,
      { x: 99, y: 0, z: 0 },
    );
    expect(r.position).toEqual({ x: 5, y: 0, z: 0 }); // base = brush(4) + CO(1)
  });
});
