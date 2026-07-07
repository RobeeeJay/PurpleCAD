// OCC operations host — runs as an Electron utilityProcess (a SEPARATE OS
// process, not a worker_thread).  Two reasons:
//  1. Its synchronous native calls run off the main process, so a long op never
//     freezes the window.
//  2. It has its OWN address space, so a genuine cancel can KILL this process
//     mid-op cleanly — a worker_thread shares OCC's non-thread-safe global C++
//     state, and terminating one mid-call corrupts it (crashes the next op).
// The addon is single-threaded with a shared shape store, so exactly ONE process
// hosts it and ops serialise on its event loop (FIFO).

const path = require("path");

let bridge = null;
try {
  bridge = require(path.join(__dirname, "occ-bridge.cjs"));
  process.parentPort.postMessage({ ready: true });
} catch (e) {
  process.parentPort.postMessage({ ready: false, error: e.message });
}

process.parentPort.on("message", (evt) => {
  const { id, op, args } = evt.data;
  if (!bridge) {
    process.parentPort.postMessage({ id, error: "OCC addon unavailable" });
    return;
  }
  const fn = bridge[op];
  if (typeof fn !== "function") {
    process.parentPort.postMessage({ id, error: `unknown OCC op: ${op}` });
    return;
  }
  // Debug timing: native-only duration, to this process's stdout (the terminal).
  const t0 = Date.now();
  try {
    console.log(`[OCC-native] ${op} start`);
    const result = fn(args);
    console.log(`[OCC-native] ${op} ${Date.now() - t0}ms`);
    process.parentPort.postMessage({ id, result });
  } catch (e) {
    console.log(`[OCC-native] ${op} FAILED ${Date.now() - t0}ms: ${e.message}`);
    process.parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
