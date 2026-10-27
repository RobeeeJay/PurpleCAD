// Top-level history mutations: every action that creates / modifies /
// deletes an item, or that reorders / undoes / redoes the timeline.

import {
  makeEntry,
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  withUndo,
  relinkSourceChain,
  dirtyEntriesFrom,
  maxItemId,
  inheritedHiddenIds,
  hideIdsFrom,
} from "./internals.js";
import { createHistoryNavSlice } from "./historyNavSlice.js";
import { createItemFlagsSlice } from "./itemFlagsSlice.js";
import { createHistoryEntryEditsSlice } from "./historyEntryEditsSlice.js";
import { createHistoryExtrudeSlice } from "./historyExtrudeSlice.js";
import { splitGeometryComponents } from "../three/geometryComponents.js";
import { LAID_ON_FACE } from "./uiToolReset.js";

// Record a split as ONE "Split" step: the pieces are created in a createGroup
// entry and the original is hidden from that same step on, so the timeline
// shows the body before and its pieces after, and one undo reverses the lot.
// Shared by both kinds of split -- by connected pieces, and by a cut plane.
function commitSplit(state, id, parts) {
  const newEntry = makeEntry("Split", parts[0].id, {
    type: "createGroup",
    items: parts,
    // So the timeline can name the body that was cut rather than count pieces.
    splitFrom: id,
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
  newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);

  const inserted = [
    ...state.history.slice(0, insertIdx),
    newEntry,
    ...state.history.slice(insertIdx),
  ];
  // Hide the original from the split step onward so a timeline replay
  // shows the source before, the pieces after.  Forward-invalidate later
  // steps too (a mid-timeline split shifts the chain — see modifyItem).
  const rawHistory = dirtyEntriesFrom(
    hideIdsFrom(inserted, insertIdx, [id]),
    insertIdx,
  );
  const items = replayUpTo(rawHistory, insertIdx);

  saveTimeline(rawHistory, newActiveId);
  return Object.assign(
    {
      items,
      history: withOrphanFlags(rawHistory),
      activeHistoryId: newActiveId,
      selectedId: parts[0].id,
      selectedIds: parts.map((p) => p.id),
    },
    withUndo(state),
  );
}

export const createHistorySlice = (set) => ({
  ...createHistoryNavSlice(set),
  ...createItemFlagsSlice(set),
  // Per-tool timeline entry edits (chamfer/hole/emboss/… updated in place) and
  // the extrude retarget/depth mutations — split out to keep this file to the
  // core item lifecycle.
  ...createHistoryEntryEditsSlice(set),
  ...createHistoryExtrudeSlice(set),

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
      const fullItem = Object.assign(
        { parentId: null, material: state.defaultMaterial },
        item,
      );
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
      newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);

      // The new item carries the geometry it was created with, so it stays clean;
      // only steps AFTER a mid-timeline insert shift and need rebuilding (an
      // append has nothing after — zero recompute).
      const rawHistory = dirtyEntriesFrom(
        [
          ...state.history.slice(0, insertIdx),
          newEntry,
          ...state.history.slice(insertIdx),
        ],
        insertIdx + 1,
      );
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

  // Create several items in ONE history entry (a "createGroup" step).  Used for
  // a multi-area extrude so its prisms are a single timeline entry rather than N
  // separate ones; the union that fuses them is recorded as its own next entry.
  // Selection is left untouched — the prisms are intermediate (the union that
  // follows consumes them), so we don't yank the gizmo onto a transient prism.
  addItems: (newItems, label = "Added") =>
    set((state) => {
      const fullItems = newItems.map((it) =>
        Object.assign({ parentId: null, material: state.defaultMaterial }, it),
      );
      const newEntry = makeEntry(label, fullItems[0]?.id ?? null, {
        type: "createGroup",
        items: fullItems,
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
      newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);

      // New group carries its created geometry — clean; only later steps rebuild.
      const rawHistory = dirtyEntriesFrom(
        [
          ...state.history.slice(0, insertIdx),
          newEntry,
          ...state.history.slice(insertIdx),
        ],
        insertIdx + 1,
      );
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

  // Store welded copies of meshes that earlier steps created: `byId` maps an
  // item id to its new geometryData.  The surface is identical -- only how the
  // mesh is stored changes -- so this is neither a timeline step nor undoable,
  // and nothing downstream needs rebuilding.  Covers both a single "create"
  // and the pieces of a "createGroup" (a split).  An item a later step has
  // rebuilt (it carries a regenerator) keeps its own geometry.
  replaceCreatedGeometry: (byId) =>
    set((state) => {
      const has = (id) => Object.prototype.hasOwnProperty.call(byId, id);
      let changed = false;
      const history = state.history.map((entry) => {
        const inst = entry.instruction;
        if (inst?.type === "create" && has(inst.item?.id)) {
          changed = true;
          return {
            ...entry,
            instruction: {
              ...inst,
              item: { ...inst.item, geometryData: byId[inst.item.id] },
            },
          };
        }
        if (
          inst?.type === "createGroup" &&
          inst.items?.some((i) => has(i.id))
        ) {
          changed = true;
          return {
            ...entry,
            instruction: {
              ...inst,
              items: inst.items.map((i) =>
                has(i.id) ? { ...i, geometryData: byId[i.id] } : i,
              ),
            },
          };
        }
        return entry;
      });
      if (!changed) return {};
      const items = state.items.map((i) =>
        has(i.id) && !i.regenerator ? { ...i, geometryData: byId[i.id] } : i,
      );
      saveTimeline(history, state.activeHistoryId);
      return { history: withOrphanFlags(history), items };
    }),

  // Record a plane cut: the pieces the Split dialog cut from `id` (already
  // built, with ids).  Each keeps the original's material.  It used to add each
  // half as its own "Added" step and hide the original with no step at all, so
  // the timeline showed no split -- only an ordinary-looking new body.
  splitIntoParts: (id, parts) =>
    set((state) => {
      if (!parts?.length || !state.items.some((i) => i.id === id)) return {};
      return commitSplit(state, id, parts);
    }),

  // Separate a solid into its geometrically-disconnected pieces.  Each
  // connected component (a lump sharing no welded vertices with the others)
  // becomes its own standalone item; the original is consumed (hidden from
  // this step onward) exactly like a boolean hides its inputs.  Symmetric
  // with addItems+consumeItems, recorded as one "Split" createGroup step so
  // it's a single undo.  No-op when the solid is a single connected body.
  splitObject: (id) =>
    set((state) => {
      const item = state.items.find((i) => i.id === id);
      if (!item?.geometryData) return {};
      const components = splitGeometryComponents(item.geometryData);
      if (components.length < 2) return {};

      let maxId = maxItemId(state.history);
      const parts = components.map((geometryData, i) => ({
        id: ++maxId,
        name: `${item.name} part ${i + 1}`,
        type: "csg",
        children: [],
        parentId: null,
        // Each part keeps the original's placement and look — only the mesh is
        // partitioned.  No regenerator: the pieces are independent now.
        position: item.position,
        rotation: item.rotation,
        scale: item.scale,
        material: item.material,
        geometryData,
      }));

      return commitSplit(state, id, parts);
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
      newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);

      // The new step already carries the geometry its tool just computed (the
      // same result the preview showed), so it stays CLEAN — don't recompute it.
      // Only the steps AFTER it need work (insertIdx + 1): re-link their source
      // chain so every later op on this item rebuilds on the newly inserted
      // result, and forward-invalidate them.  An append has nothing after, so
      // both are no-ops (confirm does zero recompute).
      const inserted = [
        ...state.history.slice(0, insertIdx),
        newEntry,
        ...state.history.slice(insertIdx),
      ];
      const rawHistory = dirtyEntriesFrom(
        relinkSourceChain(inserted, id, insertIdx + 1),
        insertIdx + 1,
      );
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

  // Set an object's custom rotation/scale pivot (a point in its local geometry
  // frame).  Recorded as a modify so it survives replay; also clears the origin
  // tool.  Passing null clears the custom origin (back to the bbox centre).
  setItemOrigin: (id, origin) =>
    set((state) => {
      const newEntry = makeEntry("Set origin", id, {
        type: "modify",
        itemId: id,
        patches: { origin },
      });
      let insertIdx, newActiveId;
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
      newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);
      // Forward invalidation for a mid-timeline insert (see modifyItem).
      const rawHistory = dirtyEntriesFrom(
        [
          ...state.history.slice(0, insertIdx),
          newEntry,
          ...state.history.slice(insertIdx),
        ],
        insertIdx,
      );
      const items = replayUpTo(rawHistory, insertIdx);
      saveTimeline(rawHistory, newActiveId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(rawHistory),
          activeHistoryId: newActiveId,
          originToolActive: false,
          originDialogItemId: null,
          originVertexPick: null,
          selectionOverride: null,
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
      newEntry.hiddenIds = inheritedHiddenIds(baseHistory, baseHistory.length);
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
      // Laying a body on a face turns it AND moves it in one step; recording
      // only the position would replay the move with the old rotation.
      const isTurnAndMove = actionLabel === LAID_ON_FACE;
      const instruction = {
        type: "transform",
        itemId: id,
        position:
          !isScaleAction && !isRotateAction
            ? Object.assign({}, item.position)
            : undefined,
        scale: isScaleAction ? Object.assign({}, item.scale) : undefined,
        rotation:
          isRotateAction || isTurnAndMove
            ? Object.assign({}, item.rotation)
            : undefined,
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
        newEntry.hiddenIds = inheritedHiddenIds(state.history, insertIdx);
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
      newEntry.hiddenIds = inheritedHiddenIds(
        state.history,
        state.history.length,
      );
      const rawHistory = [...state.history, newEntry];
      saveTimeline(rawHistory, null);
      return Object.assign(
        { history: withOrphanFlags(rawHistory), activeHistoryId: null },
        withUndo(state),
      );
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
});
