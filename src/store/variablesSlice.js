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
  dirtyEntriesFrom,
  firstChangedIndex,
  markCsgDirtyFrom,
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

// Identifiers in a formula (or any string).
const namesIn = (text) =>
  new Set(String(text ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);

// The variables whose value a change alters: those added, removed or
// redefined, and then every variable computed from one of them (Area = Width *
// Depth changes with Width), to a fixed point.
function changedVariableNames(before = [], after = []) {
  const def = (v) => String(v.formula ?? v.value ?? "");
  const was = new Map(before.map((v) => [v.name, def(v)]));
  const now = new Map(after.map((v) => [v.name, def(v)]));
  const changed = new Set();
  for (const [name, f] of now) if (was.get(name) !== f) changed.add(name);
  for (const name of was.keys()) if (!now.has(name)) changed.add(name);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, f] of now)
      if (!changed.has(name) && [...namesIn(f)].some((n) => changed.has(n))) {
        changed.add(name);
        grew = true;
      }
  }
  return changed;
}

// The first entry with a string naming one of `names` -- a depth "Thick", a
// dimension "Width / 2", a chamfer "Edge".  Whole identifiers only, in string
// values only; packed meshes are skipped.  -1 if none does.
const MESH_KEYS = new Set(["geometryData", "positions", "normals", "indices"]);
function firstEntryNaming(history, names) {
  if (names.size === 0) return -1;
  const names_ = (v) => {
    if (typeof v === "string") {
      for (const n of namesIn(v)) if (names.has(n)) return true;
      return false;
    }
    if (Array.isArray(v)) return v.some(names_);
    if (v && typeof v === "object")
      return Object.entries(v).some(([k, x]) => !MESH_KEYS.has(k) && names_(x));
    return false;
  };
  return history.findIndex((e) => names_(e.instruction));
}

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
        // Bodies the change reaches are marked stale below, from the first
        // step it reaches -- not every body here (which also made each one
        // look like a changed sketch, and rewrote its create entry).
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
      // Forward-invalidate from the first step the change reaches: the JIT
      // recalc reads each entry's `dirty` flag (not the live items), and would
      // otherwise skip every step as clean and keep the stale geometry.  A step
      // is reached when it names a changed variable (or one computed from it),
      // or when re-solving rewrote it (a sketch).  Nothing earlier can see the
      // change.  (dirty is a transient flag; saveTimeline strips it --
      // persistence only sees the rewritten sketch shapes.)
      const reached = [
        firstEntryNaming(
          rewritten,
          changedVariableNames(state.variables, variables),
        ),
        firstChangedIndex(state.history, rewritten),
      ].filter((i) => i >= 0);
      const from = reached.length ? Math.min(...reached) : -1;
      const newHistory = dirtyEntriesFrom(
        rewritten,
        from < 0 ? Infinity : from,
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        variables,
        dimensionConflicts,
        items: markCsgDirtyFrom(updatedItems, newHistory, from),
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
