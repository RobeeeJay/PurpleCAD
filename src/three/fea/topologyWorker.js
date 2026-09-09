// Web Worker body for the topology optimisation: tens of conjugate-gradient
// solves, which would freeze the viewport for minutes on the main thread.
//
// It reports each iteration back so the tool can show progress and a live
// shape rather than a spinner -- an optimisation that gives no sign of life
// for two minutes is indistinguishable from a hang.

import { voxelise } from "./voxelise.js";
import { optimiseTopology } from "./topology.js";
import { keptVoxels, voxelSurface } from "./voxelMesh.js";

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    const { grid, occ, fixed, forces, material, options, mmPerUnit } = args;
    const r = optimiseTopology({
      grid,
      occ,
      fixed,
      forces,
      material,
      ...options,
      onIteration: ({ iteration, compliance, change }) =>
        self.postMessage({ id, progress: { iteration, compliance, change } }),
    });
    const solid = keptVoxels({
      density: r.density,
      grid,
      threshold: options?.threshold ?? 0.5,
      seeds: args.seeds,
    });
    const positions = voxelSurface({ solid, grid, mmPerUnit });
    self.postMessage(
      {
        id,
        result: {
          positions,
          history: r.history,
          designElements: r.designElements,
          keptElements: solid.reduce((n, v) => n + v, 0),
        },
      },
      [positions.buffer],
    );
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
