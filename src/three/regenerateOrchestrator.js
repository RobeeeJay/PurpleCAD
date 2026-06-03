// UI-side orchestrator for re-running CSG/chamfer regenerators after a
// curve-resolution or variables change.
//
// Why this lives outside the store: the store is in the worker's
// transitive import graph (via sceneObjects → store), and Vite's
// `inlineDynamicImports` for module workers follows dynamic imports
// inside that graph too.  If the store dynamic-imported regenerateItems,
// and regenerateItems imported occClient, the worker bundle would end up
// trying to bundle itself (occClient dynamic-imports the worker).
//
// Moving the orchestration here — imported only by Viewport, which the
// worker bundle never reaches — breaks the chain and lets regen go
// through the worker like the live BevelSection / CombineSection flows.

import { useStore } from "../store";
import {
  replayUpTo,
  saveTimeline,
  withOrphanFlags,
} from "../store/internals.js";
import { regenerateItemsForResolution } from "./regenerateItems.js";

export async function regenerateForResolution(printPrecision) {
  const state = useStore.getState();
  const newItems = await regenerateItemsForResolution(
    state.items,
    printPrecision,
    // Publish progress so the BusyIndicator can show a progress bar
    // while the regen runs.  Clear it at the end (in the finally below)
    // so the bar doesn't linger after work finishes.
    (p) => useStore.getState().setRegenProgress(p),
  );
  useStore.getState().setRegenProgress(null);
  if (newItems !== state.items) {
    useStore.setState({ items: newItems });
  }
}

// Force every CSG / chamfer regenerator to re-run from scratch — used by
// the Timeline's "Recalculate" button.  This must process the ENTIRE
// timeline, not just the steps up to the currently-selected entry, so we
// replay the full history (every create / transform / delete / modify)
// rather than working off `state.items` (which only reflects the scene up
// to the active step).  After rebuilding, the recomputed geometry is
// written back into the history entry that produced each item's final
// geometry, so navigating the timeline or reloading stays consistent.
export async function recalculateTimeline() {
  const state = useStore.getState();
  const history = state.history;
  const printPrecision = state.curveResolution === "print" ? 0.01 : null;

  // Replay every entry to get the full final scene, then clear the cached
  // tessellation so the regen pass rebuilds each regenerator via OCC.
  const fullItems = replayUpTo(history, history.length - 1).map((item) =>
    item.type === "csg" && item.regenerator
      ? {
          ...item,
          regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
          geometryData: null,
        }
      : item,
  );

  const regenerated = await regenerateItemsForResolution(
    fullItems,
    printPrecision,
    (p) => useStore.getState().setRegenProgress(p),
  );
  useStore.getState().setRegenProgress(null);

  // Map each item id to its rebuilt geometry, and find the last history
  // entry that sets that item's geometry (its create, or the last modify
  // carrying a geometryData/regenerator patch — e.g. a chamfer).  That
  // entry is the one whose cache must be refreshed.
  const regenMap = new Map(regenerated.map((it) => [it.id, it]));
  const lastGeomEntry = new Map();
  history.forEach((entry, idx) => {
    const inst = entry.instruction;
    if (inst.type === "create" && inst.item?.type === "csg")
      lastGeomEntry.set(inst.item.id, idx);
    else if (
      inst.type === "modify" &&
      (inst.patches?.geometryData !== undefined ||
        inst.patches?.regenerator !== undefined)
    )
      lastGeomEntry.set(inst.itemId, idx);
  });

  const newHistory = history.map((entry, idx) => {
    const inst = entry.instruction;
    let id = null;
    if (inst.type === "create" && lastGeomEntry.get(inst.item?.id) === idx)
      id = inst.item.id;
    else if (inst.type === "modify" && lastGeomEntry.get(inst.itemId) === idx)
      id = inst.itemId;
    const reg = id != null ? regenMap.get(id) : null;
    // If a regenerator failed it comes back without geometry — keep the
    // entry's existing cache rather than blanking it out.
    if (!reg || !reg.geometryData) return entry;
    if (inst.type === "create")
      return {
        ...entry,
        instruction: {
          ...inst,
          item: {
            ...inst.item,
            position: reg.position,
            regenerator: reg.regenerator,
            geometryData: reg.geometryData,
          },
        },
      };
    return {
      ...entry,
      instruction: {
        ...inst,
        patches: {
          ...inst.patches,
          position: reg.position,
          regenerator: reg.regenerator,
          geometryData: reg.geometryData,
        },
      },
    };
  });

  // Re-derive the visible scene from the refreshed history at whatever
  // step the user is currently parked on.
  const activeIdx =
    state.activeHistoryId !== null
      ? newHistory.findIndex((h) => h.id === state.activeHistoryId)
      : newHistory.length - 1;
  const items = replayUpTo(
    newHistory,
    activeIdx !== -1 ? activeIdx : newHistory.length - 1,
  );
  saveTimeline(newHistory, state.activeHistoryId);
  useStore.setState({ history: withOrphanFlags(newHistory), items });
}
