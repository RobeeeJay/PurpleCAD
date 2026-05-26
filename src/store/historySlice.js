// Top-level history mutations: every action that creates / modifies /
// deletes an item, or that reorders / undoes / redoes the timeline.

import {
  makeEntry,
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  withUndo,
  UNDO_LIMIT,
} from "./internals.js";

export const createHistorySlice = (set) => ({
  reparentItem: (itemId, newParentId) =>
    set((state) => {
      if (itemId === newParentId) return {};
      // Prevent circular: newParentId must not be a descendant of itemId.
      if (newParentId !== null) {
        let cur = newParentId;
        while (cur !== null) {
          const curItem = state.items.find((i) => i.id === cur);
          if (!curItem) break;
          if (cur === itemId) return {};
          cur = curItem.parentId ?? null;
        }
      }
      const newItems = state.items.map((i) => {
        if (i.id === itemId)
          return Object.assign({}, i, { parentId: newParentId ?? null });
        if (newParentId !== null && i.id === newParentId)
          return Object.assign({}, i, { expanded: true });
        return i;
      });
      // Persist parentId into the create history entry so it survives reload.
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === itemId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                parentId: newParentId ?? null,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: newItems, history: withOrphanFlags(newHistory) };
    }),

  setItemsTransform: (updates) =>
    set((state) => ({
      items: state.items.map((item) => {
        const upd = updates.find((u) => u.id === item.id);
        if (!upd) return item;
        return Object.assign({}, item, {
          position: upd.position !== undefined ? upd.position : item.position,
          scale: upd.scale !== undefined ? upd.scale : item.scale,
          rotation: upd.rotation !== undefined ? upd.rotation : item.rotation,
        });
      }),
    })),

  setItemTransform: (id, position, scale, rotation) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        return Object.assign({}, item, {
          position: position || item.position,
          scale: scale || item.scale,
          rotation: rotation || item.rotation,
        });
      }),
    })),

  addItem: (item) =>
    set((state) => {
      const fullItem = Object.assign({ parentId: null }, item);
      const newEntry = makeEntry("Added", fullItem.id, {
        type: "create",
        item: fullItem,
      });

      let insertIdx;
      let newActiveId;
      if (state.activeHistoryId !== null) {
        const activeIdx = state.history.findIndex(
          (h) => h.id === state.activeHistoryId,
        );
        insertIdx = activeIdx + 1;
        newActiveId = newEntry.id;
      } else {
        insertIdx = state.history.length;
        newActiveId = null;
      }

      const rawHistory = [
        ...state.history.slice(0, insertIdx),
        newEntry,
        ...state.history.slice(insertIdx),
      ];
      const items = replayUpTo(rawHistory, insertIdx);

      saveTimeline(rawHistory, newActiveId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(rawHistory),
          activeHistoryId: newActiveId,
          selectedId: fullItem.id,
          selectedIds: [fullItem.id],
        },
        withUndo(state),
      );
    }),

  modifyItem: (id, patches, label = "Modified") =>
    set((state) => {
      const newEntry = makeEntry(label, id, {
        type: "modify",
        itemId: id,
        patches,
      });

      let insertIdx;
      let newActiveId;
      if (state.activeHistoryId !== null) {
        const activeIdx = state.history.findIndex(
          (h) => h.id === state.activeHistoryId,
        );
        insertIdx = activeIdx + 1;
        newActiveId = newEntry.id;
      } else {
        insertIdx = state.history.length;
        newActiveId = null;
      }

      const rawHistory = [
        ...state.history.slice(0, insertIdx),
        newEntry,
        ...state.history.slice(insertIdx),
      ];
      const items = replayUpTo(rawHistory, insertIdx);

      saveTimeline(rawHistory, newActiveId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(rawHistory),
          activeHistoryId: newActiveId,
        },
        withUndo(state),
      );
    }),

  deleteItem: (id) =>
    set((state) => {
      const deletedItem = state.items.find((item) => item.id === id);
      const baseHistory =
        state.activeHistoryId !== null
          ? state.history.slice(
              0,
              state.history.findIndex((h) => h.id === state.activeHistoryId) +
                1,
            )
          : state.history;

      const newEntry = makeEntry("Deleted", id, {
        type: "delete",
        itemId: id,
      });
      const rawHistory = [...baseHistory, newEntry];
      // Children of deleted item become top-level.
      const grandParentId = deletedItem?.parentId ?? null;
      const newItems = state.items
        .filter((item) => item.id !== id)
        .map((item) =>
          item.parentId === id
            ? Object.assign({}, item, { parentId: grandParentId })
            : item,
        );

      saveTimeline(rawHistory, null);
      return Object.assign(
        {
          items: newItems,
          selectedId: state.selectedId === id ? null : state.selectedId,
          selectedIds: state.selectedIds.filter((i) => i !== id),
          history: withOrphanFlags(rawHistory),
          activeHistoryId: null,
        },
        withUndo(state),
      );
    }),

  restoreToHistory: (historyId) =>
    set((state) => {
      const idx = state.history.findIndex((h) => h.id === historyId);
      if (idx === -1) return {};
      const isLatest = idx === state.history.length - 1;
      const newActiveHistoryId = isLatest ? null : historyId;
      const items = replayUpTo(state.history, idx);
      saveTimeline(state.history, newActiveHistoryId);
      return {
        items,
        selectedId: null,
        selectedIds: [],
        activeHistoryId: newActiveHistoryId,
      };
    }),

  recordTransformHistory: (id, label) =>
    set((state) => {
      const item = state.items.find((i) => i.id === id);
      if (!item) return {};
      const actionLabel = label || "Moved";
      const isScaleAction = actionLabel === "Scaled";
      const isRotateAction = actionLabel === "Rotated";
      const instruction = {
        type: "transform",
        itemId: id,
        position:
          !isScaleAction && !isRotateAction
            ? Object.assign({}, item.position)
            : undefined,
        scale: isScaleAction ? Object.assign({}, item.scale) : undefined,
        rotation: isRotateAction ? Object.assign({}, item.rotation) : undefined,
      };

      if (state.activeHistoryId !== null) {
        const activeIdx = state.history.findIndex(
          (h) => h.id === state.activeHistoryId,
        );
        const activeEntry = state.history[activeIdx];

        // Merge: update in-place — no new undo snapshot, no redo clear.
        if (
          activeEntry &&
          activeEntry.instruction.type === "transform" &&
          activeEntry.instruction.itemId === id &&
          activeEntry.label === actionLabel
        ) {
          const rawHistory = [
            ...state.history.slice(0, activeIdx),
            Object.assign({}, activeEntry, { instruction }),
            ...state.history.slice(activeIdx + 1),
          ];
          saveTimeline(rawHistory, state.activeHistoryId);
          return {
            history: withOrphanFlags(rawHistory),
            activeHistoryId: state.activeHistoryId,
          };
        }

        // Insert new entry — snapshot undo, clear redo.
        const newEntry = makeEntry(actionLabel, id, instruction);
        const insertIdx = activeIdx + 1;
        const rawHistory = [
          ...state.history.slice(0, insertIdx),
          newEntry,
          ...state.history.slice(insertIdx),
        ];
        saveTimeline(rawHistory, newEntry.id);
        return Object.assign(
          {
            history: withOrphanFlags(rawHistory),
            activeHistoryId: newEntry.id,
          },
          withUndo(state),
        );
      }

      // At end — merge: no snapshot; append: snapshot + clear redo.
      const last = state.history[state.history.length - 1];
      if (
        last &&
        last.instruction.type === "transform" &&
        last.instruction.itemId === id &&
        last.label === actionLabel
      ) {
        const rawHistory = [
          ...state.history.slice(0, -1),
          Object.assign({}, last, { instruction }),
        ];
        saveTimeline(rawHistory, null);
        return { history: withOrphanFlags(rawHistory), activeHistoryId: null };
      }

      const newEntry = makeEntry(actionLabel, id, instruction);
      const rawHistory = [...state.history, newEntry];
      saveTimeline(rawHistory, null);
      return Object.assign(
        { history: withOrphanFlags(rawHistory), activeHistoryId: null },
        withUndo(state),
      );
    }),

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

  renameItem: (id, newName) =>
    set((state) => {
      if (!newName.trim()) return {};
      const trimmed = newName.trim();

      const newItems = state.items.map((i) =>
        i.id === id ? Object.assign({}, i, { name: trimmed }) : i,
      );

      const newHistory = state.history.map((entry) => {
        const inst = entry.instruction;
        if (inst.type === "create" && inst.item && inst.item.id === id) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, inst, {
              item: Object.assign({}, inst.item, { name: trimmed }),
            }),
          });
        }
        return entry;
      });

      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: newItems,
        history: withOrphanFlags(newHistory),
      };
    }),

  // Update the amount / angleRad on an existing chamfer-or-fillet history
  // entry, then replay history so the regenerator reflects the new values.
  // `regeneratedAt` is reset (different from any valid printPrecision) and
  // `geometryData` is cleared so regenerateItemsForResolution's skip-check
  // misses, forcing a fresh tessellation with the new parameters.
  updateChamferParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "chamfer") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              regenerator: {
                ...r,
                ...params,
                regeneratedAt: "dirty",
              },
              geometryData: null,
            },
          },
        };
      });
      const activeIdx =
        state.activeHistoryId != null
          ? newHistory.findIndex((h) => h.id === state.activeHistoryId)
          : newHistory.length - 1;
      const items = replayUpTo(
        newHistory,
        activeIdx !== -1 ? activeIdx : newHistory.length - 1,
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(newHistory),
        },
        withUndo(state),
      );
    }),

  retargetExtrude: (extrudeId, newProfile, newDepth) =>
    set((state) => {
      const updatedItems = state.items.map((item) => {
        if (item.id !== extrudeId) return item;
        return Object.assign({}, item, {
          profile: newProfile,
          depth: newDepth,
          position: newProfile.position,
          rotation: newProfile.rotation,
        });
      });
      const updatedItem = updatedItems.find((i) => i.id === extrudeId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === extrudeId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: updatedItem,
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),

  toggleItemExpanded: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? Object.assign({}, item, { expanded: !item.expanded })
          : item,
      ),
    })),

  // Show/hide an item.  Records the change as a `modify` history entry
  // so navigating to an earlier point in the timeline restores whatever
  // visibility state the scene had at that step.  Mirrors modifyItem's
  // insert-at-active and replay logic so the new row sits next to the
  // currently-selected step and undoable history is preserved.
  toggleItemVisibility: (id) =>
    set((state) => {
      const item = state.items.find((i) => i.id === id);
      if (!item) return {};
      const newVisible = item.visible === false ? true : false;

      // Find the step the new toggle would land immediately AFTER.
      let insertIdx;
      if (state.activeHistoryId !== null) {
        const activeIdx = state.history.findIndex(
          (h) => h.id === state.activeHistoryId,
        );
        insertIdx = activeIdx + 1;
      } else {
        insertIdx = state.history.length;
      }

      // If the immediately-previous step is an OPPOSITE visibility
      // toggle on the same item, two consecutive toggles cancel out —
      // remove the previous step instead of stacking a new one on top.
      // This keeps the timeline free of "Hidden X / Shown X" noise when
      // the user flips a row in the object browser back and forth.
      const prev = insertIdx > 0 ? state.history[insertIdx - 1] : null;
      const prevInst = prev?.instruction;
      const cancels =
        prevInst?.type === "modify" &&
        prevInst.itemId === id &&
        prevInst.patches &&
        Object.keys(prevInst.patches).length === 1 &&
        Object.prototype.hasOwnProperty.call(prevInst.patches, "visible") &&
        prevInst.patches.visible === !newVisible;

      let rawHistory;
      let newActiveId;
      if (cancels) {
        rawHistory = [
          ...state.history.slice(0, insertIdx - 1),
          ...state.history.slice(insertIdx),
        ];
        const newActiveIdx = insertIdx - 2;
        newActiveId =
          newActiveIdx >= 0 && state.activeHistoryId !== null
            ? (rawHistory[newActiveIdx]?.id ?? null)
            : null;
      } else {
        const label = newVisible ? "Shown" : "Hidden";
        const newEntry = makeEntry(label, id, {
          type: "modify",
          itemId: id,
          patches: { visible: newVisible },
        });
        rawHistory = [
          ...state.history.slice(0, insertIdx),
          newEntry,
          ...state.history.slice(insertIdx),
        ];
        newActiveId = state.activeHistoryId !== null ? newEntry.id : null;
      }

      const replayIdx =
        newActiveId !== null
          ? rawHistory.findIndex((h) => h.id === newActiveId)
          : rawHistory.length - 1;
      const items = replayUpTo(rawHistory, replayIdx);

      saveTimeline(rawHistory, newActiveId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(rawHistory),
          activeHistoryId: newActiveId,
        },
        withUndo(state),
      );
    }),

  setItemsHidden: (ids) =>
    set((state) => ({
      items: state.items.map((item) =>
        ids.includes(item.id)
          ? Object.assign({}, item, { visible: false })
          : item,
      ),
    })),

  // Mark items as consumed by a boolean (cut extrude, combine, etc.) so
  // they stay in the data model — the CSG result's regenerator still
  // looks them up by id when rebuilding — but they no longer render and
  // their hidden state survives a timeline replay.  Rewrites each
  // consumed item's CREATE history entry in place rather than adding a
  // new "modify" entry, so the timeline doesn't get cluttered with
  // per-consumption "Hidden X" rows.
  consumeItems: (ids) =>
    set((state) => {
      const idSet = new Set(ids);
      const newHistory = state.history.map((entry) => {
        const inst = entry.instruction;
        if (inst?.type === "create" && idSet.has(inst.item?.id)) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, inst, {
              item: Object.assign({}, inst.item, { visible: false }),
            }),
          });
        }
        return entry;
      });
      const items = state.items.map((item) =>
        idSet.has(item.id) ? Object.assign({}, item, { visible: false }) : item,
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return { items, history: withOrphanFlags(newHistory) };
    }),
});
