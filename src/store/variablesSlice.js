// Document-wide named variables.  Each entry is { name, formula } where
// `formula` is a string that may reference other variables (e.g.
// "width * 2").  Used by dimension constraints and extrusion depths.
//
// setVariables additionally walks every sketch and re-solves any
// distance constraints that may now resolve to a different number, then
// rewrites the CREATE history entry for each touched sketch so the new
// shape positions survive reload + replay.

import { solveConstraints, varFields } from "../three/sketchSolver.js";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
import { resizeCorner } from "../three/sketchGeometry.js";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";

// Whether two shape arrays differ beyond floating-point noise.
const shapesDiffer = (a, b) => {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    for (const f of varFields(a[i])) {
      if (Math.abs((a[i][f] ?? 0) - (b[i][f] ?? 0)) > 1e-6) return true;
    }
  }
  return false;
};
import {
  loadVariables,
  saveVariables,
  saveTimeline,
  withOrphanFlags,
  dirtyAllEntries,
} from "./internals.js";

export const variablesInitial = {
  variables: loadVariables(),
  variablesDialogOpen: false,
};

export const createVariablesSlice = (set) => ({
  setVariablesDialogOpen: (open) => set({ variablesDialogOpen: open }),

  setVariables: (variables) =>
    set((state) => {
      saveVariables(variables);
      // Re-solve every sketch's distance constraints in case any of
      // them reference variables that just changed.  Pass the new map
      // explicitly — resolveConstraintDistance otherwise reads from the
      // store, which still holds the old variables until this set()
      // returns.
      const newVarsMap = variablesToMap(variables);
      let anyFailed = false;
      // Re-cut chamfer/bevel corners whose size is a formula so they track
      // the new variable values (the bridge geometry is shape-level — the
      // constraint solver doesn't drive it).
      const recutCorners = (shapesIn) => {
        let shapes = shapesIn;
        for (let i = 0; i < shapes.length; i++) {
          const sh = shapes[i];
          if (
            (sh.kind === "chamfer" || sh.kind === "bevel") &&
            typeof sh.distanceFormula === "string"
          ) {
            const mm = evaluateFormula(sh.distanceFormula, newVarsMap);
            if (!Number.isFinite(mm) || mm <= 0) continue;
            const units = mm / MM_PER_UNIT;
            const cur = sh.kind === "bevel" ? sh.r : sh.chamferData?.dist;
            if (Number.isFinite(cur) && Math.abs(cur - units) < 1e-9) continue;
            const res = resizeCorner(shapes, i, units);
            if (!res) continue;
            if (shapes === shapesIn) shapes = shapesIn.slice();
            for (const [k, v] of res.updates) shapes[k] = v;
            shapes[i] = {
              ...shapes[i],
              distanceFormula: sh.distanceFormula,
            };
          }
        }
        return shapes;
      };
      const updatedItems = state.items.map((item) => {
        if (
          item.type === "sketch" &&
          (item.constraints?.length ||
            (item.shapes || []).some(
              (sh) => typeof sh.distanceFormula === "string",
            ))
        ) {
          // Numerically re-solve the WHOLE sketch with the new variable values
          // so every constraint (angles, coincidents, …) is respected.  Leave
          // the sketch untouched if the new value can't be satisfied.
          const orig = item.shapes || [];
          const { shapes: solved, ok } = item.constraints?.length
            ? solveConstraints(orig, item.constraints, {
                variables: newVarsMap,
              })
            : { shapes: orig, ok: true };
          const final = ok ? recutCorners(solved) : orig;
          if (ok && shapesDiffer(orig, final))
            return { ...item, shapes: final };
          if (!ok) anyFailed = true;
          return item;
        }
        // Booleans and chamfers cache their tessellated `geometryData`
        // keyed by `regeneratedAt`.  Their inputs (extrude depths,
        // dimension distances) may now resolve to new values, but the
        // regen-skip check would otherwise keep the stale geometry.
        // Force a rebuild on the next regenerateForResolution pass by
        // clearing the flag.
        if (item.type === "csg" && item.regenerator) {
          return {
            ...item,
            regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
          };
        }
        return item;
      });
      // Persist any sketch-shape changes into the matching create-history
      // entries so reload/undo see the new positions.
      const changedSketchIds = updatedItems
        .filter((it, i) => it !== state.items[i])
        .map((it) => it.id);
      const rewritten =
        changedSketchIds.length === 0
          ? state.history
          : state.history.map((entry) => {
              const inst = entry.instruction;
              if (
                inst?.type === "create" &&
                changedSketchIds.includes(inst.item?.id)
              ) {
                const item = updatedItems.find((i) => i.id === inst.item.id);
                return {
                  ...entry,
                  instruction: {
                    ...inst,
                    item: { ...inst.item, shapes: item.shapes },
                  },
                };
              }
              return entry;
            });
      // A variable can drive any extrude depth / dimension / sketch shape, so
      // forward-invalidate the WHOLE timeline: the JIT recalc reads each entry's
      // `dirty` flag (not the live items), and would otherwise skip every step as
      // clean and keep the stale geometry.  (dirty is a transient flag; saveTimeline
      // strips it — persistence only sees the rewritten sketch shapes.)
      const newHistory = dirtyAllEntries(rewritten);
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        variables,
        items: updatedItems,
        history: withOrphanFlags(newHistory),
        ...(anyFailed
          ? {
              notification:
                "Some sketch dimensions couldn't update to the new value without breaking a constraint",
            }
          : {}),
      };
    }),
});
