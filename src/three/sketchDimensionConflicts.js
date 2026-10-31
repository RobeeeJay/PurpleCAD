// Dimensions that are driven by a variable but that the geometry does not
// actually satisfy.
//
// setVariables re-solves every sketch when a variable changes and LEAVES THE
// SKETCH ALONE when the solve fails (see variablesSlice) -- the other
// constraints won't allow the new value.  The dimension label then reads the
// value the variable resolves to while the geometry still sits at the old one,
// with nothing on screen saying which dimension refused to move.  Picking out
// exactly those constraints is what lets the sketch view highlight them.

import { constraintResidual } from "./sketchSolver.js";
import { isFormulaValue } from "../utils/formulas.js";

// Only the measured annotations can conflict this way.  The angles a chamfer
// keeps are plain numbers; an angle dimension can take a formula.
const DIMENSION_TYPES = new Set([
  "distance",
  "pointLineDistance",
  "offset",
  "angleDimension",
]);

// The solver's own success tolerance: below this a dimension IS satisfied.
export const DIMENSION_CONFLICT_TOL = 1e-3;

export const isVariableDrivenDimension = (c) =>
  DIMENSION_TYPES.has(c?.type) && isFormulaValue(c.distance ?? c.angle);

// The variable-driven dimensions of `constraints` that `shapes` does not meet.
export function conflictingDimensions(
  shapes,
  constraints,
  variables,
  tol = DIMENSION_CONFLICT_TOL,
) {
  return (constraints || []).filter(
    (c) =>
      isVariableDrivenDimension(c) &&
      constraintResidual(shapes, c, variables) > tol,
  );
}
