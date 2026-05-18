// occClient — async, promise-based wrapper around the OpenCascade.js
// operations.
//
// Step 1 of the worker migration (see proposal in the conversation
// history): every call site that talks to OCC will go through this
// module.  Today the implementation runs in-process on the main thread —
// the work doesn't move yet — but it returns Promises and increments
// a busy counter so the UI can already show a spinner and so the
// eventual switch to a real Web Worker is a single internal change here.
//
// Design notes:
//   • Inputs/outputs are plain JS values (numbers, strings, plain objects,
//     typed arrays).  No TopoDS_Shape ever crosses this boundary — when an
//     operation needs to chain multiple OCC steps it composes them inside
//     a single call (e.g. chamferItem builds source, applies, tessellates).
//   • Errors surface as rejected promises; callers do `try { await … }
//     catch { … }` exactly as they would with any async API.
//   • Every public function increments `pendingOperations` on the store
//     so a global spinner can light up while OCC work is in flight.

import { useStore } from "../store";
import { ensureOcc } from "./occ/init.js";
import { buildItemShapeLocal } from "./csgUtils.js";
import { chamferShapeBy, filletShapeBy } from "./occ/operations.js";
import { tessellateToData } from "./occ/tessellate.js";

function inc() {
  const s = useStore.getState();
  if (typeof s.beginOperation === "function") s.beginOperation();
}
function dec() {
  const s = useStore.getState();
  if (typeof s.endOperation === "function") s.endOperation();
}

// Wrap a synchronous OCC computation in a Promise so the call site is
// async-ready.  We don't `await` anything inside — but yielding via
// queueMicrotask() lets React flush the spinner state before the heavy
// work blocks the main thread.  When this module is moved into a Web
// Worker the synchronous body becomes a postMessage round-trip and the
// caller sees no difference.
async function runOp(fn) {
  inc();
  try {
    await ensureOcc();
    // Yield once so a pending `pendingOperations` store update has a
    // chance to render before the synchronous OCC call begins.  Without
    // this the spinner only appears after the work finishes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fn();
  } finally {
    dec();
  }
}

// Apply a chamfer (segments===1) or fillet (segments>1) to an item and
// return the tessellated geometry + bookkeeping the caller needs to
// produce a "modify" patch.  Returns null when the operation was a no-op
// (e.g. no edges/faces matched the selection).
//
// Result shape:
//   {
//     geometryData: { positions: number[], normals, indices },
//     centerOffset: { cx, cy, cz },   // bbox centre in shape-local frame
//   }
export async function chamferOrFilletItem({
  source,
  subGeo,
  amount,
  angleRad,
  segments,
  allItems,
  printPrecision,
}) {
  return runOp(() => {
    const sourceShape = buildItemShapeLocal(source, allItems);
    if (!sourceShape) return null;
    const result =
      segments === 1
        ? chamferShapeBy(sourceShape, subGeo, amount, angleRad)
        : filletShapeBy(sourceShape, subGeo, amount);
    if (!result || result === sourceShape) return null;
    const data = tessellateToData(result, printPrecision);
    if (!data) return null;

    // Centre the tessellation around its bbox so the resulting item.position
    // is the volumetric centre.  Callers translate to world space.
    const arr = data.positions;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] < minX) minX = arr[i];
      if (arr[i] > maxX) maxX = arr[i];
      if (arr[i + 1] < minY) minY = arr[i + 1];
      if (arr[i + 1] > maxY) maxY = arr[i + 1];
      if (arr[i + 2] < minZ) minZ = arr[i + 2];
      if (arr[i + 2] > maxZ) maxZ = arr[i + 2];
    }
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      cz = (minZ + maxZ) / 2;
    const centered = new Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      centered[i] = arr[i] - cx;
      centered[i + 1] = arr[i + 1] - cy;
      centered[i + 2] = arr[i + 2] - cz;
    }
    return {
      geometryData: {
        positions: centered,
        normals: data.normals,
        indices: data.indices,
      },
      centerOffset: { cx, cy, cz },
    };
  });
}
