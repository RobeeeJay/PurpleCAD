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
