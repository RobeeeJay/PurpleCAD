// Top-level history mutations: every action that creates / modifies /
// deletes an item, or that reorders / undoes / redoes the timeline.

import {
  makeEntry,
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  withUndo,
  markCsgDirty,
  rewriteCreatedItem,
  commitEntryEdit,
  relinkSourceChain,
  dirtyEntriesFrom,
  dirtyAllEntries,
  maxItemId,
  inheritedHiddenIds,
  hideIdsFrom,
} from "./internals.js";
import { createHistoryNavSlice } from "./historyNavSlice.js";
import { createItemFlagsSlice } from "./itemFlagsSlice.js";
import {
  buildBrushTransform,
  shiftUnionAnchorForRetarget,
} from "../three/csgUtils.js";
import { splitGeometryComponents } from "../three/geometryComponents.js";

export const createHistorySlice = (set) => ({
  ...createHistoryNavSlice(set),
  ...createItemFlagsSlice(set),

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

      const newEntry = makeEntry("Split", parts[0].id, {
        type: "createGroup",
        items: parts,
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

  // Update the amount / angleRad on an existing chamfer-or-fillet history
  // entry, then replay history so the regenerator reflects the new values.
  // `regeneratedAt` is reset (different from any valid printPrecision) and
  // `geometryData` is cleared so regenerateItemsForResolution's skip-check
  // misses, forcing a fresh tessellation with the new parameters.
  // Replace a committed chamfer/fillet entry's FULL payload in place — the
  // overlay Edit flow's commit (re-picked selection and/or new params, with the
  // freshly computed geometry).  Downstream sources relink; the entry itself
  // stays clean (its payload is fresh — see commitEntryEdit).
  updateChamferEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "chamfer") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches,
          },
        };
      });
      const relinked = commitEntryEdit(newHistory, entryId);
      // Editing views the PRE-chamfer step (beginChamferEdit) — land back on
      // the edited entry so the freshly committed result is what's on screen
      // (null = the tip, matching restoreToHistory's convention).
      const activeIdx = relinked.findIndex((h) => h.id === entryId);
      const newActive = activeIdx === relinked.length - 1 ? null : entryId;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, newActive);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
          activeHistoryId: newActive,
        },
        withUndo(state),
      );
    }),

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
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
        },
        withUndo(state),
      );
    }),

  // Update the distance on an existing push/pull history entry, then replay so
  // the regenerator rebuilds with the new value.  Mirrors updateChamferParams:
  // `regeneratedAt` is reset and `geometryData` cleared so the skip-check in
  // regenerateItemsForResolution misses and re-tessellates.
  updatePushPullParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "pushpull") return entry;
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
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Edit a committed shell's wall thickness from its timeline step.  Mirrors
  // updatePushPullParams: mark the regenerator dirty + clear geometry so the
  // regen orchestrator rebuilds it at the new thickness.
  updateShellParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "shell") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              regenerator: { ...r, ...params, regeneratedAt: "dirty" },
              geometryData: null,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Update a committed hole step in place with re-edited params (geometry
  // already rebuilt by commitHole).  `patch` = { hole, position, centerOffset,
  // geometryData, regeneratedAt }.
  updateHoleEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "hole") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: {
                ...r,
                hole: patch.hole,
                centerOffset: patch.centerOffset,
                basePosition: patch.basePosition,
                regeneratedAt: patch.regeneratedAt,
              },
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Update a committed emboss step in place with re-edited params (geometry +
  // stamp already rebuilt by commitEmboss).  `patch` = { regenerator, position,
  // geometryData }.
  updateEmbossEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "emboss") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: patch.regenerator,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      // Editing views the PRE-emboss step (beginEmbossEdit) — land back on the
      // edited entry so the freshly committed result is what's on screen (null
      // = the tip, matching restoreToHistory's convention).
      const activeIdx = relinked.findIndex((h) => h.id === entryId);
      const newActive = activeIdx === relinked.length - 1 ? null : entryId;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, newActive);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
          activeHistoryId: newActive,
        },
        withUndo(state),
      );
    }),

  // Edit a committed draft step in place (angle/flip/faces changed, geometry
  // already rebuilt).  Mirrors updateEmbossEntry.
  updateDraftEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "draft") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: patch.regenerator,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Update an existing push/pull history entry's patches in place — used by
  // PushPullOverlay's retarget confirm (geometry already rebuilt against the
  // new face selection).
  retargetPushPullEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "pushpull") return entry;
        return { ...entry, instruction: { ...inst, patches } };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Update a revolve (sweep) step's parameters.  A revolve is a CREATE entry
  // (it adds a new solid), so its recipe lives on inst.item, not inst.patches.
  updateRevolveParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        const r = inst.item?.regenerator;
        if (r?.kind !== "revolve") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            item: {
              ...inst.item,
              regenerator: { ...r, ...params, regeneratedAt: "dirty" },
              geometryData: null,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Replace a revolve step's item recipe in place (re-picked profile/axis) —
  // used by the sweep retarget confirm.  `patches` carries the new regenerator,
  // geometryData and position to merge onto the CREATE entry's item.
  retargetRevolveEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "revolve") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Pipe and loft are CREATE entries like revolve, but with no editable
  // parameters — only re-picking their inputs.  Mirrors retargetRevolveEntry.
  retargetPipeEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "pipe") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  retargetLoftEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "loft") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),

  // Update an existing chamfer-or-fillet history entry's patches in place
  // (position/regenerator/geometryData), without inserting a new entry —
  // used by BevelSection's retarget(), which has already rebuilt the
  // geometry and just needs the timeline step to point at the new result.

  retargetExtrude: (extrudeId, newProfile, newDepth, startOffset = 0) =>
    set((state) => {
      const apply = (item) =>
        Object.assign({}, item, {
          profile: newProfile,
          depth: newDepth,
          // A zero offset is the default; persist it so retargeting can also
          // clear a previously-set start offset.
          startOffset: startOffset || undefined,
          position: newProfile.position,
          rotation: newProfile.rotation,
        });
      // If this prism anchors a union (it's `inputIds[0]` of a boolean
      // regenerator), the union's re-localisation anchor must move with it —
      // see shiftUnionAnchorForRetarget.
      const oldExtrude = state.items.find((item) => item.id === extrudeId);
      const delta =
        oldExtrude?.type === "extrude"
          ? (() => {
              const before = buildBrushTransform(oldExtrude).position;
              const after = buildBrushTransform(apply(oldExtrude)).position;
              return {
                x: after.x - before.x,
                y: after.y - before.y,
                z: after.z - before.z,
              };
            })()
          : null;
      const shiftAnchors = (item) =>
        delta ? shiftUnionAnchorForRetarget(item, extrudeId, delta) : item;
      // markCsgDirty: a retargeted prism may feed a union (a boss, or one of a
      // multi-area extrude's prisms), which must rebuild against the new profile.
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          item.id === extrudeId ? apply(item) : shiftAnchors(item),
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) => {
          const rewritten = rewriteCreatedItem(entry, extrudeId, apply);
          if (rewritten !== entry) return rewritten;
          const inst = entry.instruction;
          if (inst?.type === "create" && inst.item?.regenerator) {
            const next = shiftAnchors(inst.item);
            if (next !== inst.item)
              return { ...entry, instruction: { ...inst, item: next } };
          }
          if (inst?.type === "modify" && inst.patches?.regenerator) {
            const next = shiftAnchors(inst.patches);
            if (next !== inst.patches)
              return { ...entry, instruction: { ...inst, patches: next } };
          }
          return entry;
        }),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),

  // Edit an extrude's depth in place: rewrite its CREATE entry rather than
  // appending a "Modified" step, and dirty downstream CSG so the regen pass
  // recalculates the timeline at the new depth (mirrors how setVariables
  // edits a sketch's create entry).
  setExtrudeDepth: (id, depth) =>
    set((state) => {
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          item.id === id ? Object.assign({}, item, { depth }) : item,
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) =>
          rewriteCreatedItem(entry, id, (item) =>
            Object.assign({}, item, { depth }),
          ),
        ),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),

  // Set ONE distance on every prism of a multi-area extrude group at once —
  // the group is resized as a unit, not per-prism.
  setExtrudeGroupDepth: (ids, depth) =>
    set((state) => {
      const idSet = new Set(ids);
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          idSet.has(item.id) ? Object.assign({}, item, { depth }) : item,
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) => {
          const inst = entry.instruction;
          if (
            inst?.type === "createGroup" &&
            inst.items?.some((it) => idSet.has(it.id))
          ) {
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                items: inst.items.map((it) =>
                  idSet.has(it.id) ? Object.assign({}, it, { depth }) : it,
                ),
              }),
            });
          }
          return entry;
        }),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),

  // Retarget a whole multi-area extrude group to a new set of profiles.  The
  // group's createGroup step is rebuilt to one prism per new profile (reusing
  // the old prism ids where possible, allocating fresh ones for added regions),
  // and the downstream union's inputIds are swapped to the new prisms (host
  // solids in its inputs are kept).  Marking it dirty makes the regen pass
  // rebuild the fused body.  Replaying the rewritten history reconciles
  // added/removed prisms in the live scene without leaving orphans.
  retargetGroup: (oldPrismIds, newProfiles, depth, startOffset = 0) =>
    set((state) => {
      const oldSet = new Set(oldPrismIds);
      let maxId = maxItemId(state.history);
      const newPrisms = newProfiles.map((profile, i) => {
        const id = i < oldPrismIds.length ? oldPrismIds[i] : ++maxId;
        return {
          id,
          name: `Extrude ${id}`,
          type: "extrude",
          children: [],
          parentId: null,
          profile,
          depth,
          ...(startOffset ? { startOffset } : null),
          position: profile.position,
          rotation: profile.rotation,
          scale: { x: 1, y: 1, z: 1 },
        };
      });
      const newIds = newPrisms.map((p) => p.id);
      // Swap the dropped prism ids for the kept set inside ANY boolean inputIds
      // reachable from a regenerator — the union itself, but also the boolean
      // buried in a chamfer / fillet's frozen `source` snapshot (and chained
      // chamfers, which nest source-within-source).  Without this a chamfer on
      // the union rebuilds its source at the OLD region count and keeps showing
      // the dropped region.  Returns the same ref when nothing changed.
      const rewriteRegen = (regen) => {
        if (!regen) return regen;
        let next = regen;
        if (
          regen.kind === "boolean" &&
          (regen.inputIds || []).some((id) => oldSet.has(id))
        ) {
          const hosts = (regen.inputIds || []).filter((id) => !oldSet.has(id));
          next = {
            ...next,
            inputIds: [...newIds, ...hosts],
            regeneratedAt: "dirty",
          };
        }
        if (next.source?.regenerator) {
          const srcRegen = rewriteRegen(next.source.regenerator);
          if (srcRegen !== next.source.regenerator) {
            next = {
              ...next,
              source: { ...next.source, regenerator: srcRegen },
              regeneratedAt: "dirty",
            };
          }
        }
        return next;
      };
      const newHistory = state.history.map((entry) => {
        const inst = entry.instruction;
        if (
          inst?.type === "createGroup" &&
          inst.items?.some((it) => oldSet.has(it.id))
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, inst, { items: newPrisms }),
          });
        }
        if (inst?.type === "create" && inst.item?.regenerator) {
          const nr = rewriteRegen(inst.item.regenerator);
          if (nr !== inst.item.regenerator)
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                item: Object.assign({}, inst.item, { regenerator: nr }),
              }),
            });
        }
        if (inst?.type === "modify" && inst.patches?.regenerator) {
          const nr = rewriteRegen(inst.patches.regenerator);
          if (nr !== inst.patches.regenerator)
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                patches: Object.assign({}, inst.patches, { regenerator: nr }),
              }),
            });
        }
        return entry;
      });
      // Old prism ids may appear in later entries' hiddenIds (the union step
      // onward, since the union consumes them) — swap them for the new ids
      // so the retargeted prisms stay hidden from the same step.
      const finalHistory = newHistory.map((entry) => {
        const hidden = entry.hiddenIds || [];
        if (!hidden.some((id) => oldSet.has(id))) return entry;
        const kept = hidden.filter((id) => !oldSet.has(id));
        return { ...entry, hiddenIds: [...new Set([...kept, ...newIds])] };
      });
      const dirtied = dirtyAllEntries(finalHistory);
      const activeIdx =
        state.activeHistoryId !== null
          ? dirtied.findIndex((h) => h.id === state.activeHistoryId)
          : dirtied.length - 1;
      const items = markCsgDirty(replayUpTo(dirtied, activeIdx));
      saveTimeline(dirtied, state.activeHistoryId);
      return {
        ...withUndo(state),
        items,
        history: withOrphanFlags(dirtied),
      };
    }),
});
