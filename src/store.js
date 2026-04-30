import { create } from "zustand";

// ---------------------------------------------------------------------------
// Instruction application
// ---------------------------------------------------------------------------

const applyInstruction = (items, instruction) => {
  switch (instruction.type) {
    case "scene_created":
      return [];
    case "create":
      return [...items, instruction.item];
    case "delete":
      return items.filter((i) => i.id !== instruction.itemId);
    case "transform":
      return items.map((i) => {
        if (i.id !== instruction.itemId) return i;
        return Object.assign({}, i, {
          position:
            instruction.position !== undefined
              ? instruction.position
              : i.position,
          scale:
            instruction.scale !== undefined ? instruction.scale : i.scale,
          rotation:
            instruction.rotation !== undefined
              ? instruction.rotation
              : i.rotation,
        });
      });
    default:
      return items;
  }
};

const replayUpTo = (history, upToIndex) => {
  let items = [];
  const end = Math.min(upToIndex, history.length - 1);
  for (let i = 0; i <= end; i++) {
    items = applyInstruction(items, history[i].instruction);
  }
  return items;
};

const withOrphanFlags = (history) => {
  let items = [];
  return history.map((entry) => {
    const inst = entry.instruction;
    const orphaned =
      (inst.type === "transform" || inst.type === "delete") &&
      !items.find((i) => i.id === inst.itemId);
    items = applyInstruction(items, inst);
    return Object.assign({}, entry, { _orphaned: orphaned });
  });
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const getSystemTheme = () => {
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
};

let _historyId = 1;
const nextHistoryId = () => _historyId++;

const makeEntry = (label, itemId, instruction) => ({
  id: nextHistoryId(),
  label,
  itemId,
  instruction,
});

const saveTimeline = (history, activeHistoryId) => {
  try {
    localStorage.setItem(
      "cad-timeline",
      JSON.stringify({ history, activeHistoryId }),
    );
  } catch (e) {
    console.warn("Failed to save timeline to localStorage:", e);
  }
};

const loadTimeline = () => {
  try {
    const saved = localStorage.getItem("cad-timeline");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.history) && parsed.history.length > 0) {
        if (parsed.history[0].items !== undefined) {
          localStorage.removeItem("cad-timeline");
          return null;
        }
        const maxId = Math.max(...parsed.history.map((h) => h.id));
        _historyId = maxId + 1;
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load timeline from localStorage:", e);
  }
  return null;
};

const UNDO_LIMIT = 50;

// Per-sketch undo/redo stacks — session-only, never persisted to localStorage.
// Map<sketchId, { undoStack: Array<{shapes, constraints}>, redoStack: Array<{shapes, constraints}> }>
const sketchUndoStacks = new Map();

// Call at the START of every sketch-mutating set() callback (before the mutation)
// to snapshot current shapes/constraints onto the sketch's undo stack.
const pushSketchSnapshot = (state, sketchId) => {
  const item = state.items.find((i) => i.id === sketchId);
  if (!item) return;
  const stacks = sketchUndoStacks.get(sketchId) ?? { undoStack: [], redoStack: [] };
  sketchUndoStacks.set(sketchId, stacks);
  stacks.undoStack = [
    ...stacks.undoStack,
    { shapes: (item.shapes || []).slice(), constraints: (item.constraints || []).slice() },
  ].slice(-UNDO_LIMIT);
  stacks.redoStack = [];
};

export const getSketchUndoState = (sketchId) => {
  const stacks = sketchUndoStacks.get(sketchId);
  return { canUndo: (stacks?.undoStack.length ?? 0) > 0, canRedo: (stacks?.redoStack.length ?? 0) > 0 };
};

// Push current { history, activeHistoryId } onto the undo stack (capped at
// UNDO_LIMIT) and clear the redo stack — call this before every mutating action.
const withUndo = (state) => ({
  undoStack: [
    ...state.undoStack,
    { history: state.history, activeHistoryId: state.activeHistoryId },
  ].slice(-UNDO_LIMIT),
  redoStack: [],
});

const defaultHistory = [
  {
    id: 0,
    label: "Scene created",
    itemId: null,
    instruction: { type: "scene_created" },
    _orphaned: false,
  },
];

const persisted = loadTimeline();

const getInitialItems = () => {
  if (!persisted) return [];
  const targetIdx =
    persisted.activeHistoryId != null
      ? persisted.history.findIndex((h) => h.id === persisted.activeHistoryId)
      : persisted.history.length - 1;
  return replayUpTo(
    persisted.history,
    targetIdx !== -1 ? targetIdx : persisted.history.length - 1,
  );
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create((set) => ({
  items: getInitialItems(),
  selectedId: null,
  selectedIds: [],
  hoveredId: null,
  theme: getSystemTheme(),
  renderMode: "shaded",
  projectionMode: "perspective",
  widgetVisible: true,
  axisVisible: true,
  cameraResetTrigger: 0,
  sketchPlacementMode: false,
  extrudeSelectMode: null, // null | "profile" | "depth"
  extrudeRetargetId: null, // id of the extrude being retargeted, or null
  constraintsVisible: true,
  sketchMultiSelectedIndices: [],

  history: persisted ? withOrphanFlags(persisted.history) : defaultHistory,
  activeHistoryId: persisted ? persisted.activeHistoryId : null,

  undoStack: [],
  redoStack: [],

  reparentItem: (itemId, newParentId) =>
    set((state) => {
      if (itemId === newParentId) return {};
      // Prevent circular: newParentId must not be a descendant of itemId
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
        if (i.id === itemId) return Object.assign({}, i, { parentId: newParentId ?? null });
        if (newParentId !== null && i.id === newParentId) return Object.assign({}, i, { expanded: true });
        return i;
      });
      // Persist parentId into the create history entry so it survives reload
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === itemId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { parentId: newParentId ?? null }),
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

  deleteItem: (id) =>
    set((state) => {
      const deletedItem = state.items.find((item) => item.id === id);
      const baseHistory =
        state.activeHistoryId !== null
          ? state.history.slice(
              0,
              state.history.findIndex(
                (h) => h.id === state.activeHistoryId,
              ) + 1,
            )
          : state.history;

      const newEntry = makeEntry("Deleted", id, {
        type: "delete",
        itemId: id,
      });
      const rawHistory = [...baseHistory, newEntry];
      // Children of deleted item become top-level
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
      return { items, selectedId: null, selectedIds: [], activeHistoryId: newActiveHistoryId };
    }),

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
        rotation: isRotateAction
          ? Object.assign({}, item.rotation)
          : undefined,
      };

      if (state.activeHistoryId !== null) {
        const activeIdx = state.history.findIndex(
          (h) => h.id === state.activeHistoryId,
        );
        const activeEntry = state.history[activeIdx];

        // Merge: update in-place — no new undo snapshot, no redo clear
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

        // Insert new entry — snapshot undo, clear redo
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

      // At end — merge: no snapshot; append: snapshot + clear redo
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
      const items = replayUpTo(rawHistory, activeIdx !== -1 ? activeIdx : rawHistory.length - 1);

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
          ? snapshot.history.findIndex(
              (h) => h.id === snapshot.activeHistoryId,
            )
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
          ? snapshot.history.findIndex(
              (h) => h.id === snapshot.activeHistoryId,
            )
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

  newDocument: () =>
    set((state) => {
      _historyId = 1;
      const freshHistory = [
        {
          id: 0,
          label: "Scene created",
          itemId: null,
          instruction: { type: "scene_created" },
          _orphaned: false,
        },
      ];
      saveTimeline(freshHistory, null);
      localStorage.removeItem("cad-camera-state");
      return {
        items: [],
        history: freshHistory,
        activeHistoryId: null,
        selectedId: null,
        selectedIds: [],
        hoveredId: null,
        undoStack: [],
        redoStack: [],
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
      _historyId = maxId + 1;
      const newActiveHistoryId =
        data.activeHistoryId !== undefined ? data.activeHistoryId : null;
      saveTimeline(data.history, newActiveHistoryId);
      localStorage.removeItem("cad-camera-state");
      const targetIdx =
        newActiveHistoryId !== null
          ? data.history.findIndex((h) => h.id === newActiveHistoryId)
          : data.history.length - 1;
      const items = replayUpTo(
        data.history,
        targetIdx !== -1 ? targetIdx : data.history.length - 1,
      );
      return {
        items,
        history: withOrphanFlags(data.history),
        activeHistoryId: newActiveHistoryId,
        selectedId: null,
        selectedIds: [],
        hoveredId: null,
        undoStack: [],
        redoStack: [],
        cameraResetTrigger: state.cameraResetTrigger + 1,
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

  selectItem: (id) => set({ selectedId: id, selectedIds: id != null ? [id] : [] }),

  addToSelection: (id) =>
    set((state) => {
      if (!id) return { selectedIds: [], selectedId: null };
      const already = state.selectedIds.includes(id);
      if (already) {
        const newIds = state.selectedIds.filter((i) => i !== id);
        return { selectedIds: newIds, selectedId: newIds[0] ?? null };
      }
      const newIds = [...state.selectedIds, id];
      return { selectedIds: newIds, selectedId: state.selectedId ?? id };
    }),
  setHoveredId: (id) => set({ hoveredId: id }),
  activeSketchTool: null,
  setActiveSketchTool: (tool) => set({ activeSketchTool: tool }),

  selectedSketchElement: null, // { type:'point'|'line', shapeIdx, pointKey? }
  setSelectedSketchElement: (el) => set({ selectedSketchElement: el }),

  sketchConstraintMode: null, // 'coincident' | 'distance' | null
  setSketchConstraintMode: (mode) => set({ sketchConstraintMode: mode }),
  sketchDistanceInput: null, // { shapeAIdx, pointA, shapeBIdx, pointB, defaultDistance } | null
  setSketchDistanceInput: (v) => set({ sketchDistanceInput: v }),

  sketchModifyMode: null, // 'chamfer' | 'bevel' | null
  setSketchModifyMode: (mode) => set({ sketchModifyMode: mode }),

  sketchConstraintFirstPoint: null, // { shapeIdx, pointKey } | null
  setSketchConstraintFirstPoint: (pt) => set({ sketchConstraintFirstPoint: pt }),

  addSketchConstraints: (sketchId, newConstraints) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, { constraints: [...(item.constraints || []), ...newConstraints] })
          : item,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { constraints: updatedItem?.constraints }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  updateSketchShapes: (sketchId, updatesMap) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        return Object.assign({}, item, {
          shapes: (item.shapes || []).map((s, i) => updatesMap.has(i) ? updatesMap.get(i) : s),
        });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { shapes: updatedItem?.shapes }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  updateSketchShape: (sketchId, shapeIdx, newShape) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, { shapes: item.shapes.map((s, i) => (i === shapeIdx ? newShape : s)) })
          : item,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { shapes: updatedItem?.shapes }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  addSketchShapes: (sketchId, newShapes, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), ...newShapes],
              constraints: [...(item.constraints || []), ...newConstraints],
            })
          : item,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  addSketchShape: (sketchId, shape, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), shape],
              constraints: [...(item.constraints || []), ...newConstraints],
            })
          : item,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  applySketchModify: (sketchId, shapeUpdatesMap, newShape, removeConstraintPred, addConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shapes = (item.shapes || []).map((s, i) => shapeUpdatesMap.has(i) ? shapeUpdatesMap.get(i) : s);
        shapes.push(newShape);
        const constraints = [
          ...(item.constraints || []).filter((c) => !removeConstraintPred(c)),
          ...addConstraints,
        ];
        return Object.assign({}, item, { shapes, constraints });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  deleteSketchShapes: (sketchId, indicesToDelete) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const deleteSet = new Set(indicesToDelete);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const oldShapes = item.shapes || [];
        const indexMap = new Map();
        let newIdx = 0;
        oldShapes.forEach((_, i) => { indexMap.set(i, deleteSet.has(i) ? -1 : newIdx++); });
        const shapes = oldShapes.filter((_, i) => !deleteSet.has(i));
        const constraints = (item.constraints || [])
          .filter((c) => {
            if (c.type === "onLine") return indexMap.get(c.pointShapeIdx) !== -1 && indexMap.get(c.lineShapeIdx) !== -1;
            if (c.type === "horizontal" || c.type === "vertical") return indexMap.get(c.shapeIdx) !== -1;
            return indexMap.get(c.shapeAIdx) !== -1 && indexMap.get(c.shapeBIdx) !== -1;
          })
          .map((c) => {
            if (c.type === "onLine") return { ...c, pointShapeIdx: indexMap.get(c.pointShapeIdx), lineShapeIdx: indexMap.get(c.lineShapeIdx) };
            if (c.type === "horizontal" || c.type === "vertical") return { ...c, shapeIdx: indexMap.get(c.shapeIdx) };
            return { ...c, shapeAIdx: indexMap.get(c.shapeAIdx), shapeBIdx: indexMap.get(c.shapeBIdx) };
          });
        return Object.assign({}, item, { shapes, constraints });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  undoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.undoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.redoStack = [
        ...stacks.redoStack,
        { shapes: (item.shapes || []).slice(), constraints: (item.constraints || []).slice() },
      ].slice(-UNDO_LIMIT);
      const prev = stacks.undoStack[stacks.undoStack.length - 1];
      stacks.undoStack = stacks.undoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId ? Object.assign({}, i, { shapes: prev.shapes, constraints: prev.constraints }) : i,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes, constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  redoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.redoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.undoStack = [
        ...stacks.undoStack,
        { shapes: (item.shapes || []).slice(), constraints: (item.constraints || []).slice() },
      ].slice(-UNDO_LIMIT);
      const next = stacks.redoStack[stacks.redoStack.length - 1];
      stacks.redoStack = stacks.redoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId ? Object.assign({}, i, { shapes: next.shapes, constraints: next.constraints }) : i,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes, constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  applySketchHVConstraint: (sketchId, shapeIdx, type) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shape = (item.shapes || [])[shapeIdx];
        if (!shape || shape.type !== "line") return item;
        const mid = type === "horizontal"
          ? { y: (shape.y1 + shape.y2) / 2 }
          : { x: (shape.x1 + shape.x2) / 2 };
        const snapped = type === "horizontal"
          ? { ...shape, y1: mid.y, y2: mid.y }
          : { ...shape, x1: mid.x, x2: mid.x };
        const shapes = (item.shapes || []).map((s, i) => (i === shapeIdx ? snapped : s));
        const constraints = [
          ...(item.constraints || []).filter((c) => !((c.type === "horizontal" || c.type === "vertical") && c.shapeIdx === shapeIdx)),
          { type, shapeIdx },
        ];
        return Object.assign({}, item, { shapes, constraints });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  toggleConstraintsVisible: () => set((state) => ({ constraintsVisible: !state.constraintsVisible })),
  setSketchMultiSelectedIndices: (v) => set({ sketchMultiSelectedIndices: v }),

  toggleSketchShapesDashed: (sketchId, indices) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const idxSet = new Set(indices);
        const oldShapes = item.shapes || [];
        const allDashed = indices.every((i) => oldShapes[i]?.dashed);
        const shapes = oldShapes.map((s, i) => {
          if (!idxSet.has(i)) return s;
          return { ...s, dashed: allDashed ? false : true };
        });
        return Object.assign({}, item, { shapes });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { shapes: updatedItem?.shapes }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  updateSketchConstraintDistance: (sketchId, constraintIdx, newDistance) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const constraints = (item.constraints || []).map((c, i) =>
          i === constraintIdx && c.type === "distance" ? Object.assign({}, c, { distance: newDistance }) : c,
        );
        return Object.assign({}, item, { constraints });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === sketchId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, { constraints: updatedItem?.constraints }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  setSketchPlacementMode: (active) => set({ sketchPlacementMode: active }),
  setExtrudeSelectMode: (mode) => set({ extrudeSelectMode: mode }),
  setExtrudeRetargetId: (id) => set({ extrudeRetargetId: id }),

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
        if (entry.instruction?.type === "create" && entry.instruction.item?.id === extrudeId) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, { item: updatedItem }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return { ...withUndo(state), items: updatedItems, history: withOrphanFlags(newHistory) };
    }),
  setRenderMode: (mode) => set({ renderMode: mode }),
  setProjectionMode: (mode) => set({ projectionMode: mode }),

  toggleProjectionMode: () =>
    set((state) => ({
      projectionMode:
        state.projectionMode === "perspective" ? "isometric" : "perspective",
    })),

  toggleItemExpanded: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? Object.assign({}, item, { expanded: !item.expanded })
          : item,
      ),
    })),

  toggleItemVisibility: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? Object.assign({}, item, { visible: item.visible === false ? true : false })
          : item,
      ),
    })),

  setItemsHidden: (ids) =>
    set((state) => ({
      items: state.items.map((item) =>
        ids.includes(item.id) ? Object.assign({}, item, { visible: false }) : item,
      ),
    })),

  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),

  toggleWidgetVisibility: () =>
    set((state) => ({
      widgetVisible: !state.widgetVisible,
    })),

  toggleAxisVisibility: () =>
    set((state) => ({
      axisVisible: !state.axisVisible,
    })),
}));
