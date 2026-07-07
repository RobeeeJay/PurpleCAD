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
import { getSolid, setSolid, pruneSolids } from "./solidCache.js";
import { solidFromMesh } from "./occClient.js";

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

// Incremental (JIT) recompute predicate: can this step reuse its existing
// cache?  Yes when the entry isn't flagged dirty AND the item's geometry is
// fresh for the current precision — a regenerated body whose regeneratedAt
// matches, or static import/split geometry that carries no recipe.  Anything
// else (dirty, no geometry, or tessellated at a different precision) rebuilds.
export function entryCacheValid(entry, cachedItem, precision) {
  return (
    !entry?.dirty &&
    !!cachedItem?.geometryData &&
    (!cachedItem.regenerator ||
      cachedItem.regenerator.regeneratedAt === precision)
  );
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

  // JIT bound: only recompute up to the step the user is parked on.  Steps
  // AFTER the viewed one keep their existing cache and are recomputed lazily
  // when navigated to — we don't rebuild off-screen future geometry.
  const bound =
    state.activeHistoryId !== null
      ? history.findIndex((h) => h.id === state.activeHistoryId)
      : history.length - 1;
  const jitBound = bound !== -1 ? bound : history.length - 1;

  const total = history.reduce(
    (n, e, i) =>
      i <= jitBound && geomTargetId(e.instruction) != null ? n + 1 : n,
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

  // Snapshot the cancel token; if the user hits Cancel the epoch changes and
  // we stop between steps, leaving the not-yet-reached entries on the cache
  // they already had (still valid — regen only dirties one step at a time).
  const cancelEpoch = useStore.getState().cancelEpoch;

  // Free cached solids whose entries were deleted since the last pass (their
  // ids won't be revisited, so setSolid can't reclaim them).
  pruneSolids(new Set(history.map((h) => h.id)));

  let accItems = [];
  const newHistory = [];
  // itemId → the most recent entry id that produced that item's geometry.  A
  // modify op's cached INPUT solid is the solid of its item's previous entry;
  // keying the solid cache by entry id (not item id) is essential because
  // in-place chains (extrude→chamfer→emboss) all share one item id.
  const lastEntryForItem = new Map();
  // itemId → the live world position its most recent geometry step resolved to.
  // A body-anchored op (emboss: centerOffset 0, no bbox re-centre) must inherit
  // this — otherwise when an upstream bevel is inserted and re-centres the body,
  // the emboss keeps its old position and the relief drifts off the object.
  const lastPositionForItem = new Map();
  for (let idx = 0; idx < history.length; idx++) {
    if (useStore.getState().cancelEpoch !== cancelEpoch) {
      // eslint-disable-next-line no-console
      console.log(
        `[OCC] recalc CANCELLED at step ${idx}/${history.length}; remaining steps left on their existing cache`,
      );
      for (let j = idx; j < history.length; j++) newHistory.push(history[j]);
      break;
    }
    const entry = history[idx];
    // Past the viewed step: carry the entry through untouched (JIT).
    if (idx > jitBound) {
      newHistory.push(entry);
      continue;
    }
    accItems = applyInstruction(accItems, entry.instruction);
    const targetId = geomTargetId(entry.instruction);
    if (targetId == null) {
      newHistory.push(entry);
      continue;
    }
    // Incremental: reuse this step's cache when it's still valid — the entry
    // isn't flagged dirty and its geometry is fresh for the current precision
    // (or it's static import/split geometry with no recipe).  Only stale or
    // dirty steps are rebuilt, so an unchanged step (and navigating over it) is
    // free instead of a forced recompute.
    const cached = accItems.find((it) => it.id === targetId);
    if (entryCacheValid(entry, cached, printPrecision)) {
      done += 1;
      useStore.getState().setRegenProgress({ current: done, total });
      newHistory.push(entry);
      // A downstream op reads this (unchanged) step as its input solid; record
      // it as the item's latest producer.  Its solid may or may not be cached
      // this session — if not, the consumer simply rebuilds (correct fallback).
      lastEntryForItem.set(targetId, entry.id);
      if (cached?.position) lastPositionForItem.set(targetId, cached.position);
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
    // Feed this step its cached input solid (the previous entry that produced
    // this item).  If it isn't cached this session (a clean upstream step
    // skipped on load), SEW the upstream's baked mesh — its already-built
    // display truth — into a solid instead, so this op builds on that rather
    // than re-running the upstream recipe (which can fail to re-select geometry,
    // e.g. a rim chamfer on a re-tessellated ring — the cause of the emboss
    // shift).  A miss on both still falls back to the recipe (correct).
    const inputEntryId = lastEntryForItem.get(targetId);
    let inputSolid =
      inputEntryId != null ? getSolid(inputEntryId, printPrecision) : null;
    if (inputSolid == null && inputEntryId != null) {
      const prev = newHistory.find((h) => h.id === inputEntryId);
      const pinst = prev?.instruction;
      const gd = pinst?.patches?.geometryData ?? pinst?.item?.geometryData;
      const pkind = (pinst?.patches?.regenerator ?? pinst?.item?.regenerator)
        ?.kind;
      // Only sew when the baked mesh is in the SAME frame buildItemShapeLocal
      // rebuilds the input in (bbox-centred).  A boolean/union re-localises by
      // its originalCentre, not the bbox, so its baked mesh would misplace the
      // consumer — skip it and let the recipe rebuild.
      const sewSafe = pkind !== "boolean" && pkind !== "extrudeUnion";
      if (sewSafe && gd?.positions?.length >= 9) {
        const sewn = await solidFromMesh(gd);
        if (sewn?.shapeId != null) {
          inputSolid = sewn.shapeId;
          setSolid(inputEntryId, inputSolid, printPrecision);
        }
      }
    }
    const solidCtx = {
      inputs: new Map([[targetId, inputSolid]]),
      results: new Map(),
    };
    accItems = await regenerateItemsForResolution(
      accItems,
      printPrecision,
      null,
      solidCtx,
    );
    const resultSolid = solidCtx.results.get(targetId);
    if (resultSolid != null) setSolid(entry.id, resultSolid, printPrecision);
    lastEntryForItem.set(targetId, entry.id);
    done += 1;
    useStore.getState().setRegenProgress({ current: done, total });
    await breathe();

    const reg = accItems.find((it) => it.id === targetId);
    // A failed regen comes back without geometry (selection unmatchable / OCC
    // rejected the combination).  SETTLE the step instead of leaving it dirty:
    // keep its last-good geometry, but stamp the failed regenerator
    // (regenFailed + regeneratedAt === printPrecision) and clear dirty.  Leaving
    // it dirty made the step recompute-fail every pass — a re-trigger loop that
    // blocked all other work.
    if (!reg || !reg.geometryData) {
      const inst = entry.instruction;
      const failRegen = reg?.regenerator;
      newHistory.push(
        !failRegen
          ? { ...entry, dirty: false }
          : inst.type === "create"
            ? {
                ...entry,
                dirty: false,
                instruction: {
                  ...inst,
                  item: { ...inst.item, regenerator: failRegen },
                },
              }
            : {
                ...entry,
                dirty: false,
                instruction: {
                  ...inst,
                  patches: { ...inst.patches, regenerator: failRegen },
                },
              },
      );
      continue;
    }
    const inst = entry.instruction;
    // A body-anchored op (emboss) sits at its source body's world position, not
    // a re-derived one.  When an upstream op re-centred the body, inherit the
    // live position of the previous same-item step so the relief stays put.
    const bodyAnchored =
      reg.regenerator?.kind === "emboss" && lastPositionForItem.has(targetId);
    const geom = {
      position: bodyAnchored ? lastPositionForItem.get(targetId) : reg.position,
      regenerator: reg.regenerator,
      geometryData: reg.geometryData,
    };
    lastPositionForItem.set(targetId, geom.position);
    // Freshly recomputed → this step's cache is clean again.
    newHistory.push(
      inst.type === "create"
        ? {
            ...entry,
            dirty: false,
            instruction: { ...inst, item: { ...inst.item, ...geom } },
          }
        : {
            ...entry,
            dirty: false,
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
