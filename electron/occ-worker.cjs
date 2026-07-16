// OCC operations host — runs in a worker_thread so the synchronous native
// calls (a boolean / chamfer / tessellation can take seconds) never block the
// main process event loop.  Without this, a long op freezes the whole window:
// no input, no spinner, no Cancel.  The addon is single-threaded and keeps a
// shared shape store (g_shapes), so exactly ONE worker hosts it and requests
// serialise through this thread's event loop in FIFO order.

const { parentPort, workerData } = require("worker_threads");
const path = require("path");

// Shared cancel flag: an Int32Array over the SharedArrayBuffer the main process
// created and flips (element 0 → 1) to abort a long op.  This thread is BLOCKED
// inside the synchronous native call and can't receive a "cancel" message, so
// the native builders poll this shared memory directly (UserBreak).
const cancelView =
  workerData && workerData.cancelBuffer
    ? new Int32Array(workerData.cancelBuffer)
    : null;

let bridge = null;
try {
  bridge = require(path.join(__dirname, "occ-bridge.cjs"));
  if (cancelView) bridge.setCancelBuffer(cancelView);
  parentPort.postMessage({ ready: true });
} catch (e) {
  // Addon not built / OCC dylib missing — report once; every op then errors.
  parentPort.postMessage({ ready: false, error: e.message });
}

parentPort.on("message", (msg) => {
  const { id, op, args } = msg;
  if (!bridge) {
    parentPort.postMessage({ id, error: "OCC addon unavailable in worker" });
    return;
  }
  const fn = bridge[op];
  if (typeof fn !== "function") {
    parentPort.postMessage({ id, error: `unknown OCC op: ${op}` });
    return;
  }
  // Clear any stale cancel from a prior op before we start this one (we only
  // reach here between ops — the thread is free, so this can't race the native
  // poll of a running op).
  if (cancelView) Atomics.store(cancelView, 0, 0);
  // Debug timing: native-only duration (no IPC/clone), logged to the worker's
  // stdout (the terminal running the app).  Compare with the renderer's "[OCC]"
  // round-trip logs to see the marshalling overhead.
  const t0 = Date.now();
  try {
    // Bridge ops are synchronous C++ calls; run and return the result (mesh
    // object, STEP string, STL Buffer, { shapeId }, or null).
    console.log(`[OCC-native] ${op} start`);
    const result = fn(args);
    console.log(`[OCC-native] ${op} ${Date.now() - t0}ms`);
    parentPort.postMessage({ id, result });
  } catch (e) {
    console.log(`[OCC-native] ${op} FAILED ${Date.now() - t0}ms: ${e.message}`);
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
