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
import { activePrecision } from "./resolution.js";

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
  const printPrecision = activePrecision(state);

  const total = history.reduce(
    (n, e) => (geomTargetId(e.instruction) != null ? n + 1 : n),
    0,
  );
  let done = 0;
  useStore.getState().setRegenProgress({ current: 0, total });

  // Yield a real animation frame at most this often so the render / camera loop
  // keeps painting through a long recalc — the viewport stays orbitable while it
  // runs — without adding a frame to every (often sub-millisecond) step.
  let lastFrame = Date.now();
  const breathe = async () => {
    if (Date.now() - lastFrame < 80) return;
    await new Promise((r) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => r())
        : setTimeout(r, 0),
    );
    lastFrame = Date.now();
  };

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
    // For a chamfer/push-pull whose source tracks a sketch, also drop the stored
    // position so the regen recomputes it (source brushPos + the fresh bbox
    // centerOffset) — otherwise a resized source keeps its old position and the
    // body shifts by the bbox-centre delta.  Both ops bbox-centre their result,
    // so both need this.  It applies to a direct extrude source AND a
    // union/boolean source (a boss): the union is re-localised by its frozen
    // originalCentre, so its bbox centre moves as the sketch grows.  Chained ops
    // (source is itself a chamfer/push-pull CSG) keep their position —
    // buildBrushTransform has no live centroid there and any gizmo move lives in
    // a separate later transform entry.
    accItems = accItems.map((it) => {
      if (it.id !== targetId || it.type !== "csg" || !it.regenerator) return it;
      const src = it.regenerator.source;
      const recenter =
        ((it.regenerator.kind === "chamfer" ||
          it.regenerator.kind === "pushpull" ||
          it.regenerator.kind === "shell" ||
          it.regenerator.kind === "hole" ||
          it.regenerator.kind === "emboss" ||
          it.regenerator.kind === "draft" ||
          it.regenerator.kind === "revolve") &&
          (src?.type === "extrude" || src?.regenerator?.kind === "boolean")) ||
        // Pipe and loft are built in world and their position IS the bbox
        // centre; drop it so a sketch edit to an input re-centres the result.
        ((it.regenerator.kind === "pipe" || it.regenerator.kind === "loft") &&
          it.regenerator.profileSource?.type === "extrude") ||
        // A 3D pattern is world-built and follows its source — always recentre.
        it.regenerator.kind === "pattern3d";
      return {
        ...it,
        regenerator: { ...it.regenerator, regeneratedAt: "dirty" },
        geometryData: null,
        ...(recenter ? { position: undefined } : {}),
      };
    });
    accItems = await regenerateItemsForResolution(accItems, printPrecision);
    done += 1;
    useStore.getState().setRegenProgress({ current: done, total });
    await breathe();

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
  // If another edit committed a new history while this (async) recalc was
  // running, don't clobber it with the stale result — that newer edit triggers
  // its own recalc.
  if (useStore.getState().history !== history) return;
  saveTimeline(newHistory, state.activeHistoryId);
  useStore.setState({ history: withOrphanFlags(newHistory), items });
}
