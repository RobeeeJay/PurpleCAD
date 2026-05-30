// Per-item UI / visibility flags: tree expand/collapse, show/hide, and
// consume (hide items folded into a boolean/extrude).  Spread into the store
// by createHistorySlice.

import {
  makeEntry,
  replayUpTo,
  withUndo,
  withOrphanFlags,
  saveTimeline,
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
