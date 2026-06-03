// Shared helpers used by every slice in src/store/.
//
// Historically all of this lived inline at the top of store.js.  Pulling
// it into a separate file (and the slice files that compose into the
// final store) keeps each slice under the 800-line target without
// changing semantics: every helper here is pure or operates on the
// module-local singletons defined below.

// ---------------------------------------------------------------------------
// Instruction application
// ---------------------------------------------------------------------------

export const applyInstruction = (items, instruction) => {
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
          scale: instruction.scale !== undefined ? instruction.scale : i.scale,
          rotation:
            instruction.rotation !== undefined
              ? instruction.rotation
              : i.rotation,
        });
      });
    case "modify":
      return items.map((i) => {
        if (i.id !== instruction.itemId) return i;
        return Object.assign({}, i, instruction.patches);
      });
    default:
      return items;
  }
};

export const replayUpTo = (history, upToIndex) => {
  let items = [];
  const end = Math.min(upToIndex, history.length - 1);
  for (let i = 0; i <= end; i++) {
    items = applyInstruction(items, history[i].instruction);
  }
  return items;
};

export const withOrphanFlags = (history) => {
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
// Persistence helpers + history-id generator
// ---------------------------------------------------------------------------

export const getSystemTheme = () => {
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
};

// Module-local counter shared by every slice that mints history entries.
let _historyId = 1;
export const nextHistoryId = () => _historyId++;
// Slices that bulk-import a saved document need to reset / advance this.
export const setNextHistoryId = (id) => {
  _historyId = id;
};

export const makeEntry = (label, itemId, instruction) => ({
  id: nextHistoryId(),
  label,
  itemId,
  instruction,
});

export const saveTimeline = (history, activeHistoryId) => {
  try {
    localStorage.setItem(
      "cad-timeline",
      JSON.stringify({ history, activeHistoryId }),
    );
  } catch (e) {
    console.warn("Failed to save timeline to localStorage:", e);
  }
};

export const loadTimeline = () => {
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
        setNextHistoryId(maxId + 1);
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load timeline from localStorage:", e);
  }
  return null;
};

export const saveVariables = (variables) => {
  try {
    localStorage.setItem("cad-variables", JSON.stringify(variables));
  } catch (e) {
    console.warn("Failed to save variables to localStorage:", e);
  }
};

// Mark every CSG/chamfer regenerator stale so the next regenerate pass rebuilds
// it from its (now-changed) inputs.  Called after a sketch edit so downstream
// extruded/cut/bevelled geometry recalculates to the current sketch.  Returns
// the same array reference when nothing changed (no regenerators present).
export const markCsgDirty = (items) => {
  let changed = false;
  const out = items.map((item) => {
    if (item.type !== "csg" || !item.regenerator) return item;
    if (item.regenerator.regeneratedAt === "dirty") return item;
    changed = true;
    return {
      ...item,
      regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
    };
  });
  return changed ? out : items;
};

const SNAP_DEFAULTS = {
  snapEnabled: false,
  snapDistanceMm: 5,
  snapAngleDeg: 9,
};

export const loadSnapSettings = () => {
  try {
    const raw = localStorage.getItem("cad-snap");
    if (!raw) return { ...SNAP_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      snapEnabled: !!parsed.snapEnabled,
      snapDistanceMm: parsed.snapDistanceMm > 0 ? parsed.snapDistanceMm : 5,
      snapAngleDeg: parsed.snapAngleDeg > 0 ? parsed.snapAngleDeg : 9,
    };
  } catch {
    return { ...SNAP_DEFAULTS };
  }
};

export const saveSnapSettings = (snap) => {
  try {
    localStorage.setItem(
      "cad-snap",
      JSON.stringify({
        snapEnabled: snap.snapEnabled,
        snapDistanceMm: snap.snapDistanceMm,
        snapAngleDeg: snap.snapAngleDeg,
      }),
    );
  } catch (e) {
    console.warn("Failed to save snap settings to localStorage:", e);
  }
};

export const loadVariables = () => {
  try {
    const raw = localStorage.getItem("cad-variables");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn("Failed to load variables from localStorage:", e);
  }
  return [];
};

// ---------------------------------------------------------------------------
// Undo bookkeeping (top-level + per-sketch)
// ---------------------------------------------------------------------------

export const UNDO_LIMIT = 50;

// Per-sketch undo/redo stacks — session-only, never persisted.
//   Map<sketchId, { undoStack, redoStack }>
export const sketchUndoStacks = new Map();

// Call at the START of every sketch-mutating set() callback (before the
// mutation) to snapshot current shapes/constraints onto the sketch's
// undo stack.
export const pushSketchSnapshot = (state, sketchId) => {
  const item = state.items.find((i) => i.id === sketchId);
  if (!item) return;
  const stacks = sketchUndoStacks.get(sketchId) ?? {
    undoStack: [],
    redoStack: [],
  };
  sketchUndoStacks.set(sketchId, stacks);
  stacks.undoStack = [
    ...stacks.undoStack,
    {
      shapes: (item.shapes || []).slice(),
      constraints: (item.constraints || []).slice(),
    },
  ].slice(-UNDO_LIMIT);
  stacks.redoStack = [];
};

// Push current { history, activeHistoryId } onto the undo stack (capped
// at UNDO_LIMIT) and clear the redo stack — call this before every
// mutating action that should be undoable.
export const withUndo = (state) => ({
  undoStack: [
    ...state.undoStack,
    { history: state.history, activeHistoryId: state.activeHistoryId },
  ].slice(-UNDO_LIMIT),
  redoStack: [],
});

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export const defaultHistory = [
  {
    id: 0,
    label: "Scene created",
    itemId: null,
    instruction: { type: "scene_created" },
    _orphaned: false,
  },
];

// Read once at module-load.  Slices that need to know whether anything
// was persisted re-read this from inside `getInitialState`.
export const persisted = loadTimeline();

export const getInitialItems = () => {
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
