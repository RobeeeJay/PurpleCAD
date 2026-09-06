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
import { applyRectangularPatternConstraints } from "../three/sketchRectangularPattern.js";
import { applyMirrorConstraints } from "../three/sketchMirror.js";
import { applyCircularPatternConstraints } from "../three/sketchCircularPattern.js";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { conflictingDimensions } from "../three/sketchDimensionConflicts.js";

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
  withUndo,
  dirtyAllEntries,
} from "./internals.js";

export const variablesInitial = {
  variables: loadVariables(),
  variablesDialogOpen: false,
  // Constraint OBJECTS (not indices) whose variable-driven value the geometry
  // refused to take on the last variable change, so the sketch view can show
  // them in red.  Identity rather than an index because editing a constraint
  // replaces the object, which clears the flag by itself -- an index would
  // survive an insert or delete and point at some other dimension.
  dimensionConflicts: new Set(),
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
      // Rebuilt from scratch on every variable change, so a dimension that now
      // solves stops being flagged without any separate clearing pass.
      const dimensionConflicts = new Set();
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
            // A NEGATIVE value is a valid minus (flipped) fillet — a concave
            // scoop.  Only zero / non-finite is degenerate; a chamfer can't
            // flip, so a negative setback there stays invalid.  (Skipping mm<0
            // outright left minus fillets frozen while every other dimension
            // tracked the variable.)
            if (!Number.isFinite(mm) || mm === 0) continue;
            if (sh.kind === "chamfer" && mm < 0) continue;
            const units = mm / MM_PER_UNIT;
            // Flipped bevels store a POSITIVE radius plus a flip flag, so
            // compare the target against the SIGNED current size or an
            // unchanged minus fillet would re-cut (or, worse, never settle).
            const flipped = !!(sh.bevelData?.flip || sh.flip);
            const curMag = sh.kind === "bevel" ? sh.r : sh.chamferData?.dist;
            const curSigned = flipped ? -curMag : curMag;
            if (
              Number.isFinite(curSigned) &&
              Math.abs(curSigned - units) < 1e-9
            )
              continue;
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
      // Rectangular patterns whose offsets are formulas re-space to the new
      // values (counts are structural and stay as committed).  Returns the
      // constraint list with dx/dy refreshed; the derived-geometry chain below
      // then re-applies the spacing along with mirror / circular copies.
      const refreshPatternConstraints = (constraintsIn) => {
        let changed = false;
        const next = (constraintsIn || []).map((c) => {
          if (c.type !== "rectangularPattern" || (!c.dxFormula && !c.dyFormula))
            return c;
          const dxMm = c.dxFormula
            ? evaluateFormula(c.dxFormula, newVarsMap)
            : null;
          const dyMm = c.dyFormula
            ? evaluateFormula(c.dyFormula, newVarsMap)
            : null;
          const dx = Number.isFinite(dxMm) ? dxMm / MM_PER_UNIT : c.dx;
          const dy = Number.isFinite(dyMm) ? dyMm / MM_PER_UNIT : c.dy;
          if (dx === c.dx && dy === c.dy) return c;
          changed = true;
          return { ...c, dx, dy };
        });
        // Same ref when unchanged so the caller's `!== item.constraints` guard
        // doesn't rewrite every sketch's history on an unrelated variable edit.
        return changed ? next : constraintsIn;
      };
      // Re-derive EVERY dependent shape (mirror / circular / rectangular copies)
      // from the moved sources — the same chain updateSketchShapes runs on a
      // drag.  Without this a variable change moves the sources but leaves the
      // mirror/pattern copies at their old positions, breaking the closed loops
      // that downstream extrudes depend on.
      const rederiveDerived = (shapes, constraints) =>
        applyRectangularPatternConstraints(
          applyCircularPatternConstraints(
            applyMirrorConstraints(shapes, constraints),
            constraints,
          ),
          constraints,
        );
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
          const recut = ok ? recutCorners(solved) : orig;
          const finalConstraints = ok
            ? refreshPatternConstraints(item.constraints)
            : item.constraints;
          const final = ok ? rederiveDerived(recut, finalConstraints) : orig;
          if (
            ok &&
            (shapesDiffer(orig, final) || finalConstraints !== item.constraints)
          )
            return { ...item, shapes: final, constraints: finalConstraints };
          if (!ok) {
            anyFailed = true;
            // Attribute the failure: the sketch keeps its OLD shapes, so the
            // dimensions to highlight are the variable-driven ones that those
            // shapes don't satisfy under the NEW values.
            for (const c of conflictingDimensions(
              orig,
              item.constraints,
              newVarsMap,
            ))
              dimensionConflicts.add(c);
          }
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
                    item: {
                      ...inst.item,
                      shapes: item.shapes,
                      constraints: item.constraints,
                    },
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
        ...withUndo(state),
        variables,
        dimensionConflicts,
        items: updatedItems,
        history: withOrphanFlags(newHistory),
        ...(anyFailed
          ? {
              notification:
                "Some sketch dimensions couldn't update to the new value without breaking a constraint - they are highlighted in red",
            }
          : {}),
      };
    }),
});
