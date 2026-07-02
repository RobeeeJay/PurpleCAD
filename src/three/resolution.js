// The active tessellation precision (mm deviation / sagitta) for the current
// resolution mode.  "preview" uses the editing density; "print" uses the final
// ("Normal/High") density.  Both are user-configurable in Settings.
//
// Pass an explicit state for imperative call sites (`activePrecision(getState())`)
// or a Zustand selector argument in components (`useStore(activePrecision)`) so
// the value is reactive to both the mode toggle and the density settings.

import { useStore } from "../store";
import { MM_PER_UNIT } from "./sceneObjects/dimensions.js";

export function activePrecision(state) {
  const s = state || useStore.getState();
  return s.curveResolution === "print"
    ? s.printPrecisionMm
    : s.previewPrecisionMm;
}

// Glyph-outline simplification deviation for the active resolution, in sketch
// units.  Text contours are simplified to this tolerance, so the print/preview
// toggle (and the mm precision settings) directly govern how many faces an
// extruded letter has — the same mm deviation everything else tessellates to.
export function textSimplifyTol(state) {
  return activePrecision(state) / MM_PER_UNIT;
}
