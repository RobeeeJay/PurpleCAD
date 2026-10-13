// Per-sketch undo / redo.  Pops the sketch-local undo/redo stacks (kept in
// internals.js, separate from the global timeline) and rewrites the matching
// CREATE history entry so the restored shapes/constraints survive replay.
// Spread into the store by createSketchSlice.

import {
  sketchUndoStacks,
  withOrphanFlags,
  saveTimeline,
  invalidateEdit,
  UNDO_LIMIT,
} from "./internals.js";

export const createSketchUndoSlice = (set) => ({
  undoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.undoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.redoStack = [
        ...stacks.redoStack,
        {
          shapes: (item.shapes || []).slice(),
          constraints: (item.constraints || []).slice(),
        },
      ].slice(-UNDO_LIMIT);
      const prev = stacks.undoStack[stacks.undoStack.length - 1];
      stacks.undoStack = stacks.undoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId
          ? Object.assign({}, i, {
              shapes: prev.shapes,
              constraints: prev.constraints,
            })
          : i,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  redoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.redoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.undoStack = [
        ...stacks.undoStack,
        {
          shapes: (item.shapes || []).slice(),
          constraints: (item.constraints || []).slice(),
        },
      ].slice(-UNDO_LIMIT);
      const next = stacks.redoStack[stacks.redoStack.length - 1];
      stacks.redoStack = stacks.redoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId
          ? Object.assign({}, i, {
              shapes: next.shapes,
              constraints: next.constraints,
            })
          : i,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),
});
