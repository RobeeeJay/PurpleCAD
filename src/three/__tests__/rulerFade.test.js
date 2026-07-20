// Ground-ruler legibility fade: when a row of world-fixed numbers is viewed
// nearly edge-on (the camera looking almost straight down its own axis — which
// happens continuously while orbiting), the evenly-spaced world points compress
// toward the vanishing point in screen space. Because each label is scaled to
// stay a CONSTANT on-screen size regardless of distance, that compression made
// neighbouring numbers overlap into an illegible garbled cluster — visible as
// "the ruler numbers jump around" while rotating. ndcGapPx/rulerFadeOpacity
// measure the real on-screen gap to the next grid step and fade a label out
// before it can overlap, rather than trying to reposition anything (the
// positions themselves are already world-stable and correct).
import { describe, it, expect } from "vitest";
import {
  ndcGapPx,
  rulerFadeOpacity,
  RULER_FADE_MIN_GAP_PX,
  RULER_FADE_RANGE_PX,
} from "../sceneSetup.js";

describe("ndcGapPx", () => {
  it("converts an NDC delta to a screen-pixel distance", () => {
    // NDC spans [-1, 1] each axis; a delta of 2 (full width) = canvasW px.
    const a = { x: -1, y: 0 };
    const b = { x: 1, y: 0 };
    expect(ndcGapPx(a, b, 800, 600)).toBeCloseTo(800, 6);
  });
  it("combines x and y deltas as a Euclidean pixel distance", () => {
    // NDC delta (1,1) over a 800x600 canvas -> pixel delta (400,300) -> 500.
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 1 };
    expect(ndcGapPx(a, b, 800, 600)).toBeCloseTo(500, 6);
  });
  it("is zero when two points project to the same NDC (fully compressed)", () => {
    const a = { x: 0.3, y: -0.2 };
    expect(ndcGapPx(a, { ...a }, 1000, 1000)).toBe(0);
  });
});

describe("rulerFadeOpacity", () => {
  it("is fully opaque well above the legibility floor", () => {
    expect(rulerFadeOpacity(RULER_FADE_MIN_GAP_PX + RULER_FADE_RANGE_PX)).toBe(
      1,
    );
    expect(rulerFadeOpacity(1000)).toBe(1);
  });
  it("is fully transparent at or below the minimum gap (would overlap)", () => {
    expect(rulerFadeOpacity(RULER_FADE_MIN_GAP_PX)).toBe(0);
    expect(rulerFadeOpacity(0)).toBe(0);
    // Regression: the pre-fix code rendered a label at FULL opacity regardless
    // of crowding — a near-zero gap must fade to fully invisible, not stay at 1.
    expect(rulerFadeOpacity(2)).toBe(0);
  });
  it("fades smoothly (monotonically) across the transition band", () => {
    const mid = rulerFadeOpacity(
      RULER_FADE_MIN_GAP_PX + RULER_FADE_RANGE_PX / 2,
    );
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.5, 6);
  });
});
