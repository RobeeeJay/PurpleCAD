// Async front for the stress solve.  In the app it runs in a Web Worker so the
// viewport stays live; under vitest (node, no Worker) it falls back to running
// in-process, which keeps the path unit-testable.
//
// Terminating THIS worker mid-solve is safe -- it is pure JS with no shared
// native state, unlike the OCC worker, where a terminate corrupts the kernel's
// globals (see CLAUDE.md).  So Cancel here is a genuine abort rather than a
// cooperative flag.

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./stressWorker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e) => {
    const { id, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  };
  worker.onerror = () => {
    for (const p of pending.values())
      p.reject(new Error("Stress worker failed."));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function solveStressAsync(args) {
  if (typeof Worker === "undefined") {
    const { solveStressField } = await import("./stressField.js");
    return solveStressField(args);
  }
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  ensureWorker().postMessage({ id, args });
  return promise;
}

export function cancelStressWork() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("cancelled"));
  pending.clear();
}
