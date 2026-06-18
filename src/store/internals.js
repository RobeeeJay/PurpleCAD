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
    // A single timeline step that creates several items at once (e.g. the
    // prisms of a multi-area extrude, before they fuse into one union).
    case "createGroup":
      return [...items, ...(instruction.items || [])];
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

// Highest item id ever assigned across the whole history, including
// "createGroup" entries (multi-area extrude prisms) — `id + 1` is safe to
// hand out for a new item.  Missing the createGroup case lets a fresh item
// collide with an existing prism's id, and applyInstruction's id-keyed
// "transform"/"modify" .map then mutates BOTH items at once.
export const maxItemId = (history) => {
  let maxId = 0;
  history.forEach((entry) => {
    const inst = entry.instruction;
    if (inst?.type === "create" && inst.item?.id > maxId) maxId = inst.item.id;
    if (inst?.type === "createGroup")
      inst.items?.forEach((it) => {
        if (it.id > maxId) maxId = it.id;
      });
  });
  return maxId;
};

export const replayUpTo = (history, upToIndex) => {
  let items = [];
  const end = Math.min(upToIndex, history.length - 1);
  for (let i = 0; i <= end; i++) {
    items = applyInstruction(items, history[i].instruction);
  }
  // Per-step visibility snapshot: hiddenIds can hide an item but never
  // un-hides one whose own snapshot already says visible:false (consumed
  // items recorded before this model existed).
  const hiddenIds = end >= 0 ? history[end]?.hiddenIds || [] : [];
  if (hiddenIds.length === 0) return items;
  return items.map((item) =>
    hiddenIds.includes(item.id)
      ? Object.assign({}, item, { visible: false })
      : item,
  );
};

// The set of hidden item ids a freshly-inserted entry should start from —
// inherited from the entry it's being inserted after.
export const inheritedHiddenIds = (history, insertIdx) =>
  insertIdx > 0 ? history[insertIdx - 1].hiddenIds || [] : [];

// Add `ids` to hiddenIds for every entry from `fromIdx` onward (inclusive) —
// used when a step consumes inputs into a result, or the user hides an item
// from this point in the timeline forward.
export const hideIdsFrom = (history, fromIdx, ids) => {
  if (!ids.length) return history;
  return history.map((entry, idx) => {
    if (idx < fromIdx) return entry;
    const hidden = new Set(entry.hiddenIds || []);
    let changed = false;
    ids.forEach((id) => {
      if (!hidden.has(id)) {
        hidden.add(id);
        changed = true;
      }
    });
    return changed ? { ...entry, hiddenIds: [...hidden] } : entry;
  });
};

// Inverse of hideIdsFrom — removes `ids` from hiddenIds from `fromIdx` onward.
export const showIdsFrom = (history, fromIdx, ids) => {
  if (!ids.length) return history;
  return history.map((entry, idx) => {
    if (idx < fromIdx) return entry;
    const hidden = new Set(entry.hiddenIds || []);
    let changed = false;
    ids.forEach((id) => {
      if (hidden.delete(id)) changed = true;
    });
    return changed ? { ...entry, hiddenIds: [...hidden] } : entry;
  });
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
        if (
          parsed.history[0].items !== undefined ||
          parsed.history[0].hiddenIds === undefined
        ) {
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

// Tree-view folders are purely organizational (no geometry, not part of the
// undo/redo timeline) so they're persisted separately from history.
export const loadFolders = () => {
  try {
    const raw = localStorage.getItem("cad-folders");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn("Failed to load folders from localStorage:", e);
  }
  return [];
};

export const saveFolders = (folders) => {
  try {
    localStorage.setItem("cad-folders", JSON.stringify(folders));
  } catch (e) {
    console.warn("Failed to save folders to localStorage:", e);
  }
};

// Default material (applied to newly-created objects) + user-saved presets,
// persisted together under one key so the Material dialog survives reload.
export const loadMaterialSettings = () => {
  try {
    const raw = localStorage.getItem("cad-material");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        defaultMaterial: parsed.defaultMaterial ?? null,
        materialPresets: Array.isArray(parsed.materialPresets)
          ? parsed.materialPresets
          : [],
      };
    }
  } catch (e) {
    console.warn("Failed to load material settings from localStorage:", e);
  }
  return { defaultMaterial: null, materialPresets: [] };
};

export const saveMaterialSettings = (defaultMaterial, materialPresets) => {
  try {
    localStorage.setItem(
      "cad-material",
      JSON.stringify({ defaultMaterial, materialPresets }),
    );
  } catch (e) {
    console.warn("Failed to save material settings to localStorage:", e);
  }
};

// Mark every CSG/chamfer regenerator stale so the next regenerate pass rebuilds
// it from its (now-changed) inputs.  Called after a sketch edit so downstream
// extruded/cut/bevelled geometry recalculates to the current sketch.  Returns
// the same array reference when nothing changed (no regenerators present).
// Rewrite the stored CREATE record of a single item `id` in a history entry.
// `apply(item)` returns the replacement; non-matching entries pass through.
// (Multi-area groups are edited as a unit via dedicated group actions, so this
// only needs to cover the standalone `create` case.)
export const rewriteCreatedItem = (entry, id, apply) => {
  const inst = entry.instruction;
  if (inst?.type === "create" && inst.item?.id === id) {
    return { ...entry, instruction: { ...inst, item: apply(inst.item) } };
  }
  return entry;
};

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

// Viewport + snap preferences (the Settings dialog).  `fov` is the perspective
// camera's vertical field of view in degrees — lower = flatter / less
// perspective.  Persisted alongside snap under the same `cad-snap` key.
// Viewport + snap preferences (the Settings dialog).  `fov` is the perspective
// camera's vertical field of view in degrees — lower = flatter / less
// perspective.  `curveDetectionAngleDeg` is the max bend between consecutive
// connected lines for them to be treated as one smooth curve when highlighting.
// Persisted alongside snap under the same `cad-snap` key.
// previewPrecisionMm / printPrecisionMm are the tessellation deviation (sagitta,
// mm) for the two resolution modes — lower = denser/smoother, more triangles.
// Preview is the interactive/editing density; print ("Normal/High") is the
// final density used when the resolution toggle is on.
const SNAP_DEFAULTS = {
  snapEnabled: false,
  snapDistanceMm: 5,
  snapAngleDeg: 9,
  fov: 35,
  curveDetectionAngleDeg: 5,
  previewPrecisionMm: 0.5,
  printPrecisionMm: 0.01,
  alwaysExtrudeSingleObject: true,
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
      fov: parsed.fov > 0 ? parsed.fov : 35,
      curveDetectionAngleDeg:
        parsed.curveDetectionAngleDeg >= 0 ? parsed.curveDetectionAngleDeg : 5,
      previewPrecisionMm:
        parsed.previewPrecisionMm > 0 ? parsed.previewPrecisionMm : 0.5,
      printPrecisionMm:
        parsed.printPrecisionMm > 0 ? parsed.printPrecisionMm : 0.01,
      // Default on (combine) — only an explicit false turns it off.
      alwaysExtrudeSingleObject: parsed.alwaysExtrudeSingleObject !== false,
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
        fov: snap.fov,
        curveDetectionAngleDeg: snap.curveDetectionAngleDeg,
        previewPrecisionMm: snap.previewPrecisionMm,
        printPrecisionMm: snap.printPrecisionMm,
        alwaysExtrudeSingleObject: snap.alwaysExtrudeSingleObject,
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
    hiddenIds: [],
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
