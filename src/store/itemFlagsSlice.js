// Per-item UI / visibility flags: tree expand/collapse, show/hide, and
// consume (hide items folded into a boolean/extrude).  Spread into the store
// by createHistorySlice.

import {
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  hideIdsFrom,
  showIdsFrom,
} from "./internals.js";

export const createItemFlagsSlice = (set) => ({
  toggleItemExpanded: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? Object.assign({}, item, { expanded: !item.expanded })
          : item,
      ),
    })),

  // Show/hide an item from the current timeline step onward. This is a
  // visibility-snapshot edit, not a new history entry — it changes
  // `hiddenIds` on the active (or last) entry and every later entry.
  toggleItemVisibility: (id) =>
    set((state) => {
      const item = state.items.find((i) => i.id === id);
      if (!item) return {};
      const entryIdx =
        state.activeHistoryId !== null
          ? state.history.findIndex((h) => h.id === state.activeHistoryId)
          : state.history.length - 1;
      if (entryIdx === -1) return {};
      const currentlyHidden = (
        state.history[entryIdx].hiddenIds || []
      ).includes(id);
      const newHistory = currentlyHidden
        ? showIdsFrom(state.history, entryIdx, [id])
        : hideIdsFrom(state.history, entryIdx, [id]);
      const items = replayUpTo(newHistory, entryIdx);
      saveTimeline(newHistory, state.activeHistoryId);
      return { items, history: withOrphanFlags(newHistory) };
    }),

  // Mark items as consumed by a boolean (cut extrude, combine, etc.) so they
  // stay in the data model — the CSG result's regenerator still looks them
  // up by id when rebuilding — but they no longer render from this timeline
  // step onward (e.g. a multi-area extrude's prisms stay visible at their
  // own createGroup step, then drop out once the following union consumes
  // them).
  consumeItems: (ids) =>
    set((state) => {
      const fromIdx =
        state.activeHistoryId !== null
          ? state.history.findIndex((h) => h.id === state.activeHistoryId)
          : state.history.length - 1;
      const newHistory = hideIdsFrom(state.history, fromIdx, ids);
      const items = replayUpTo(newHistory, fromIdx);
      saveTimeline(newHistory, state.activeHistoryId);
      return { items, history: withOrphanFlags(newHistory) };
    }),
});
