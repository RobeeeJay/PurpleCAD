// Web Worker that hosts the OpenCascade.js kernel and dispatches RPC
// messages from occClient.  Protocol:
//
//   in:   { id, op, args }
//   out:  { id, ok: true, result }
//   out:  { id, ok: false, error }
//
// We dynamically import occOps the first time a message arrives.  This
// keeps the worker's static import graph empty, which sidesteps a Vite 4
// build-time issue with `build-import-analysis` when an ES-module worker
// statically depends on a large WASM-backed chunk (opencascade.js) that
// the main bundle also imports.

let opsPromise = null;
function getOps() {
  if (!opsPromise) opsPromise = import("./occOps.js").then((m) => m.ops);
  return opsPromise;
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data || {};
  if (typeof id !== "number") return;
  try {
    const ops = await getOps();
    const fn = ops[op];
    if (typeof fn !== "function") {
      self.postMessage({ id, ok: false, error: `Unknown op "${op}"` });
      return;
    }
    const result = await fn(args || {});
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
