// Document-level actions: open a fresh document, load one from disk.
// These both reset most of the store; they're separated from
// historySlice because they bypass undo/redo and touch persistence
// directly.

import { unpackHistory } from "./geometryPack.js";
import {
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  saveVariables,
  saveFolders,
  setNextHistoryId,
  backfillEmbossFrames,
  pruneTextureSourceChains,
} from "./internals.js";
import { clearCamera } from "./db.js";
import { motionInitial } from "./motionSlice.js";

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
      clearCamera();
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
        // A playing motion and the red ring that paused it belong to a
        // component in the document being replaced -- and folder ids restart
        // per document, so leaving them set can start the NEW document's
        // component moving on its own.
        ...motionInitial,
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
      const history = pruneTextureSourceChains(
        backfillEmbossFrames(unpackHistory(data.history)),
      );
      const maxId = Math.max(...history.map((h) => h.id));
      setNextHistoryId(maxId + 1);
      const newActiveHistoryId =
        data.activeHistoryId !== undefined ? data.activeHistoryId : null;
      saveTimeline(history, newActiveHistoryId);
      clearCamera();
      const targetIdx =
        newActiveHistoryId !== null
          ? history.findIndex((h) => h.id === newActiveHistoryId)
          : history.length - 1;
      const items = replayUpTo(
        history,
        targetIdx !== -1 ? targetIdx : history.length - 1,
      );
      const variables = Array.isArray(data.variables) ? data.variables : [];
      saveVariables(variables);
      // Files saved before components were written into them have none.
      const folders = Array.isArray(data.folders) ? data.folders : [];
      saveFolders(folders);
      return {
        items,
        history: withOrphanFlags(history),
        activeHistoryId: newActiveHistoryId,
        selectedId: null,
        selectedIds: [],
        hoveredId: null,
        undoStack: [],
        redoStack: [],
        variables,
        folders,
        ...motionInitial,
        cameraResetTrigger: state.cameraResetTrigger + 1,
      };
    }),
});
