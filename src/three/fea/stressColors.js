// Stress field -> vertex colours, plus the stops a legend needs.
//
// Magnitude is a SEQUENTIAL encoding: one hue family, monotone in lightness.
// Not the traditional FEA blue-green-red rainbow -- that is non-monotone in
// lightness, so it invents banding where the field is smooth and collapses
// where it is steep, and it is unreadable with any colour vision deficiency.
//
// Each theme gets its own ramp rather than one ramp flipped, because the end
// nearest the background has to stay visible: every candidate that ran from
// near-black failed against the dark surface, and every pale one failed
// against the light surface. Both ramps below pass the ordinal checks
// (monotone lightness, adjacent lightness gaps, contrast against that theme's
// surface). The direction is the same in both -- the further a colour is from
// the background, the higher the stress.
//
// Pure arrays -- no THREE, no DOM.

// Low stress -> high stress.
const RAMPS = {
  // Dull ember to near-white: brightness increases with load, like heat.
  dark: [
    "#a83a2c",
    "#c14f36",
    "#d66742",
    "#e78455",
    "#f2a273",
    "#f8c09b",
    "#fbdac4",
  ],
  // Pale to deep: on a light ground the DARK end is the salient one.
  light: [
    "#e6907a",
    "#d16a4e",
    "#b94c33",
    "#9d3723",
    "#7f2618",
    "#61180f",
    "#440e08",
  ],
};

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

// three.js takes vertex colours in linear space when the renderer outputs
// sRGB, so the transfer function is applied here and the caller just copies
// numbers into a BufferAttribute.
const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export const rampStops = (theme) => RAMPS[theme === "light" ? "light" : "dark"];

// Sampled at t in 0..1, in sRGB. Interpolating between seven stops of one hue
// family keeps the small error of a straight sRGB lerp well under a step.
export function sampleRamp(theme, t) {
  const stops = rampStops(theme).map(hexToRgb);
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map(
    (c) => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f,
  );
}

// The value the ramp's top should mean.
//
// NOT the maximum: the peak sits at the fixture, where a coarse grid resolves
// it worst, so scaling to it makes the whole plot depend on the Detail setting
// rather than on the part. A high percentile keeps the scale on the part.
export function rampCeiling(vertexStress, percentile = 0.98) {
  const live = [];
  for (const v of vertexStress) if (v > 0) live.push(v);
  if (!live.length) return 0;
  live.sort((a, b) => a - b);
  return live[Math.min(live.length - 1, Math.floor(live.length * percentile))];
}

// Per-vertex linear RGB, ready for a "color" BufferAttribute.
export function stressVertexColors(vertexStress, { theme, ceiling }) {
  const top = ceiling > 0 ? ceiling : 1;
  const out = new Float32Array(vertexStress.length * 3);
  for (let v = 0; v < vertexStress.length; v++) {
    const rgb = sampleRamp(theme, vertexStress[v] / top);
    for (let c = 0; c < 3; c++) out[v * 3 + c] = toLinear(rgb[c]);
  }
  return out;
}

// Evenly spaced legend entries: the swatch in sRGB hex plus the value it
// stands for, so the scale is readable in MPa rather than "more red".
export function legendScale(ceiling, theme, steps = 5) {
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    const [r, g, b] = sampleRamp(theme, t);
    const hex =
      "#" +
      [r, g, b]
        .map((c) =>
          Math.round(c * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    return { t, hex, mpa: ceiling * t };
  });
}
