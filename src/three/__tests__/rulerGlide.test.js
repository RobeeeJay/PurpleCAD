// The ground ruler is centred on the camera's orbit target every frame.  Most
// of the time the target moves continuously (panning) or not at all (pure
// rotation), so the ruler should track it 1:1 with no added lag. But
// navigation.js's orbit-anchor recentre (setOrbitAnchor, fired on the FIRST
// tick of a new Shift+scroll session) reassigns the target INSTANTLY, in one
// frame, to wherever the screen-centre ray hits — the model's surface once
// "Home" has framed it, i.e. on essentially every rotate right after
// resetting the view. Measured directly against test-files/bad-cut-extrude.pcad:
// loading it, clicking Home, then the first Shift+scroll tick snapped the
// target from (0.42, -1.20) to (2.62, 1.00) in a single frame — read as "the
// rulers instantly jump". stepRulerGlide detects that kind of abrupt jump and
// eases the ruler's tracked centre to the new target over a short tween
// instead of teleporting with it.
import { describe, it, expect } from "vitest";
import { stepRulerGlide, RULER_GLIDE_MS } from "../sceneSetup.js";

const initialState = () => ({
  lastRealX: null,
  lastRealZ: null,
  trackedX: 0,
  trackedZ: 0,
  glide: null,
});

describe("stepRulerGlide", () => {
  it("snaps to the real target on the very first frame (nothing to glide from)", () => {
    const s = stepRulerGlide(initialState(), 5, -3, 10, 1000);
    expect(s.trackedX).toBe(5);
    expect(s.trackedZ).toBe(-3);
    expect(s.glide).toBe(null);
  });

  it("follows a small continuous delta (ordinary pan) with NO added lag", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 10, 1000);
    // A modest per-frame pan step, well under the jump threshold.
    s = stepRulerGlide(s, 0.3, 0.1, 10, 1016);
    expect(s.trackedX).toBe(0.3);
    expect(s.trackedZ).toBe(0.1);
    expect(s.glide).toBe(null);
  });

  it("does not glide during a pure rotation (target unchanged frame to frame)", () => {
    let s = stepRulerGlide(initialState(), 5, 5, 8, 1000);
    for (let i = 1; i <= 10; i++) {
      s = stepRulerGlide(s, 5, 5, 8, 1000 + i * 16);
    }
    expect(s.trackedX).toBe(5);
    expect(s.trackedZ).toBe(5);
    expect(s.glide).toBe(null);
  });

  it("glides (does not teleport) through the measured real-world jump", () => {
    // The exact numbers logged for bad-cut-extrude.pcad: target sat at
    // (0.42, 2.56) after Home, then the orbit-anchor recentre snapped it to
    // (2.62, 4.76) on the very next frame.
    let s = stepRulerGlide(initialState(), 0.4243, 2.5592, 6, 1000);
    s = stepRulerGlide(s, 2.6227, 4.7576, 6, 1016); // the jump detected here
    // The tracked centre must NOT have snapped straight to the new target —
    // that's the exact bug (an instant reflow of the whole ruler window).
    // The glide starts AT this frame (progress 0), so it still reads the OLD
    // value right here...
    expect(s.trackedX).toBeCloseTo(0.4243, 6);
    expect(s.glide).not.toBe(null);
    // ...but the very next frame (target holding at its new value, as it does
    // for the rest of a pure rotation) shows real progress toward it.
    s = stepRulerGlide(s, 2.6227, 4.7576, 6, 1032);
    expect(s.trackedX).toBeGreaterThan(0.4243);
    expect(s.trackedX).toBeLessThan(2.6227);
    expect(s.trackedZ).toBeGreaterThan(2.5592);
    expect(s.trackedZ).toBeLessThan(4.7576);
  });

  it("converges to the real target once the glide finishes, then tracks exactly", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 10, 6, 1016); // triggers the glide
    // Advance well past RULER_GLIDE_MS while the target holds still (a pure
    // rotation continuing after the anchor snap).
    for (let t = 32; t <= RULER_GLIDE_MS + 100; t += 16) {
      s = stepRulerGlide(s, 10, 10, 6, 1000 + t);
    }
    expect(s.glide).toBe(null);
    expect(s.trackedX).toBeCloseTo(10, 6);
    expect(s.trackedZ).toBeCloseTo(10, 6);
  });

  it("retargets an in-flight glide instead of snapping when it finishes", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 10, 6, 1016); // start gliding toward (10, 10)
    expect(s.glide).not.toBe(null);
    // A small continuous pan arrives mid-glide, moving the real target a bit
    // further — this must redirect the glide's endpoint, not restart a snap.
    s = stepRulerGlide(s, 10.2, 10.1, 6, 1032);
    expect(s.glide.toX).toBe(10.2);
    expect(s.glide.toZ).toBe(10.1);
  });

  it("progresses monotonically toward the target across the glide (no overshoot/jitter)", () => {
    let s = stepRulerGlide(initialState(), 0, 0, 6, 1000);
    s = stepRulerGlide(s, 10, 0, 6, 1016);
    let prev = s.trackedX;
    for (let t = 32; t <= RULER_GLIDE_MS; t += 16) {
      s = stepRulerGlide(s, 10, 0, 6, 1000 + t);
      expect(s.trackedX).toBeGreaterThanOrEqual(prev);
      expect(s.trackedX).toBeLessThanOrEqual(10 + 1e-9);
      prev = s.trackedX;
    }
  });
});
