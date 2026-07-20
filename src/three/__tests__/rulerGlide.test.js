// The ground ruler is centred on the camera's orbit target every frame, and
// viewHeight (tier show/hide, span, per-label scale — everything derived from
// cam.position.distanceTo(target)) is computed from that same target. Most of
// the time the target moves continuously (panning) or not at all (pure
// rotation), so everything should follow it 1:1 with no added lag. But
// navigation.js's orbit-anchor recentre (setOrbitAnchor, fired on the FIRST
// tick of a new Shift+scroll session) reassigns the target INSTANTLY, in one
// frame, to wherever the screen-centre ray hits — the model's surface once
// "Home" has framed it, i.e. on essentially every rotate right after
// resetting the view.
//
// Measured directly against test-files/bad-cut-extrude.pcad: load -> Home ->
// first Shift+scroll tick snaps target (0.42,-1.20,2.56) -> (2.62,1.00,4.76)
// and camera-to-target distance 30.1 -> 26.3, i.e. viewHeight 18.998 -> 16.591
// — in ONE frame. A first version of this fix gated the glide purely on
// position delta (25% of viewHeight); that measured ~3.8-unit position jump
// slipped UNDER that threshold (it looked "small" relative to a ~19-unit
// view) even though the 12.7% viewHeight swing straddles the fine tier's hard
// `showBelow: 17` cliff with NO hysteresis, flipping 105 labels visible in
// that same frame — the ruler still "instantly jumped" via the tier flip
// even though its on-screen CENTRE was gliding correctly. stepRulerGlide now
// also watches viewHeight's own one-frame swing, which is what actually drove
// the tier flip.
import { describe, it, expect } from "vitest";
import { stepRulerGlide, RULER_GLIDE_MS } from "../sceneSetup.js";

const initialState = () => ({
  lastRealX: null,
  lastRealY: null,
  lastRealZ: null,
  lastViewHeight: null,
  trackedX: 0,
  trackedY: 0,
  trackedZ: 0,
  glide: null,
});

describe("stepRulerGlide", () => {
  it("snaps to the real target on the very first frame (nothing to glide from)", () => {
    const s = stepRulerGlide(initialState(), 5, 1, -3, 10, 1000);
    expect(s.trackedX).toBe(5);
    expect(s.trackedY).toBe(1);
    expect(s.trackedZ).toBe(-3);
    expect(s.glide).toBe(null);
  });

  it("follows a small continuous delta (ordinary pan) with NO added lag", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 0, 10, 1000);
    // A modest per-frame pan step, well under the jump threshold, at a
    // near-identical viewHeight (no zoom involved).
    s = stepRulerGlide(s, 0.3, 0, 0.1, 10.01, 1016);
    expect(s.trackedX).toBe(0.3);
    expect(s.trackedZ).toBe(0.1);
    expect(s.glide).toBe(null);
  });

  it("does not glide during a pure rotation (target AND viewHeight unchanged frame to frame)", () => {
    let s = stepRulerGlide(initialState(), 5, 0, 5, 8, 1000);
    for (let i = 1; i <= 10; i++) {
      s = stepRulerGlide(s, 5, 0, 5, 8, 1000 + i * 16);
    }
    expect(s.trackedX).toBe(5);
    expect(s.trackedZ).toBe(5);
    expect(s.glide).toBe(null);
  });

  it("catches the measured real-world jump via the viewHeight swing (not just position)", () => {
    // The EXACT numbers logged for bad-cut-extrude.pcad.  The position delta
    // alone (~3.8 units against ~19 viewHeight) is small enough that a purely
    // position-based threshold missed it in an earlier version of this fix —
    // regression-testing the real values, not an artificially small
    // viewHeight, is the whole point of this case.
    let s = stepRulerGlide(
      initialState(),
      0.4243,
      -1.1984,
      2.5592,
      18.998,
      1000,
    );
    s = stepRulerGlide(s, 2.6227, 1.0, 4.7576, 16.591, 1016); // jump frame
    // The tracked point must NOT have snapped straight to the new target —
    // the glide starts AT this frame (progress 0), so it still reads the OLD
    // value right here...
    expect(s.trackedX).toBeCloseTo(0.4243, 6);
    expect(s.trackedY).toBeCloseTo(-1.1984, 6);
    expect(s.glide).not.toBe(null);
    // ...but the very next frame (target/viewHeight holding at their new
    // values, as they do for the rest of a pure rotation) shows real progress
    // toward it, on all three axes.
    s = stepRulerGlide(s, 2.6227, 1.0, 4.7576, 16.591, 1032);
    expect(s.trackedX).toBeGreaterThan(0.4243);
    expect(s.trackedX).toBeLessThan(2.6227);
    expect(s.trackedY).toBeGreaterThan(-1.1984);
    expect(s.trackedY).toBeLessThan(1.0);
    expect(s.trackedZ).toBeGreaterThan(2.5592);
    expect(s.trackedZ).toBeLessThan(4.7576);
  });

  it("converges to the real target once the glide finishes, then tracks exactly", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 5, 10, 6, 1016); // triggers the glide (position)
    for (let t = 32; t <= RULER_GLIDE_MS + 100; t += 16) {
      s = stepRulerGlide(s, 10, 5, 10, 6, 1000 + t);
    }
    expect(s.glide).toBe(null);
    expect(s.trackedX).toBeCloseTo(10, 6);
    expect(s.trackedY).toBeCloseTo(5, 6);
    expect(s.trackedZ).toBeCloseTo(10, 6);
  });

  it("retargets an in-flight glide instead of snapping when it finishes", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 0, 10, 6, 1016); // start gliding toward (10, 0, 10)
    expect(s.glide).not.toBe(null);
    // A small continuous pan arrives mid-glide — must redirect the glide's
    // endpoint, not restart a snap.
    s = stepRulerGlide(s, 10.2, 0, 10.1, 6, 1032);
    expect(s.glide.toX).toBe(10.2);
    expect(s.glide.toZ).toBe(10.1);
  });

  it("progresses monotonically toward the target across the glide (no overshoot/jitter)", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 0, 0, 6, 1016);
    let prev = s.trackedX;
    for (let t = 32; t <= RULER_GLIDE_MS; t += 16) {
      s = stepRulerGlide(s, 10, 0, 0, 6, 1000 + t);
      expect(s.trackedX).toBeGreaterThanOrEqual(prev);
      expect(s.trackedX).toBeLessThanOrEqual(10 + 1e-9);
      prev = s.trackedX;
    }
  });

  it("does not glide for an ordinary small viewHeight change (zoom) with no position jump", () => {
    let s = stepRulerGlide(initialState(), 5, 0, 5, 10, 1000);
    // A gentle zoom tick: viewHeight edges down 2%, position unchanged.
    s = stepRulerGlide(s, 5, 0, 5, 9.8, 1016);
    expect(s.glide).toBe(null);
    expect(s.trackedX).toBe(5);
  });
});
