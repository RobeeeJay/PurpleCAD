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
  applyInstruction,
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

// The history entry whose geometry cache this instruction owns: a CSG
// create, or a modify that stamps a geometryData / regenerator patch (e.g.
// a chamfer turning an extrude into a CSG).  Returns the affected item id,
// or null for steps that carry no geometry of their own.
function geomTargetId(inst) {
  if (inst.type === "create" && inst.item?.type === "csg") return inst.item.id;
  if (
    inst.type === "modify" &&
    (inst.patches?.geometryData !== undefined ||
      inst.patches?.regenerator !== undefined)
  )
    return inst.itemId;
  return null;
}

// Force every CSG / chamfer regenerator to re-run from scratch — used by
// the Timeline's "Recalculate" button.  This processes the ENTIRE timeline,
// not just the steps up to the currently-selected entry, and crucially
// rebuilds each step against the scene AS IT STOOD AT THAT STEP: we replay
// the history one instruction at a time, regenerate the item that step
// produces, and stamp the result back into that step's entry.  Upstream
// items keep the cache an earlier step just wrote (regeneratedAt ===
// printPrecision), so each regen only rebuilds the one new item.  Navigating
// the timeline or reloading then shows the correct geometry at every step.
export async function recalculateTimeline() {
  const state = useStore.getState();
  const history = state.history;
  const printPrecision = state.curveResolution === "print" ? 0.01 : null;

  const total = history.reduce(
    (n, e) => (geomTargetId(e.instruction) != null ? n + 1 : n),
    0,
  );
  let done = 0;
  useStore.getState().setRegenProgress({ current: 0, total });

  let accItems = [];
  const newHistory = [];
  for (const entry of history) {
    accItems = applyInstruction(accItems, entry.instruction);
    const targetId = geomTargetId(entry.instruction);
    if (targetId == null) {
      newHistory.push(entry);
      continue;
    }
    // Dirty only this step's item; everything upstream keeps the cache an
    // earlier iteration already stamped, so the regen rebuilds just this one.
    accItems = accItems.map((it) =>
      it.id === targetId && it.type === "csg" && it.regenerator
        ? {
            ...it,
            regenerator: { ...it.regenerator, regeneratedAt: "dirty" },
            geometryData: null,
          }
        : it,
    );
    accItems = await regenerateItemsForResolution(accItems, printPrecision);
    done += 1;
    useStore.getState().setRegenProgress({ current: done, total });

    const reg = accItems.find((it) => it.id === targetId);
    // A failed regen comes back without geometry — keep the entry's existing
    // cache rather than blanking it out.
    if (!reg || !reg.geometryData) {
      newHistory.push(entry);
      continue;
    }
    const inst = entry.instruction;
    const geom = {
      position: reg.position,
      regenerator: reg.regenerator,
      geometryData: reg.geometryData,
    };
    newHistory.push(
      inst.type === "create"
        ? {
            ...entry,
            instruction: { ...inst, item: { ...inst.item, ...geom } },
          }
        : {
            ...entry,
            instruction: { ...inst, patches: { ...inst.patches, ...geom } },
          },
    );
  }
  useStore.getState().setRegenProgress(null);

  // Re-derive the visible scene from the refreshed history at whatever step
  // the user is currently parked on.
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
