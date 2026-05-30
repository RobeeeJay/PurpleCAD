// Timeline navigation: reorder and delete history entries, and global
// undo / redo.  Spread into the store by createHistorySlice.

import {
  replayUpTo,
  withUndo,
  withOrphanFlags,
  saveTimeline,
  UNDO_LIMIT,
} from "./internals.js";

export const createHistoryNavSlice = (set) => ({
  reorderHistory: (fromId, beforeId) =>
    set((state) => {
      const fromIdx = state.history.findIndex((h) => h.id === fromId);
      if (fromIdx <= 0) return {};

      let toIdx =
        beforeId === null
          ? state.history.length
          : state.history.findIndex((h) => h.id === beforeId);
      if (toIdx === 0) return {};
      if (toIdx === fromIdx || toIdx === fromIdx + 1) return {};

      const rawHistory = [...state.history];
      const [moved] = rawHistory.splice(fromIdx, 1);
      const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
      rawHistory.splice(insertAt, 0, moved);

      const activeIdx =
        state.activeHistoryId !== null
          ? rawHistory.findIndex((h) => h.id === state.activeHistoryId)
          : rawHistory.length - 1;
      const items = replayUpTo(
        rawHistory,
        activeIdx !== -1 ? activeIdx : rawHistory.length - 1,
      );

      saveTimeline(rawHistory, state.activeHistoryId);
      return Object.assign(
        { history: withOrphanFlags(rawHistory), items },
        withUndo(state),
      );
    }),

  deleteHistoryEntry: (historyId) =>
    set((state) => {
      if (state.history.length <= 1) return {};
      const deletedIndex = state.history.findIndex((h) => h.id === historyId);
      if (deletedIndex <= 0) return {};

      const rawHistory = state.history.filter((h) => h.id !== historyId);

      let newActiveId = state.activeHistoryId;
      if (newActiveId === historyId) {
        const fallback = rawHistory[Math.max(0, deletedIndex - 1)];
        newActiveId = fallback ? fallback.id : null;
      }
      if (
        rawHistory.length > 0 &&
        newActiveId === rawHistory[rawHistory.length - 1].id
      ) {
        newActiveId = null;
      }

      const activeIdx =
        newActiveId !== null
          ? rawHistory.findIndex((h) => h.id === newActiveId)
          : rawHistory.length - 1;
      const items = replayUpTo(rawHistory, activeIdx);

      saveTimeline(rawHistory, newActiveId);
      return Object.assign(
        {
          history: withOrphanFlags(rawHistory),
          activeHistoryId: newActiveId,
          items,
        },
        withUndo(state),
      );
    }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return {};
      const snapshot = state.undoStack[state.undoStack.length - 1];
      const idx =
        snapshot.activeHistoryId !== null
          ? snapshot.history.findIndex((h) => h.id === snapshot.activeHistoryId)
          : snapshot.history.length - 1;
      const items = replayUpTo(
        snapshot.history,
        idx !== -1 ? idx : snapshot.history.length - 1,
      );
      saveTimeline(snapshot.history, snapshot.activeHistoryId);
      return {
        history: snapshot.history,
        activeHistoryId: snapshot.activeHistoryId,
        items,
        selectedId: null,
        selectedIds: [],
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          { history: state.history, activeHistoryId: state.activeHistoryId },
        ].slice(-UNDO_LIMIT),
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return {};
      const snapshot = state.redoStack[state.redoStack.length - 1];
      const idx =
        snapshot.activeHistoryId !== null
          ? snapshot.history.findIndex((h) => h.id === snapshot.activeHistoryId)
          : snapshot.history.length - 1;
      const items = replayUpTo(
        snapshot.history,
        idx !== -1 ? idx : snapshot.history.length - 1,
      );
      saveTimeline(snapshot.history, snapshot.activeHistoryId);
      return {
        history: snapshot.history,
        activeHistoryId: snapshot.activeHistoryId,
        items,
        selectedId: null,
        selectedIds: [],
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [
          ...state.undoStack,
          { history: state.history, activeHistoryId: state.activeHistoryId },
        ].slice(-UNDO_LIMIT),
      };
    }),
});
