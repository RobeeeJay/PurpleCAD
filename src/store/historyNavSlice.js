// Timeline navigation: reorder and delete history entries, and global
// undo / redo.  Spread into the store by createHistorySlice.

import {
  replayUpTo,
  withUndo,
  withOrphanFlags,
  saveTimeline,
  saveVariables,
  markCsgDirty,
  relinkSourceChain,
  dirtyEntriesFrom,
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

      let rawHistory = [...state.history];
      const [moved] = rawHistory.splice(fromIdx, 1);
      const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
      rawHistory.splice(insertAt, 0, moved);

      // A reorder changes what each op in the affected span builds ON — but the
      // ops carry FROZEN source snapshots from the old order (a chamfer moved
      // before an emboss still holds the embossed body as its source, and the
      // emboss then re-stamps on top of it: doubled relief).  Re-bind the moved
      // item's source chain to the NEW accumulation order and forward-invalidate
      // from the first affected index so the recalc genuinely replays the new
      // order instead of trusting stale snapshots/baked meshes (mirrors
      // deleteHistoryEntry).
      const movedInst = moved.instruction;
      const affectedId =
        movedInst?.type === "modify"
          ? movedInst.itemId
          : (movedInst?.item?.id ?? null);
      const firstAffected = Math.min(fromIdx, insertAt);
      if (affectedId != null)
        rawHistory = relinkSourceChain(rawHistory, affectedId, firstAffected);
      rawHistory = dirtyEntriesFrom(rawHistory, firstAffected);

      const activeIdx =
        state.activeHistoryId !== null
          ? rawHistory.findIndex((h) => h.id === state.activeHistoryId)
          : rawHistory.length - 1;
      const items = markCsgDirty(
        replayUpTo(
          rawHistory,
          activeIdx !== -1 ? activeIdx : rawHistory.length - 1,
        ),
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

      // If the deleted step was an in-place op on an item (chamfer, emboss, …),
      // re-point the sources of any LATER ops on that same item so the deleted
      // layer is spliced out of their frozen source chains — otherwise a
      // downstream emboss keeps rebuilding the removed chamfer.
      const deletedInst = state.history[deletedIndex].instruction;
      const affectedId =
        deletedInst?.type === "modify" ? deletedInst.itemId : null;

      let rawHistory = state.history.filter((h) => h.id !== historyId);
      if (affectedId != null)
        rawHistory = relinkSourceChain(rawHistory, affectedId, deletedIndex);
      // Forward invalidation: entries that were after the deleted one (now at
      // deletedIndex onward) rebuild from the shortened chain.
      rawHistory = dirtyEntriesFrom(rawHistory, deletedIndex);

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
      const items = markCsgDirty(replayUpTo(rawHistory, activeIdx));

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
      const items = markCsgDirty(
        replayUpTo(
          snapshot.history,
          idx !== -1 ? idx : snapshot.history.length - 1,
        ),
      );
      saveTimeline(snapshot.history, snapshot.activeHistoryId);
      // Older snapshots (pre-variable-undo) have no `variables` — keep current.
      const variables = snapshot.variables ?? state.variables;
      saveVariables(variables);
      return {
        history: snapshot.history,
        activeHistoryId: snapshot.activeHistoryId,
        items,
        variables,
        selectedId: null,
        selectedIds: [],
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [
          ...state.redoStack,
          {
            history: state.history,
            activeHistoryId: state.activeHistoryId,
            variables: state.variables,
          },
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
      const items = markCsgDirty(
        replayUpTo(
          snapshot.history,
          idx !== -1 ? idx : snapshot.history.length - 1,
        ),
      );
      saveTimeline(snapshot.history, snapshot.activeHistoryId);
      const variables = snapshot.variables ?? state.variables;
      saveVariables(variables);
      return {
        history: snapshot.history,
        activeHistoryId: snapshot.activeHistoryId,
        items,
        variables,
        selectedId: null,
        selectedIds: [],
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [
          ...state.undoStack,
          {
            history: state.history,
            activeHistoryId: state.activeHistoryId,
            variables: state.variables,
          },
        ].slice(-UNDO_LIMIT),
      };
    }),
});
