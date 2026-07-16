// Renderer-side cache of per-item OCC solid ids (JIT timeline model).  The
// actual B-rep solids live in the native shape store (in-process under vitest,
// the Electron main process otherwise); this map just tracks which id belongs
// to which item and at what tessellation precision it was built.
//
// Ownership discipline (leak-safe + double-free-safe): the cache is the SOLE
// owner of the ids it holds.  An op that produced a solid with `retainResult`
// hands ownership here; `set` releases any prior id for that item before
// storing the new one, so each id is released exactly once (on replace, or via
// `release` / `clear`).  A cached id passed back into an op as `sourceShapeId`
// is read-only there (`owns=false`), so it is never double-freed.

import { releaseShape } from "./occClient.js";

const cache = new Map(); // itemId -> { shapeId, precision }

// The cached solid for `itemId` if it was built at `precision`, else null (a
// precision change invalidates it — the mesh must re-tessellate).
export function getSolid(itemId, precision) {
  const e = cache.get(itemId);
  return e && e.precision === precision ? e.shapeId : null;
}

// Cache `shapeId` for `itemId`, releasing whatever was cached before.
export function setSolid(itemId, shapeId, precision) {
  const prev = cache.get(itemId);
  if (prev && prev.shapeId !== shapeId) releaseShape(prev.shapeId);
  cache.set(itemId, { shapeId, precision });
}

// Release + forget one item's cached solid (e.g. the item was deleted).
export function releaseSolid(itemId) {
  const e = cache.get(itemId);
  if (e) {
    releaseShape(e.shapeId);
    cache.delete(itemId);
  }
}

// Release everything (document load / reset / precision-wide invalidation).
export function clearSolids() {
  for (const { shapeId } of cache.values()) releaseShape(shapeId);
  cache.clear();
}

// Release the cached solids of entries that no longer exist (deleted from the
// timeline).  `validIds` is the set of current entry ids.  Safe within a
// document — entry ids are unique and monotonic there; cross-document reuse is
// handled separately by clearSolids on the document boundary.
export function pruneSolids(validIds) {
  for (const key of [...cache.keys()]) {
    if (!validIds.has(key)) {
      releaseShape(cache.get(key).shapeId);
      cache.delete(key);
    }
  }
}

// Test/inspection helper — number of cached solids.
export function cachedSolidCount() {
  return cache.size;
}
