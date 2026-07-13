// Async front for textureDisplace: in the app the work runs in a Web Worker
// so the UI stays responsive (unlike the OCC addon, terminating this worker
// mid-run is safe — it's pure JS with no shared native state, so Cancel is a
// genuine abort).  Under vitest (node, no Worker) it falls back to running
// in-process, which keeps the whole regen path unit-testable.

let worker = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject }

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./textureWorker.js", import.meta.url), {
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
    // A crashed worker takes every in-flight request with it.
    for (const p of pending.values())
      p.reject(new Error("Texture worker failed."));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function displaceMeshAsync(args) {
  if (typeof Worker === "undefined") {
    const { displaceMesh } = await import("./textureDisplace.js");
    return displaceMesh(args);
  }
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  ensureWorker().postMessage({ id, args });
  return promise;
}

// Genuine cancel: kill the worker mid-displacement and reject everything in
// flight.  The next request spawns a fresh worker.
export function cancelTextureWork() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("cancelled"));
  pending.clear();
}
