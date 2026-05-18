// occClient — async, promise-based RPC layer around the OCC operations.
//
// In the browser this posts messages to a dedicated Web Worker (see
// occ.worker.js) so the OpenCascade.js kernel runs off the main thread
// and the UI stays responsive during slow operations like complex
// chamfers and CSG.
//
// In environments without `Worker` (node / vitest) the same surface
// falls back to in-process execution by calling the shared `ops` map
// directly — so unit tests and the original single-thread code path
// remain unchanged.
//
// Design notes:
//   • Inputs/outputs are plain JS — never a TopoDS_Shape — so the worker
//     boundary requires no special marshalling.
//   • `pendingOperations` is incremented around every public call so
//     <BusyIndicator> can show a global spinner.

import { useStore } from "../store";
import { ops as inProcessOps } from "./occOps.js";

const hasWorker = typeof Worker !== "undefined";

let workerPromise = null;
let nextId = 1;
const pending = new Map();

function onWorkerMessage(e) {
  const { id, ok, result, error } = e.data || {};
  const slot = pending.get(id);
  if (!slot) return;
  pending.delete(id);
  if (ok) slot.resolve(result);
  else slot.reject(new Error(error || "OCC worker error"));
}

function onWorkerError(e) {
  // Fail every in-flight call so callers don't hang; a future op will
  // re-init the worker from scratch.
  const message = (e && e.message) || "OCC worker crashed";
  for (const slot of pending.values()) slot.reject(new Error(message));
  pending.clear();
  workerPromise = null;
}

async function getWorker() {
  if (!hasWorker) return null;
  if (workerPromise) return workerPromise;
  workerPromise = import("./occ.worker.js?worker").then((mod) => {
    const OccWorker = mod.default;
    const w = new OccWorker();
    w.onmessage = onWorkerMessage;
    w.onerror = onWorkerError;
    return w;
  });
  return workerPromise;
}

function inc() {
  const s = useStore.getState();
  if (typeof s.beginOperation === "function") s.beginOperation();
}
function dec() {
  const s = useStore.getState();
  if (typeof s.endOperation === "function") s.endOperation();
}

// Dispatch a single named op; resolves with whatever the op returns.
async function callOp(op, args) {
  const w = hasWorker ? await getWorker() : null;
  if (!w) {
    // Fallback path: no Worker available (node tests, or browsers
    // without module-worker support).  Run the op directly on the
    // current thread.
    const fn = inProcessOps[op];
    if (typeof fn !== "function") {
      throw new Error(`Unknown op "${op}"`);
    }
    return fn(args);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, args });
  });
}

// Wrap an op call with the busy-counter increment/decrement.  Yields a
// macrotask first so React has a chance to render the spinner before
// we post the heavy work — without this, the spinner sometimes lights
// up only after the work has already finished.
async function runOp(op, args) {
  inc();
  try {
    await new Promise((r) => setTimeout(r, 0));
    return await callOp(op, args);
  } finally {
    dec();
  }
}

// Apply a chamfer (segments===1) or fillet (segments>1) to an item.
// See occOps.js#chamferOrFilletItem for the result shape.
export function chamferOrFilletItem(args) {
  return runOp("chamferOrFilletItem", args);
}

// Run a CSG boolean (union / difference / intersection) over the items
// in `selectedItems`.  See occOps.js#performCsg for the result shape.
export function performCsg(args) {
  return runOp("performCsg", args);
}
