// Construction-line dashes are sized in screen pixels, not world units: a
// world-sized dash turns a construction line solid as soon as the view zooms
// in, which is exactly when the user is looking closely at it.
import { describe, it, expect } from "vitest";
import {
  CONSTRUCTION_DASH_PX,
  CONSTRUCTION_GAP_PX,
  applyScreenDashes,
  trackScreenDash,
} from "../screenDash.js";

const material = () => ({ userData: {}, dashSize: 0, gapSize: 0 });

describe("screen-space dashes", () => {
  it("shrinks the dash in world units as the view zooms in", () => {
    const mat = trackScreenDash(material());
    // Zoomed out: one pixel covers a lot of the model.
    applyScreenDashes(0.02);
    const zoomedOut = mat.dashSize;
    // Zoomed in 20x: a pixel covers a twentieth as much, so the dash must
    // shrink to match, or it swallows the whole line.
    applyScreenDashes(0.001);
    expect(mat.dashSize).toBeCloseTo(zoomedOut / 20, 10);
    // The ratio of dash to gap -- what makes it READ as dashed -- holds.
    expect(mat.dashSize / mat.gapSize).toBeCloseTo(
      CONSTRUCTION_DASH_PX / CONSTRUCTION_GAP_PX,
      10,
    );
  });

  it("keeps the dash a constant number of pixels at any zoom", () => {
    const mat = trackScreenDash(material());
    for (const worldPerPixel of [0.5, 0.05, 0.0004]) {
      applyScreenDashes(worldPerPixel);
      expect(mat.dashSize / worldPerPixel).toBeCloseTo(
        CONSTRUCTION_DASH_PX,
        10,
      );
      expect(mat.gapSize / worldPerPixel).toBeCloseTo(CONSTRUCTION_GAP_PX, 10);
    }
  });

  it("sizes a material that appears mid-view without waiting a frame", () => {
    applyScreenDashes(0.01);
    // A line drawn now (the overlay rebuilds on every sketch edit) must not
    // render solid until the next frame.
    const mat = trackScreenDash(material());
    expect(mat.dashSize).toBeCloseTo(CONSTRUCTION_DASH_PX * 0.01, 10);
  });

  it("takes a custom dash and gap, for lines that want their own rhythm", () => {
    const mat = trackScreenDash(material(), 12, 3);
    applyScreenDashes(0.1);
    expect(mat.dashSize).toBeCloseTo(1.2, 10);
    expect(mat.gapSize).toBeCloseTo(0.3, 10);
  });

  it("ignores a meaningless scale rather than blanking every dash", () => {
    const mat = trackScreenDash(material());
    applyScreenDashes(0.01);
    const sized = mat.dashSize;
    // A camera measured before the canvas has a size would otherwise set every
    // dash to zero, which three draws as a solid line.
    applyScreenDashes(0);
    applyScreenDashes(NaN);
    expect(mat.dashSize).toBe(sized);
  });
});
