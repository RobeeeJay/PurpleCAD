// Numeric-with-formula resolution for geometry parameters (extrusion depth,
// dimension distance, etc).  Values are stored as strings (e.g. "10",
// "width * 2") so dimensions can reference variables.  This module pulls
// the current variable map from the store at call time and evaluates.
//
// Tests that don't have a working store mock get an empty variable map
// (the bare-number path of `evaluateFormula` still works).

import { useStore } from "../store";
import { MM_PER_UNIT } from "./sceneObjects.js";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";

export function getCurrentVariablesMap() {
  try {
    const state = useStore.getState?.();
    return variablesToMap(state?.variables);
  } catch {
    return new Map();
  }
}

// Resolve a stored geometry value (string formula or legacy number) to a
// finite number in SCENE UNITS.
//
// Units convention:
//   • Numbers are legacy values already in scene units (e.g. depth: 1.0
//     means 1 scene unit = 10 mm) — used by old saved documents and by
//     direct tests that build items programmatically.
//   • Strings are formulas in the user's authoring unit (millimetres),
//     because the Variables dialog and dimension input both speak mm.
//     We evaluate the formula then divide by MM_PER_UNIT to get scene
//     units.
//
// Returns `fallback` (already in scene units) for empty/invalid inputs.
export function resolveValue(value, fallback = 0, variables = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;
  const map = variables ?? getCurrentVariablesMap();
  const mm = evaluateFormula(value, map);
  if (!Number.isFinite(mm)) return fallback;
  return mm / MM_PER_UNIT;
}

// Convenience: resolve an extrude item's depth in scene units.
export function resolveItemDepth(item, variables = null) {
  return resolveValue(item?.depth, 1.0, variables);
}

// Convenience: resolve a distance constraint's value (in scene units).
export function resolveConstraintDistance(constraint, variables = null) {
  return resolveValue(constraint?.distance, 0, variables);
}

// Reverse direction: turn a scene-unit number into a mm-space formula
// string suitable for storage.  Used when the user commits an interactive
// value (drag/finalise) and we want subsequent edits to see a sensible
// formula (just the number, in mm).
export function formatAsFormula(sceneUnits) {
  const mm = sceneUnits * MM_PER_UNIT;
  // Trim trailing zeros so simple round numbers don't show as "10.000000".
  return Number.isFinite(mm) ? String(Number(mm.toFixed(4))) : "0";
}
