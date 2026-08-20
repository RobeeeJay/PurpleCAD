// Where the ruler's two rows CROSS is derived fresh, every frame, from the
// camera's OWN forward ray (through the centre of the VISIBLE 3D area)
// intersected with the ground plane — not from targetRef.current (the orbit
// pivot).  Earlier attempts centred the ruler on the pivot and tried to glide
// past the fact that navigation.js's orbit-anchor recentre (setOrbitAnchor,
// on the first tick of a new Shift+scroll session) reassigns that bookkeeping
// variable INSTANTLY, to wherever the screen-centre ray hits. That never
// fully closed the gap — a coarser rotation, or simply doing more of them,
// kept finding new ways to make the reassignment visible. The camera's actual
// forward ray has no such discontinuity: it only ever changes by exactly how
// much the input rotated it, every tick, with nothing hidden re-snapping
// underneath — so deriving the cross-point directly from it needs no
// smoothing at all.
import { describe, it, expect } from "vitest";
import { groundRayCrossing } from "../sceneSetup.js";

const initialState = () => ({ x: 0, z: 0, hit: true });

describe("groundRayCrossing", () => {
  it("finds where a straight-down ray hits the ground", () => {
    const s = groundRayCrossing(
      { x: 5, y: 10, z: -3 },
      { x: 0, y: -1, z: 0 },
      initialState(),
    );
    expect(s.hit).toBe(true);
    expect(s.x).toBeCloseTo(5, 6);
    expect(s.z).toBeCloseTo(-3, 6);
  });

  it("finds where an angled ray hits the ground", () => {
    // Camera at (0, 10, 0) looking down and forward at 45°: direction
    // (0, -1, 1) normalized. Should hit the ground 10 units along +Z.
    const s = groundRayCrossing(
      { x: 0, y: 10, z: 0 },
      { x: 0, y: -1, z: 1 },
      initialState(),
    );
    expect(s.hit).toBe(true);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.z).toBeCloseTo(10, 6);
  });

  it("works with a non-normalized (unproject-derived) direction vector", () => {
    // groundRayCrossing must not assume camDir is a unit vector — the caller
    // feeds it a raw (unprojected point - camPos) difference.
    const s = groundRayCrossing(
      { x: 0, y: 10, z: 0 },
      { x: 0, y: -5, z: 5 }, // same direction as above, scaled by 5
      initialState(),
    );
    expect(s.hit).toBe(true);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.z).toBeCloseTo(10, 6);
  });

  it("respects a non-zero ground plane height", () => {
    const s = groundRayCrossing(
      { x: 0, y: 20, z: 0 },
      { x: 0, y: -1, z: 0 },
      initialState(),
      5, // ground at y = 5, not 0
    );
    expect(s.hit).toBe(true);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.z).toBeCloseTo(0, 6);
  });

  it("falls back to the last-known-good point when the ray is parallel to the ground", () => {
    const prev = { x: 3, z: 4, hit: true };
    const s = groundRayCrossing(
      { x: 0, y: 10, z: 0 },
      { x: 1, y: 0, z: 0 }, // horizontal — never reaches y = 0
      prev,
    );
    expect(s.hit).toBe(false);
    expect(s.x).toBe(3);
    expect(s.z).toBe(4);
  });

  it("falls back to the last-known-good point when the ground is BEHIND the camera along this ray", () => {
    // Camera below the ground, looking further down and away — the ground
    // plane is only reachable by going backward along this ray (t < 0).
    const prev = { x: 7, z: -2, hit: true };
    const s = groundRayCrossing(
      { x: 0, y: -10, z: 0 },
      { x: 0, y: -1, z: 0 },
      prev,
    );
    expect(s.hit).toBe(false);
    expect(s.x).toBe(7);
    expect(s.z).toBe(-2);
  });

  it("is continuous: a small change in camera direction produces a small change in the crossing point", () => {
    // The whole point of deriving the crossing point this way — no threshold,
    // no glide, just a direct function of the camera's own (continuously
    // changing) orientation.
    const a = groundRayCrossing(
      { x: 0, y: 10, z: 0 },
      { x: 0, y: -1, z: 1 },
      initialState(),
    );
    const b = groundRayCrossing(
      { x: 0, y: 10, z: 0 },
      { x: 0.01, y: -1, z: 1 }, // a tiny rotation
      initialState(),
    );
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.5);
  });
});
