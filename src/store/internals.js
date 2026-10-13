// Shared helpers used by every slice in src/store/.
//
// Historically all of this lived inline at the top of store.js.  Pulling
// it into a separate file (and the slice files that compose into the
// final store) keeps each slice under the 800-line target without
// changing semantics: every helper here is pure or operates on the
// module-local singletons defined below.

// Persistence goes through the project-aware db facade (normalised SQLite in
// Electron, localStorage in a plain browser, in-memory under tests) rather than
// touching localStorage here.  Everything here operates on the active project.
import * as db from "./db.js";
import { packHistory } from "./geometryPack.js";
import { pruneNestedSourceGeometry } from "../three/textureDisplace.js";
import { backfillSplitRecipes } from "../three/splitRecipe.js";

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

// ── Per-entry cache invalidation (JIT timeline model) ──────────────────────
// Each history entry owns its cache validity via a single `dirty` flag:
// `dirty === true` means the geometry this entry produced is stale for the
// current state/precision and must be recomputed before the entry's result is
// shown or fed to a later entry.  These pure helpers set the flag following the
// spec's forward-invalidation rules; the JIT evaluator clears it when it
// recomputes the entry.

// Mark every entry from index `from` (inclusive) onward dirty.  Returns the same
// array when nothing changed so callers can skip a store update.
export const dirtyEntriesFrom = (history, from) => {
  const start = Math.max(0, from);
  let changed = false;
  const out = history.map((e, i) => {
    if (i < start || e.dirty) return e;
    changed = true;
    return { ...e, dirty: true };
  });
  return changed ? out : history;
};

// Resolution toggle invalidates the whole timeline.
export const dirtyAllEntries = (history) => dirtyEntriesFrom(history, 0);

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

// Re-derive the `regenerator.source` of each in-place op (chamfer/emboss/…) on
// `itemId` from the item's accumulated state just BEFORE that step, for every
// step at or after `fromIndex`.  Each op modifies the item in place, so its
// frozen source is a snapshot of the previous step's result — when a middle op
// is deleted, downstream sources still embed it (the emboss keeps rebuilding a
// removed chamfer).  Walking the surviving history and re-pointing each source
// at the live upstream state splices the deleted layer out of the whole chain
// (nested sources included, since each source is rebuilt from the corrected
// earlier state).  Marks the re-pointed steps dirty so the recalc rebuilds them.
export const relinkSourceChain = (history, itemId, fromIndex = 0) => {
  let acc = null; // the item's accumulated state as we walk
  let changed = false;
  const out = history.map((entry, idx) => {
    const inst = entry.instruction;
    if (inst?.type === "create" && inst.item?.id === itemId) {
      acc = inst.item;
      return entry;
    }
    if (inst?.type === "createGroup") {
      const found = (inst.items || []).find((it) => it.id === itemId);
      if (found) acc = found;
      return entry;
    }
    if (inst?.type === "delete" && inst.itemId === itemId) {
      acc = null;
      return entry;
    }
    if (inst?.type === "transform" && inst.itemId === itemId && acc) {
      acc = applyInstruction([acc], inst)[0];
      return entry;
    }
    if (inst?.type === "modify" && inst.itemId === itemId) {
      const patches = inst.patches;
      if (idx >= fromIndex && acc && patches?.regenerator?.source) {
        const regen = patches.regenerator;
        const newPatches = {
          ...patches,
          regenerator: { ...regen, source: acc, regeneratedAt: "dirty" },
        };
        acc = Object.assign({}, acc, newPatches);
        changed = true;
        return { ...entry, instruction: { ...inst, patches: newPatches } };
      }
      if (acc) acc = Object.assign({}, acc, patches);
      return entry;
    }
    return entry;
  });
  return changed ? out : history;
};

// After editing/retargeting one timeline entry (`entryId`), re-derive the
// sources of any LATER ops on that same item so a downstream op (an emboss on
// top of a chamfer, say) rebuilds against the EDITED upstream result instead of
// the stale snapshot it froze at creation.  A no-op when nothing downstream
// references the item.  Returns the same array when unchanged.
export const relinkAfterEntryEdit = (history, entryId) => {
  const idx = history.findIndex((h) => h.id === entryId);
  if (idx < 0) return history;
  const inst = history[idx].instruction;
  const itemId =
    inst?.type === "modify"
      ? inst.itemId
      : inst?.type === "create"
        ? inst.item?.id
        : null;
  if (itemId == null) return history;
  return relinkSourceChain(history, itemId, idx + 1);
};

// Commit an entry edit: relink downstream frozen sources (so a later op rebuilds
// against the edited result) and mark every LATER entry dirty (forward
// invalidation).  The edited entry itself is NOT flagged — its own payload
// decides: a full-payload update (updateEmbossEntry, retargetPushPullEntry, …)
// carries freshly-computed geometry + regeneratedAt, so recomputing it would
// re-run the exact op Confirm just ran; a param-only edit (updateChamferParams,
// …) stamps regeneratedAt:"dirty" + clears geometryData, which already fails
// entryCacheValid and recomputes.  Flagging the entry regardless (the old
// behaviour) doubled every edit/retarget's OCC work.
export const commitEntryEdit = (history, entryId) => {
  const relinked = relinkAfterEntryEdit(history, entryId);
  const idx = relinked.findIndex((h) => h.id === entryId);
  return idx < 0 ? relinked : dirtyEntriesFrom(relinked, idx + 1);
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
    // `dirty` is transient runtime cache state (JIT timeline model) — never
    // persist it; a reload trusts the stored per-entry geometry until something
    // invalidates it.
    const persisted = packHistory(
      history.map((e) => (e.dirty ? (({ dirty, ...rest }) => rest)(e) : e)),
    );
    db.saveTimeline({ history: persisted, activeHistoryId });
  } catch (e) {
    console.warn("Failed to save timeline to storage:", e);
  }
};

// One-time migration for saved documents from before the emboss authored-frame
// record existed: derive sourceCenterOffset from the STILL-FROZEN source (at
// load time it is the authored one — a later relink would replace it, which is
// exactly why this must run at load).  Without it, reordering/deleting a step
// around an old emboss shifts the relief by the source-frame delta.
export const backfillEmbossFrames = (history) =>
  history.map((e) => {
    const inst = e.instruction;
    const holder =
      inst?.type === "modify"
        ? inst.patches
        : inst?.type === "create"
          ? inst.item
          : null;
    const r = holder?.regenerator;
    if (!r || r.kind !== "emboss" || r.sourceCenterOffset) return e;
    const off = r.source?.regenerator?.centerOffset ?? { cx: 0, cy: 0, cz: 0 };
    const regenerator = { ...r, sourceCenterOffset: off };
    return inst.type === "modify"
      ? {
          ...e,
          instruction: {
            ...inst,
            patches: { ...inst.patches, regenerator },
          },
        }
      : {
          ...e,
          instruction: { ...inst, item: { ...inst.item, regenerator } },
        };
  });

// One-time migration for documents saved before texture commits pruned their
// frozen sources: stacked displacement maps nested every prior step's DENSE
// mesh inside the next source (O(k²) copies — a 300 MB document / renderer
// OOM).  Strip geometryData below level 1 of each texture source chain; the
// level-1 mesh (the displacement base) is kept.
export const pruneTextureSourceChains = (history) =>
  history.map((e) => {
    const inst = e.instruction;
    const holder = inst?.type === "modify" ? inst.patches : inst?.item;
    const r = holder?.regenerator;
    if (r?.kind !== "texture" || !r.source?.regenerator?.source) return e;
    const regenerator = {
      ...r,
      source: pruneNestedSourceGeometry(r.source),
    };
    return inst.type === "modify"
      ? {
          ...e,
          instruction: { ...inst, patches: { ...inst.patches, regenerator } },
        }
      : { ...e, instruction: { ...inst, item: { ...inst.item, regenerator } } };
  });

export const loadTimeline = () => {
  try {
    const parsed = db.getTimeline();
    if (parsed && Array.isArray(parsed.history) && parsed.history.length > 0) {
      if (
        parsed.history[0].items !== undefined ||
        parsed.history[0].hiddenIds === undefined
      ) {
        return null;
      }
      const maxId = Math.max(...parsed.history.map((h) => h.id));
      setNextHistoryId(maxId + 1);
      return {
        ...parsed,
        history: pruneTextureSourceChains(
          backfillSplitRecipes(backfillEmbossFrames(parsed.history)),
        ),
      };
    }
  } catch (e) {
    console.warn("Failed to load timeline from storage:", e);
  }
  return null;
};

export const saveVariables = (variables) => {
  try {
    db.saveVariables(variables);
  } catch (e) {
    console.warn("Failed to save variables to storage:", e);
  }
};

// Tree-view folders are purely organizational (no geometry, not part of the
// undo/redo timeline) so they're persisted separately from history.
export const loadFolders = () => {
  try {
    const parsed = db.getFolders();
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn("Failed to load folders from storage:", e);
  }
  return [];
};

export const saveFolders = (folders) => {
  try {
    db.saveFolders(folders);
  } catch (e) {
    console.warn("Failed to save folders to storage:", e);
  }
};

// Default material (applied to newly-created objects) + user-saved presets.
export const loadMaterialSettings = () => {
  try {
    const parsed = db.getMaterial();
    if (parsed) {
      return {
        defaultMaterial: parsed.defaultMaterial ?? null,
        materialPresets: Array.isArray(parsed.materialPresets)
          ? parsed.materialPresets
          : [],
      };
    }
  } catch (e) {
    console.warn("Failed to load material settings from storage:", e);
  }
  return { defaultMaterial: null, materialPresets: [] };
};

export const saveMaterialSettings = (defaultMaterial, materialPresets) => {
  try {
    db.saveMaterial({ defaultMaterial, materialPresets });
  } catch (e) {
    console.warn("Failed to save material settings to storage:", e);
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

// Mark live CSG bodies stale -- every one, or only those `ids` names.
export const markCsgDirty = (items, ids = null) => {
  let changed = false;
  const out = items.map((item) => {
    if (item.type !== "csg" || !item.regenerator) return item;
    if (ids && !ids.has(item.id)) return item;
    if (item.regenerator.regeneratedAt === "dirty") return item;
    changed = true;
    return {
      ...item,
      regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
    };
  });
  return changed ? out : items;
};

// The earliest entry an edit rewrote, comparing the history before and after
// it (an untouched entry keeps its identity); -1 if none changed.  Nothing
// earlier can depend on what an edit rewrote -- a step only references what
// came before it -- so this is where invalidation starts.
export const firstChangedIndex = (prev, next) => {
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) if (prev[i] !== next[i]) return i;
  return prev.length === next.length ? -1 : n;
};

// The bodies the entries from `from` onward build or reshape.
const bodiesBuiltFrom = (history, from) => {
  const ids = new Set();
  for (let i = Math.max(0, from); i < history.length; i++) {
    const inst = history[i].instruction;
    if (inst?.type === "create" && inst.item) ids.add(inst.item.id);
    else if (inst?.type === "createGroup")
      for (const it of inst.items || []) ids.add(it.id);
    else if (inst?.type === "modify") ids.add(inst.itemId);
  }
  return ids;
};

// Mark stale only the live bodies an edit at step `from` can reach.
export const markCsgDirtyFrom = (items, history, from) =>
  from < 0 ? items : markCsgDirty(items, bodiesBuiltFrom(history, from));

// Invalidate what an edit can affect, and nothing else: from the first entry
// it rewrote, flag the entries for the recalc and mark the bodies they build
// stale.  An edit to the last step rebuilds that step alone -- it used to
// mark every entry and body, so editing the last extrude re-sewed the import
// and re-ran every boolean before it.
export const invalidateEdit = (prevHistory, newHistory, items) => {
  const from = firstChangedIndex(prevHistory, newHistory);
  if (from < 0) return { history: newHistory, items };
  const history = dirtyEntriesFrom(newHistory, from);
  return { history, items: markCsgDirtyFrom(items, history, from) };
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
export const SNAP_DEFAULTS = {
  snapEnabled: false,
  snapDistanceMm: 5,
  snapAngleDeg: 9,
  fov: 35,
  curveDetectionAngleDeg: 5,
  previewPrecisionMm: 0.05,
  printPrecisionMm: 0.01,
  alwaysExtrudeSingleObject: true,
  axisVisible: false,
};

export const loadSnapSettings = () => {
  try {
    const raw = db.settingGet("snap");
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
        parsed.previewPrecisionMm > 0 ? parsed.previewPrecisionMm : 0.05,
      printPrecisionMm:
        parsed.printPrecisionMm > 0 ? parsed.printPrecisionMm : 0.01,
      // Default on (combine) — only an explicit false turns it off.
      alwaysExtrudeSingleObject: parsed.alwaysExtrudeSingleObject !== false,
      // Combined-axis indicator defaults off — only an explicit true shows it.
      axisVisible: parsed.axisVisible === true,
    };
  } catch {
    return { ...SNAP_DEFAULTS };
  }
};

export const saveSnapSettings = (snap) => {
  try {
    db.settingSet(
      "snap",
      JSON.stringify({
        snapEnabled: snap.snapEnabled,
        snapDistanceMm: snap.snapDistanceMm,
        snapAngleDeg: snap.snapAngleDeg,
        fov: snap.fov,
        curveDetectionAngleDeg: snap.curveDetectionAngleDeg,
        previewPrecisionMm: snap.previewPrecisionMm,
        printPrecisionMm: snap.printPrecisionMm,
        alwaysExtrudeSingleObject: snap.alwaysExtrudeSingleObject,
        axisVisible: snap.axisVisible,
      }),
    );
  } catch (e) {
    console.warn("Failed to save snap settings to storage:", e);
  }
};

export const loadVariables = () => {
  try {
    const parsed = db.getVariables();
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn("Failed to load variables from storage:", e);
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
    {
      history: state.history,
      activeHistoryId: state.activeHistoryId,
      // Variables ride in the snapshot so a variable edit (and any change that
      // recalculates against variables) is undoable as one step.
      variables: state.variables,
    },
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

// Every field on a constraint that references a shape by index, across all
// constraint types (coincident/distance/angle use A/B; onLine uses
// point/line; H/V and the copy ops use shapeIdx; mirror/offset/pattern carry
// a source origIdx; mirror adds lineIdx; circularPattern adds centerShapeIdx).
// `i`, `j`, `index`, `count`, `offsetGroup` are NOT shape indices.
export const SHAPE_INDEX_FIELDS = [
  "shapeAIdx",
  "shapeBIdx",
  "shapeIdx",
  "origIdx",
  "pointShapeIdx",
  "lineShapeIdx",
  "lineIdx",
  "centerShapeIdx",
];

// Fields holding a LIST of shape indices: a centre constraint names each of
// its two shapes as every piece of connected geometry that makes it up.
export const SHAPE_INDEX_LIST_FIELDS = ["shapesA", "shapesB"];

// The constraints of `types` that tie the shapes at `indices` only to each other,
// renumbered to positions within `indices` -- what a copy of those shapes
// carries.  One that reaches a shape outside the set is left behind.
export const constraintsAmong = (constraints, indices, types) => {
  const indexMap = new Map(indices.map((orig, i) => [orig, i]));
  return constraints
    .filter((c) => types.has(c.type))
    .map((c) => remapConstraintShapeIndices(c, indexMap))
    .filter(Boolean);
};

// Remap a constraint's shape-index fields through `indexMap` (old index → new
// index, or -1 for a removed shape).  Returns null when the constraint
// references any removed shape, so the caller can drop it.  Used when deleting
// shapes (e.g. replacing a rectangular pattern's copies) so every surviving
// constraint keeps pointing at the right geometry.
export const remapConstraintShapeIndices = (constraint, indexMap) => {
  const out = { ...constraint };
  for (const f of SHAPE_INDEX_FIELDS) {
    if (typeof constraint[f] === "number") {
      const next = indexMap.get(constraint[f]);
      if (next == null || next === -1) return null;
      out[f] = next;
    }
  }
  // A list names a whole shape, so losing one of its pieces leaves the rest of
  // the shape -- still worth keeping.  Only a list emptied entirely takes the
  // constraint with it.
  for (const f of SHAPE_INDEX_LIST_FIELDS) {
    if (!Array.isArray(constraint[f])) continue;
    const kept = constraint[f]
      .map((i) => indexMap.get(i))
      .filter((i) => i != null && i !== -1);
    if (kept.length === 0) return null;
    out[f] = kept;
  }
  return out;
};
