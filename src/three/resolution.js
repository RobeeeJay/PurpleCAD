// The active tessellation precision (mm deviation / sagitta) for the current
// resolution mode.  "preview" uses the editing density; "print" uses the final
// ("Normal/High") density.  Both are user-configurable in Settings.
//
// Pass an explicit state for imperative call sites (`activePrecision(getState())`)
// or a Zustand selector argument in components (`useStore(activePrecision)`) so
// the value is reactive to both the mode toggle and the density settings.

import { useStore } from "../store";

export function activePrecision(state) {
  const s = state || useStore.getState();
  return s.curveResolution === "print"
    ? s.printPrecisionMm
    : s.previewPrecisionMm;
}

// Glyph-curve subdivision count for the active resolution — text contours are
// sampled this finely, so the print/preview toggle changes how smooth extruded
// (and drawn) text is.  Derived from the same mm deviation as everything else,
// clamped to a sane range.
export function textDivisions(state) {
  const p = activePrecision(state);
  return Math.max(3, Math.min(24, Math.round(2 / (p > 0 ? p : 0.5))));
}
