// Async front for the optimisation, with per-iteration progress.  Under vitest
// (node, no Worker) it runs in-process so the path stays unit-testable.
//
// Terminating this worker mid-run is safe: pure JS, no shared native state.

let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./topologyWorker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e) => {
    const { id, result, error, progress } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress) return p.onProgress?.(progress);
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  };
  worker.onerror = () => {
    for (const p of pending.values())
      p.reject(new Error("Optimisation worker failed."));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export async function optimiseAsync(args, onProgress) {
  if (typeof Worker === "undefined") {
    const [{ optimiseTopology }, { keptVoxels, voxelSurface }] =
      await Promise.all([import("./topology.js"), import("./voxelMesh.js")]);
    const r = optimiseTopology({
      ...args,
      ...args.options,
      onIteration: onProgress,
    });
    const solid = keptVoxels({
      density: r.density,
      grid: args.grid,
      threshold: args.options?.threshold ?? 0.5,
      seeds: args.seeds,
    });
    return {
      positions: voxelSurface({
        solid,
        grid: args.grid,
        mmPerUnit: args.mmPerUnit,
      }),
      history: r.history,
      designElements: r.designElements,
      keptElements: solid.reduce((n, v) => n + v, 0),
    };
  }
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
  });
  ensureWorker().postMessage({ id, args });
  return promise;
}

export function cancelOptimisation() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("cancelled"));
  pending.clear();
}
