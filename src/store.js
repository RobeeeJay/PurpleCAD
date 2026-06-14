// Composition root for the Zustand store.
//
// Each slice in src/store/*.js owns a coherent area of state +
// actions (history mutations, sketch shapes, variables, document
// load/save, UI / ephemeral flags).  The slices share helpers from
// src/store/internals.js (history-id counter, persistence, undo
// bookkeeping, sketch-undo stacks) so module-level singletons stay in
// one place.
//
// External callers continue to import { useStore, getSketchUndoState }
// from "../store" / "./store" — no consumer file is affected by the
// internal layout.

import { create } from "zustand";

import {
  defaultHistory,
  persisted,
  withOrphanFlags,
  getInitialItems,
  sketchUndoStacks,
} from "./store/internals.js";
import { createDocumentSlice } from "./store/documentSlice.js";
import { createHistorySlice } from "./store/historySlice.js";
import { createSketchSlice } from "./store/sketchSlice.js";
import {
  createVariablesSlice,
  variablesInitial,
} from "./store/variablesSlice.js";
import { createUiSlice, uiInitial } from "./store/uiSlice.js";
import { createMaterialSlice, materialInitial } from "./store/materialSlice.js";
import { createFolderSlice, folderInitial } from "./store/folderSlice.js";

export const useStore = create((set, get) => ({
  // ---- Initial state ----
  items: getInitialItems(),
  history: persisted ? withOrphanFlags(persisted.history) : defaultHistory,
  activeHistoryId: persisted ? persisted.activeHistoryId : null,
  undoStack: [],
  redoStack: [],
  ...uiInitial,
  ...variablesInitial,
  ...materialInitial,
  ...folderInitial,

  // ---- Actions, composed from slices ----
  ...createUiSlice(set, get),
  ...createDocumentSlice(set, get),
  ...createHistorySlice(set, get),
  ...createSketchSlice(set, get),
  ...createVariablesSlice(set, get),
  ...createMaterialSlice(set, get),
  ...createFolderSlice(set, get),
}));

// E2E test hook: expose the store on window so Playwright can read state and
// drive actions via page.evaluate, instead of trying to assert on opaque WebGL
// canvas pixels.  Gated behind the __E2E__ compile-time flag (vite.config.js,
// driven by the VITE_E2E shell var via the `e2e:build` npm script) so it never
// ships in a normal build.  `typeof` guards keep it inert under vitest/node,
// where __E2E__ isn't defined.
if (
  typeof window !== "undefined" &&
  typeof __E2E__ !== "undefined" &&
  __E2E__
) {
  window.__store = useStore;
}

// Per-sketch undo-state probe (sketch toolbar reads it to enable / disable
// the per-sketch undo + redo buttons).
export const getSketchUndoState = (sketchId) => {
  const stacks = sketchUndoStacks.get(sketchId);
  return {
    canUndo: (stacks?.undoStack.length ?? 0) > 0,
    canRedo: (stacks?.redoStack.length ?? 0) > 0,
  };
};
