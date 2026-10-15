// The ramp carries the meaning, so its properties are asserted rather than
// eyeballed: monotone lightness (a rainbow reads as banding), a scale that
// ignores the singular peak, and legend values in real units.
import { describe, it, expect } from "vitest";
import {
  legendScale,
  rampCeiling,
  rampStops,
  sampleRamp,
  stressVertexColors,
} from "../stressColors.js";

// Relative luminance, the same quantity the palette checks use.
const lum = ([r, g, b]) => {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

describe("the stress ramp", () => {
  for (const theme of ["dark", "light"]) {
    it(`reads monotonically from one end to the other in ${theme}`, () => {
      const ls = Array.from({ length: 21 }, (_, i) =>
        lum(sampleRamp(theme, i / 20)),
      );
      const rising = ls.every((v, i) => i === 0 || v > ls[i - 1]);
      const falling = ls.every((v, i) => i === 0 || v < ls[i - 1]);
      expect(
        rising || falling,
        `luminance wandered: ${ls.map((v) => v.toFixed(3)).join(" ")}`,
      ).toBe(true);
    });
  }

  it("runs away from the background in each theme", () => {
    // Dark theme brightens with load; light theme deepens.  Either way the
    // high end is the one furthest from the surface behind it.
    expect(lum(sampleRamp("dark", 1))).toBeGreaterThan(
      lum(sampleRamp("dark", 0)),
    );
    expect(lum(sampleRamp("light", 1))).toBeLessThan(
      lum(sampleRamp("light", 0)),
    );
  });

  it("clamps rather than wrapping outside its range", () => {
    expect(sampleRamp("dark", -5)).toEqual(sampleRamp("dark", 0));
    expect(sampleRamp("dark", 5)).toEqual(sampleRamp("dark", 1));
  });
});

describe("scaling the ramp to a part", () => {
  it("ignores a lone singular peak", () => {
    // One element at a fixed corner can read many times the rest of the part.
    // Scaling to it would flatten everything else onto the bottom of the ramp.
    const field = new Float32Array(200);
    for (let i = 0; i < 200; i++) field[i] = 10 + (i % 5);
    field[7] = 5000;
    const ceiling = rampCeiling(field);
    expect(ceiling).toBeLessThan(20);
  });

  it("leaves an unloaded part with no scale to speak of", () => {
    expect(rampCeiling(new Float32Array(50))).toBe(0);
  });

  it("gives every vertex a colour, and the hottest the ramp's top", () => {
    const stress = new Float32Array([0, 25, 50]);
    const colors = stressVertexColors(stress, { theme: "dark", ceiling: 50 });
    expect(colors.length).toBe(9);
    expect([...colors].every((c) => c >= 0 && c <= 1)).toBe(true);
    // Linear-space output, so the top of the dark ramp is the brightest.
    expect(colors[8]).toBeGreaterThan(colors[2]);
  });
});

describe("the legend", () => {
  it("labels its swatches in MPa across the scale", () => {
    const scale = legendScale(180, "dark", 5);
    expect(scale.map((s) => s.mpa)).toEqual([0, 45, 90, 135, 180]);
    expect(scale[0].hex).toBe(rampStops("dark")[0]);
    expect(scale.at(-1).hex).toBe(rampStops("dark").at(-1));
  });
});
