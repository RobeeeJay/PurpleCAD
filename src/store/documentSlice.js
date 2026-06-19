// Document-level actions: open a fresh document, load one from disk.
// These both reset most of the store; they're separated from
// historySlice because they bypass undo/redo and touch persistence
// directly.

import {
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  saveVariables,
  saveFolders,
  setNextHistoryId,
} from "./internals.js";
import { kvRemove } from "./kv.js";

export const createDocumentSlice = (set) => ({
  newDocument: () =>
    set((state) => {
      setNextHistoryId(1);
      const freshHistory = [
        {
          id: 0,
          label: "Scene created",
          itemId: null,
          instruction: { type: "scene_created" },
          hiddenIds: [],
          _orphaned: false,
        },
      ];
      saveTimeline(freshHistory, null);
      saveVariables([]);
      saveFolders([]);
      kvRemove("cad-camera-state");
      return {
        items: [],
        history: freshHistory,
        activeHistoryId: null,
        selectedId: null,
        selectedIds: [],
        hoveredId: null,
        undoStack: [],
        redoStack: [],
        variables: [],
        folders: [],
        cameraResetTrigger: state.cameraResetTrigger + 1,
      };
    }),

  loadDocument: (data) =>
    set((state) => {
      if (
        data.history &&
        data.history[0] &&
        data.history[0].items !== undefined
      ) {
        alert(
          "This document was saved in an older format and cannot be loaded.",
        );
        return {};
      }
      const maxId = Math.max(...data.history.map((h) => h.id));
      setNextHistoryId(maxId + 1);
      const newActiveHistoryId =
        data.activeHistoryId !== undefined ? data.activeHistoryId : null;
      saveTimeline(data.history, newActiveHistoryId);
      kvRemove("cad-camera-state");
      const targetIdx =
        newActiveHistoryId !== null
          ? data.history.findIndex((h) => h.id === newActiveHistoryId)
          : data.history.length - 1;
      const items = replayUpTo(
        data.history,
        targetIdx !== -1 ? targetIdx : data.history.length - 1,
      );
      const variables = Array.isArray(data.variables) ? data.variables : [];
      saveVariables(variables);
      saveFolders([]);
      return {
        items,
        history: withOrphanFlags(data.history),
        activeHistoryId: newActiveHistoryId,
        selectedId: null,
        selectedIds: [],
        hoveredId: null,
        undoStack: [],
        redoStack: [],
        variables,
        folders: [],
        cameraResetTrigger: state.cameraResetTrigger + 1,
      };
    }),
});
