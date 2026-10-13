// The tessellation precision (mm deviation / sagitta) everything is built at:
// the one Resolution setting.  There used to be a Normal and a High value with
// a toolbar toggle between them; there is now one, and changing it rebuilds
// the whole timeline (useSceneSync).
//
// Pass an explicit state for imperative call sites (`activePrecision(getState())`)
// or a Zustand selector argument in components (`useStore(activePrecision)`) so
// the value is reactive to the setting.

import { useStore } from "../store";
import { MM_PER_UNIT } from "./sceneObjects/dimensions.js";

export function activePrecision(state) {
  const s = state || useStore.getState();
  return s.resolutionMm;
}

// Glyph-outline simplification deviation for the active resolution, in sketch
// units.  Text contours are simplified to this tolerance, so the Resolution
// setting governs how many faces an extruded letter has — the same mm
// deviation everything else tessellates to.
export function textSimplifyTol(state) {
  return activePrecision(state) / MM_PER_UNIT;
}
