// Regeneration entry point: walk the items, re-run every stale `regenerator`
// at the requested precision, and hand each op its cached input solid when the
// timeline cache has one.
//
// The op bodies themselves live in ./regenerators/* grouped by family (modify /
// surface / sweep / combine); this file owns the loop, the dispatch table and
// the retry-without-cache fallback.  `reviveDevelopable` and
// `resolveChainedPosition` are re-exported because callers outside the regen
// path import them from here.
//
// Shape of the regenerator field:
//   • Boolean op:  { kind: "boolean", op: "union"|..., inputIds: [a, b, …] }
//   • Chamfer:     { kind: "chamfer", source: {...preChamferItem},
//                    subGeo: { edges, faces }, amount, segments }
//   • (Legacy "bevel" entries from before the OCC migration are ignored —
//     callers should regenerate the item via the new chamfer flow.)
//
// Regeneration is async because both branches go through occClient, which
// posts to the OCC Web Worker in the browser and runs in-process in node.

import { resolveChainedPosition } from "./regenerators/shared.js";
import { tessellateItem } from "./occClient.js";
import {
  regenerateChamfer,
  regeneratePushPull,
  regenerateShell,
  regenerateDraft,
  regenerateHole,
  regenerateSimplify,
  regenerateConvert,
} from "./regenerators/modify.js";
import {
  regenerateEmboss,
  regenerateTexture,
  reviveDevelopable,
  shiftEmbossFrame,
} from "./regenerators/surface.js";
import {
  regenerateRevolve,
  regeneratePipe,
  regenerateLoft,
} from "./regenerators/sweep.js";
import {
  regenerate3dPattern,
  regenerateBoolean,
  regenerateExtrudeUnion,
} from "./regenerators/combine.js";

// Re-exported for callers outside the regen path (the orchestrator, the emboss
// tool) that have always imported them from this module.
export { resolveChainedPosition, reviveDevelopable, shiftEmbossFrame };

// `onProgress({ current, total })` fires after each item that ACTUALLY
// needed regeneration completes — used by the orchestrator to drive the
// busy-indicator's timeline-recalculation progress bar.  Items that
// skip the regen path (no regenerator, or already at the requested
// precision) are NOT counted: there's nothing to wait for there.
// `solidCtx`, when present (the timeline JIT cache path only), lets each
// single-input op consume a cached input solid instead of rebuilding its whole
// recipe in OCC, and hand its own result solid back to the cache:
//   { inputs: Map<itemId, shapeId|null>, results: Map<itemId, shapeId> }
// The op still builds the source JS object + remaps its subGeo (cheap), so the
// cached input — which always reflects the current sketch, because a changed
// input is recomputed-and-recached before its consumer runs here — stays
// consistent with the remap.  Absent solidCtx (live preview / resolution
// sweep), ops release their result as before and nothing is cached.
// An imported STEP body: its exact shape, stored in the item's own frame, drawn
// again at this Resolution.  Nothing re-centres it -- the frame is the one the
// shape was stored in, so a finer mesh lands exactly where the coarse one was.
async function regenerateImportedShape(item, printPrecision) {
  const res = await tessellateItem({
    source: item,
    allItems: [],
    printPrecision,
  });
  const g = res?.geometryData;
  if (!g?.positions?.length) return null;
  return {
    position: item.position,
    geometryData: {
      positions: Array.from(g.positions),
      normals: null,
      indices: Array.from(g.indices),
      edges: g.edges ? Array.from(g.edges) : null,
    },
  };
}

export async function regenerateItemsForResolution(
  items,
  printPrecision,
  onProgress = null,
  solidCtx = null,
) {
  if (!items || items.length === 0) return items;
  const total = items.reduce((n, item) => {
    const r = item.regenerator;
    if (!r) return n;
    if (r.regeneratedAt === printPrecision && item.geometryData) return n;
    return n + 1;
  }, 0);
  if (onProgress) onProgress({ current: 0, total });
  let progressed = 0;
  const out = [];
  let changed = false;
  // Sequential: each iteration can depend on earlier results in `out`
  // (e.g. a boolean whose inputIds reference items we just regenerated).
  for (const item of items) {
    const r = item.regenerator;
    if (!r) {
      out.push(item);
      continue;
    }
    if (r.regeneratedAt === printPrecision && item.geometryData) {
      out.push(item);
      continue;
    }
    // Timeline cache path: hand this op its cached input solid (or null → the
    // op rebuilds from source) and ask it to retain its result so we can cache
    // it.  Only the single-input ops below participate.
    const solidOpts = solidCtx
      ? {
          sourceShapeId: solidCtx.inputs.get(item.id) ?? null,
          retainResult: true,
        }
      : null;
    // Single-input ops take a cached input solid (solidOpts); the rest ignore
    // it.  `opts` is null on the retry path (rebuild from the recipe source).
    const dispatch = (opts) => {
      switch (r.kind) {
        case "chamfer":
          return regenerateChamfer(
            r,
            out,
            printPrecision,
            item.position,
            item.depth,
            opts,
          );
        case "pushpull":
          return regeneratePushPull(
            r,
            out,
            printPrecision,
            item.position,
            item.depth,
            opts,
          );
        case "shell":
          return regenerateShell(r, out, printPrecision, item.position, opts);
        case "hole":
          return regenerateHole(r, out, printPrecision, item.position, opts);
        case "simplify":
          return regenerateSimplify(r, out, printPrecision, item.position);
        case "meshToSurfaces":
          return regenerateConvert(r, out, printPrecision, item.position);
        case "emboss":
          return regenerateEmboss(r, out, printPrecision, item.position, opts);
        case "texture":
          return regenerateTexture(r, out, printPrecision, item.position);
        case "draft":
          return regenerateDraft(r, out, printPrecision, item.position, opts);
        case "revolve":
          return regenerateRevolve(r, out, printPrecision, item.position);
        case "pipe":
          return regeneratePipe(r, out, printPrecision, item.position);
        case "loft":
          return regenerateLoft(r, out, printPrecision, item.position);
        case "pattern3d":
          return regenerate3dPattern(r, out, printPrecision, item.position);
        case "boolean":
          return regenerateBoolean(r, out, printPrecision);
        case "extrudeUnion":
          return regenerateExtrudeUnion(r, out, printPrecision);
        case "extrudeCut":
          return regenerateExtrudeUnion(r, out, printPrecision, true);
        case "importedShape":
          return regenerateImportedShape(item, printPrecision);
        default:
          return null;
      }
    };
    let result = await dispatch(solidOpts);
    // A cached input can be stale for this op (upstream topology/frame drift on
    // a mid-timeline insert) even when a full recipe rebuild would succeed.  If
    // the cached path failed, retry once rebuilding from the source before
    // flagging the step bad.
    if (!result && solidOpts?.sourceShapeId != null) {
      result = await dispatch({ ...solidOpts, sourceShapeId: null });
    }
    progressed += 1;
    if (onProgress) onProgress({ current: progressed, total });
    if (!result) {
      // A chamfer/fillet that was asked to rebuild but produced nothing — the
      // selection couldn't be re-matched or OCC rejected it after the geometry
      // changed.  Keep its last-good mesh but flag it so the timeline marks the
      // step bad until the user retargets / re-applies it.  Stop re-attempting
      // (settle regeneratedAt) so a clean pass doesn't spam OCC every recalc.
      if (
        r.kind === "chamfer" ||
        r.kind === "pushpull" ||
        r.kind === "shell" ||
        r.kind === "simplify" ||
        r.kind === "meshToSurfaces" ||
        r.kind === "hole" ||
        r.kind === "emboss" ||
        r.kind === "draft" ||
        r.kind === "revolve" ||
        r.kind === "pipe" ||
        r.kind === "loft" ||
        r.kind === "pattern3d"
      ) {
        changed = true;
        out.push({
          ...item,
          regenerator: {
            ...r,
            regeneratedAt: printPrecision,
            regenFailed: true,
          },
        });
      } else {
        out.push(item);
      }
      continue;
    }
    changed = true;
    // Hand this op's retained result solid to the timeline cache so the next
    // op in the chain can consume it instead of rebuilding.  Only set when the
    // op actually retained one (single-input ops on the solidCtx path).
    if (solidCtx && result.shapeId != null) {
      solidCtx.results.set(item.id, result.shapeId);
    }
    // Carry the freshly-computed centerOffset back onto the chamfer
    // regenerator so buildItemShapeLocal stays in sync with the bbox
    // a re-tessellation just produced.  Clear any prior failure flag.
    const nextRegen = {
      ...r,
      regeneratedAt: printPrecision,
      regenFailed: false,
    };
    if (
      (r.kind === "chamfer" ||
        r.kind === "pushpull" ||
        r.kind === "shell" ||
        r.kind === "hole" ||
        r.kind === "emboss" ||
        r.kind === "draft" ||
        r.kind === "revolve" ||
        r.kind === "pipe" ||
        r.kind === "loft" ||
        r.kind === "pattern3d") &&
      result.centerOffset
    ) {
      nextRegen.centerOffset = result.centerOffset;
    }
    // Remember the source-anchored base we placed this op at, so the next recalc
    // can re-anchor the user's move-delta onto a fresh base (resolveChainedPosition)
    // instead of leaving the position pinned to a stale source after an insert/edit.
    if (result.basePosition) nextRegen.basePosition = result.basePosition;
    // Carry the freshly-recomputed stamp so buildItemShapeLocal stays in sync
    // with the live sketch geometry.
    if (r.kind === "emboss" && result.stamp) nextRegen.stamp = result.stamp;
    if (r.kind === "simplify") nextRegen.stats = result.stats;
    // A conversion's shape is its BREP: later ops build from it.
    if (r.kind === "meshToSurfaces") {
      nextRegen.stats = result.stats;
      nextRegen.brep = result.brep;
    }
    out.push({
      ...item,
      position: result.position,
      geometryData: result.geometryData,
      regenerator: nextRegen,
    });
  }
  return changed ? out : items;
}
