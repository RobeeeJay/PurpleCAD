// Document-wide named variables.  Each entry is { name, formula } where
// `formula` is a string that may reference other variables (e.g.
// "width * 2").  Used by dimension constraints and extrusion depths.
//
// setVariables additionally walks every sketch and re-solves any
// distance constraints that may now resolve to a different number, then
// rewrites the CREATE history entry for each touched sketch so the new
// shape positions survive reload + replay.

import { resolveDistanceConstraints } from "../three/sketchConstraints.js";
import { variablesToMap } from "../utils/formulas.js";
import {
  loadVariables,
  saveVariables,
  saveTimeline,
  withOrphanFlags,
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
      const updatedItems = state.items.map((item) => {
        if (item.type === "sketch" && item.constraints?.length) {
          const newShapes = resolveDistanceConstraints(
            item.shapes || [],
            item.constraints,
            newVarsMap,
          );
          if (newShapes) return { ...item, shapes: newShapes };
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
      const newHistory =
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
      if (changedSketchIds.length > 0) {
        saveTimeline(newHistory, state.activeHistoryId);
      }
      return {
        variables,
        items: updatedItems,
        history:
          changedSketchIds.length > 0
            ? withOrphanFlags(newHistory)
            : state.history,
      };
    }),
});
