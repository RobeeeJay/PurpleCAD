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
import { regenerateSplitGroup } from "./regenerators/combine.js";
import { activePrecision } from "./resolution.js";
import { upgradeProfileCurves, pinFacetedProfiles } from "./profileBackfill.js";
import { getSolid, setSolid, pruneSolids } from "./solidCache.js";
import { solidFromMesh } from "./occClient.js";

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
// A Split step carrying re-cut recipes: its pieces are rebuilt together (one
// split gives both), so it takes its own path through the recalc.
const isSplitGroup = (inst) =>
  inst.type === "createGroup" &&
  (inst.items || []).some((i) => i.regenerator?.kind === "split");

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

// RE-ENTRANCY GUARD: recalcs must never overlap.  A pass reads the history at
// its start and stamps results at its end; a second trigger firing while the
// first is awaiting OCC (a store update, a resolution change racing the items
// write, …) would read the still-unstamped history and RECOMPUTE the same
// entries — every op ran twice.  Serialize: while a pass runs, remember at most
// ONE follow-up (collapsing any number of triggers) and run it after; it sees
// the stamped state and skips clean entries, so the follow-up is cheap.
let recalcRunning = null;
let recalcQueued = false;
let recalcQueuedForce = false;
export function recalculateTimeline(force = false) {
  if (recalcRunning) {
    recalcQueued = true;
    recalcQueuedForce = recalcQueuedForce || force;
    return recalcRunning;
  }
  recalcRunning = (async () => {
    try {
      await (force ? runUpgradingPass() : runRecalcPass(false));
    } finally {
      recalcRunning = null;
      if (recalcQueued) {
        recalcQueued = false;
        const f = recalcQueuedForce;
        recalcQueuedForce = false;
        recalculateTimeline(f);
      }
    }
  })();
  return recalcRunning;
}

// A full recalculation also upgrades profiles saved before exact curves, so an
// older project's facets become true arcs where its saved selections allow:
// a step that FAILS only since the upgrade has the profiles under it pinned
// back to their facets (pinFacetedProfiles), and the pass runs again.  A step
// already failing before is left out -- facets wouldn't have saved it.
async function runUpgradingPass() {
  const before = useStore.getState().history;
  const upgraded = upgradeProfileCurves(
    before,
    activePrecision(useStore.getState()),
  );
  if (upgraded !== before) useStore.setState({ history: upgraded });
  await runRecalcPass(true);
  if (upgraded === before) return;
  const failedBefore = new Set(before.filter(entryFailed).map((e) => e.id));
  // Each round pins what the last one broke; a pinned profile isn't upgraded
  // again, so this settles within a few rounds.
  for (let round = 0; round < 3; round++) {
    const h = useStore.getState().history;
    const failed = new Set(
      h
        .filter((e) => entryFailed(e) && !failedBefore.has(e.id))
        .map((e) => e.id),
    );
    const pinned = pinFacetedProfiles(h, failed);
    if (pinned === h) return;
    useStore.setState({ history: pinned });
    await runRecalcPass(true);
  }
}

const entryFailed = (e) => {
  const inst = e.instruction;
  const reg =
    inst?.type === "create"
      ? inst.item?.regenerator
      : inst?.patches?.regenerator;
  return !!reg?.regenFailed;
};

// Force every CSG / chamfer regenerator to re-run from scratch — used by
// the Timeline's "Recalculate" button.  This processes the ENTIRE timeline,
// not just the steps up to the currently-selected entry, and crucially
// rebuilds each step against the scene AS IT STOOD AT THAT STEP: we replay
// the history one instruction at a time, regenerate the item that step
// produces, and stamp the result back into that step's entry.  Upstream
// items keep the cache an earlier step just wrote (regeneratedAt ===
// printPrecision), so each regen only rebuilds the one new item.  Navigating
// the timeline or reloading then shows the correct geometry at every step.
async function runRecalcPass(force = false) {
  const state = useStore.getState();
  const history = state.history;
  const printPrecision = activePrecision(state);

  // JIT bound: only recompute up to the step the user is parked on.  Steps
  // AFTER the viewed one keep their existing cache and are recomputed lazily
  // when navigated to — we don't rebuild off-screen future geometry.  The manual
  // "Recalculate" button passes force=true: it rebuilds EVERY step from the
  // beginning (ignoring both this bound and the per-step valid-cache skip below),
  // which is the whole point of the button — an escape hatch when a step looks
  // stale.  A plain recalc leaves the skip-check to do the incremental work.
  const bound =
    state.activeHistoryId !== null
      ? history.findIndex((h) => h.id === state.activeHistoryId)
      : history.length - 1;
  const jitBound = force
    ? history.length - 1
    : bound !== -1
      ? bound
      : history.length - 1;

  const total = history.reduce(
    (n, e, i) =>
      i <= jitBound &&
      (geomTargetId(e.instruction) != null || isSplitGroup(e.instruction))
        ? n + 1
        : n,
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
  // Items whose geometry was RECOMPUTED (not cache-skipped) earlier in this
  // pass — a later same-item op's frozen source snapshot is then stale and must
  // be refreshed from the accumulated state (see the dirty-map below).
  const recomputedItems = new Set();
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
    // The item's accumulated state BEFORE this entry applies — the live result
    // of its previous step, used to refresh a stale frozen source below.
    const preTargetId = geomTargetId(entry.instruction);
    const prevItemState =
      preTargetId != null ? accItems.find((it) => it.id === preTargetId) : null;
    accItems = applyInstruction(accItems, entry.instruction);
    if (isSplitGroup(entry.instruction)) {
      const inst = entry.instruction;
      const ids = inst.items.map((i) => i.id);
      const pieces = ids.map((id) => accItems.find((it) => it.id === id));
      const fresh = pieces.every((p) =>
        entryCacheValid(entry, p, printPrecision),
      );
      let next = entry;
      if (force || !fresh) {
        // eslint-disable-next-line no-console
        console.log(
          `[OCC] recalc: re-cutting entry ${entry.id} ("${entry.label}")`,
        );
        const parts = await regenerateSplitGroup(
          pieces,
          accItems,
          printPrecision,
        );
        // A piece that can't be re-cut keeps its last mesh, settled at this
        // precision so the next pass doesn't retry it -- as a failed regen
        // does elsewhere.
        const stamped = inst.items.map((item, k) => {
          if (item.regenerator?.kind !== "split") return item;
          const part = parts?.[k];
          return {
            ...item,
            ...(part ?? null),
            regenerator: {
              ...item.regenerator,
              // Where the new mesh is centred: a later op builds the piece
              // in this frame (see buildItemShapeLocal's "split" case).
              ...(part ? { center: part.position } : null),
              regeneratedAt: printPrecision,
              regenFailed: !part,
            },
          };
        });
        const byId = new Map(stamped.map((i) => [i.id, i]));
        accItems = accItems.map((it) =>
          byId.has(it.id)
            ? {
                ...it,
                position: byId.get(it.id).position,
                geometryData: byId.get(it.id).geometryData,
                regenerator: byId.get(it.id).regenerator,
              }
            : it,
        );
        ids.forEach((id) => recomputedItems.add(id));
        next = {
          ...entry,
          dirty: false,
          instruction: { ...inst, items: stamped },
        };
        await breathe();
      }
      for (const id of ids) {
        lastEntryForItem.set(id, entry.id);
        const it = accItems.find((a) => a.id === id);
        if (it?.position) lastPositionForItem.set(id, it.position);
      }
      done += 1;
      useStore.getState().setRegenProgress({ current: done, total });
      newHistory.push(next);
      continue;
    }
    const targetId = preTargetId;
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
    if (!force && entryCacheValid(entry, cached, printPrecision)) {
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
    // Why this step recomputes — greppable next to the "[OCC] <op> start" logs
    // so a doubled op run is attributable at a glance.
    // eslint-disable-next-line no-console
    console.log(
      `[OCC] recalc: rebuilding entry ${entry.id} ("${entry.label}") — ` +
        (entry.dirty
          ? "entry flagged dirty"
          : !cached?.geometryData
            ? "no cached geometry"
            : `regeneratedAt ${cached.regenerator?.regeneratedAt} != precision ${printPrecision}`),
    );
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
    // When this op's INPUT (the same item's previous step) was itself recomputed
    // this pass, its frozen source snapshot is stale — a reorder/relink bound it
    // to the OLD order's transform, so both the position delta math and the
    // brush frame double-count (the "reorder moves the whole object" bug).
    // Refresh the snapshot to the live pre-entry state and re-anchor from
    // scratch: dropping the stored position is safe, user gizmo moves live in
    // separate `transform` entries that replay on top.
    // Does this op's frozen source actually DESCRIBE the previous same-item
    // step's result?  Usually yes (op chains: each op builds on the previous
    // result).  But an APPENDED chamfer re-runs its merged selection on the
    // PRE-chamfer source — its source describes an EARLIER state (kind
    // "emboss" while the previous entry's result is kind "chamfer").  Feeding
    // such an op the previous RESULT (cached solid / sewn mesh / refreshed
    // snapshot) hands it a body whose selected rim was already beveled away:
    // the coordinate passes miss and the normal fallback grabs the ring's
    // INNER rim (a diametrically-opposite inner edge carries the identical
    // adjacent-normal pair) — the "high-res chamfers both rings" bug.  Match
    // on (type, regenerator kind): a mismatch means re-run from the recipe.
    const curSrc = accItems.find((it) => it.id === targetId)?.regenerator
      ?.source;
    const sourceDescribesPrev =
      prevItemState != null &&
      curSrc != null &&
      curSrc.type === prevItemState.type &&
      (curSrc.regenerator?.kind ?? null) ===
        (prevItemState.regenerator?.kind ?? null);
    const inputRecomputed =
      recomputedItems.has(targetId) &&
      prevItemState != null &&
      sourceDescribesPrev;
    accItems = accItems.map((it) => {
      if (it.id !== targetId || it.type !== "csg" || !it.regenerator) return it;
      const src = it.regenerator.source;
      const singleInput =
        it.regenerator.kind === "chamfer" ||
        it.regenerator.kind === "pushpull" ||
        it.regenerator.kind === "shell" ||
        it.regenerator.kind === "simplify" ||
        it.regenerator.kind === "hole" ||
        it.regenerator.kind === "emboss" ||
        it.regenerator.kind === "draft" ||
        it.regenerator.kind === "revolve";
      const recenter =
        (singleInput &&
          (src?.type === "extrude" ||
            src?.regenerator?.kind === "boolean" ||
            inputRecomputed)) ||
        // Pipe and loft are built in world and their position IS the bbox
        // centre; drop it so a sketch edit to an input re-centres the result.
        ((it.regenerator.kind === "pipe" || it.regenerator.kind === "loft") &&
          it.regenerator.profileSource?.type === "extrude") ||
        // A 3D pattern is world-built and follows its source — always recentre.
        it.regenerator.kind === "pattern3d";
      // Refresh only chain-style sources (extrude / single-input csg).  A
      // boolean/extrudeUnion source has its own re-localisation frame
      // (originalCentre) that the accumulated item state doesn't reproduce —
      // swapping it in breaks the union-source chamfer's recentring.
      const booleanish = (k) =>
        k === "boolean" || k === "extrudeUnion" || k === "extrudeCut";
      const refreshSource =
        singleInput &&
        inputRecomputed &&
        it.regenerator.source != null &&
        !booleanish(it.regenerator.source?.regenerator?.kind) &&
        !booleanish(prevItemState?.regenerator?.kind);
      return {
        ...it,
        regenerator: {
          ...it.regenerator,
          ...(refreshSource ? { source: prevItemState } : null),
          regeneratedAt: "dirty",
        },
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
    // No cached/sewn input for an op whose source describes an EARLIER state
    // (see sourceDescribesPrev above) — it must rebuild from its own recipe.
    const inputEntryId = sourceDescribesPrev
      ? lastEntryForItem.get(targetId)
      : undefined;
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
      const sewSafe =
        pkind !== "boolean" &&
        pkind !== "extrudeUnion" &&
        pkind !== "extrudeCut";
      if (sewSafe && gd?.positions?.length >= 9) {
        // A failed sew must not abort the whole recalculation (it left the
        // regen dialog stuck) — the recipe rebuild below is the correct
        // fallback for anything the sew can't handle.
        try {
          const sewn = await solidFromMesh(gd);
          if (sewn?.shapeId != null) {
            inputSolid = sewn.shapeId;
            setSolid(inputEntryId, inputSolid, printPrecision);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[OCC] recalc: sew of entry ${inputEntryId}'s baked mesh failed ` +
              `(${err?.message}); rebuilding input from its recipe`,
          );
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
    recomputedItems.add(targetId);
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
  // the user is parked on NOW -- not when this pass began: moving to another
  // step doesn't change the history, so the guard below lets this pass
  // through, and replaying the old step showed the scene as it stood there.
  // Opening an extrusion's Edit while a recalc ran showed the body it had
  // merged into as hidden, and Combine then found nothing to merge with.
  const activeId = useStore.getState().activeHistoryId;
  const activeIdx =
    activeId !== null
      ? newHistory.findIndex((h) => h.id === activeId)
      : newHistory.length - 1;
  const items = replayUpTo(
    newHistory,
    activeIdx !== -1 ? activeIdx : newHistory.length - 1,
  );
  // If another edit committed a new history while this (async) recalc was
  // running, don't clobber it with the stale result — that newer edit triggers
  // its own recalc.
  if (useStore.getState().history !== history) return;
  saveTimeline(newHistory, activeId);
  useStore.setState({ history: withOrphanFlags(newHistory), items });
}
