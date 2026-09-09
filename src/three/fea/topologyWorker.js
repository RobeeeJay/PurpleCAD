// Web Worker body for the topology optimisation: tens of conjugate-gradient
// solves, which would freeze the viewport for minutes on the main thread.
//
// It reports each iteration back so the tool can show progress and a live
// shape rather than a spinner -- an optimisation that gives no sign of life
// for two minutes is indistinguishable from a hang.

import { voxelise } from "./voxelise.js";
import { optimiseTopology } from "./topology.js";
import { keptVoxels } from "./voxelMesh.js";
import { surfaceNets } from "./surfaceNets.js";

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    const { grid, occ, fixed, forces, material, options, mmPerUnit } = args;
    const iso = options?.threshold ?? 0.5;
    // The surface of whatever the densities currently say, extracted in the
    // worker and transferred out: a run is minutes, and watching the shape
    // find itself is what tells you the load case was set up right. A step
    // counter alone cannot -- a wrong answer counts up just as steadily.
    const frame = (density) => {
      const net = surfaceNets({ density, grid, iso, mmPerUnit });
      let kept = 0;
      for (let e = 0; e < density.length; e++) if (density[e] >= iso) kept++;
      return { net, kept };
    };
    const r = optimiseTopology({
      grid,
      occ,
      fixed,
      forces,
      material,
      ...options,
      onIteration: ({ iteration, compliance, change, density }) => {
        const { net, kept } = frame(density);
        self.postMessage(
          {
            id,
            progress: {
              iteration,
              compliance,
              change,
              kept,
              positions: net.positions,
              indices: net.indices,
            },
          },
          [net.positions.buffer, net.indices.buffer],
        );
      },
    });
    const solid = keptVoxels({
      density: r.density,
      grid,
      threshold: options?.threshold ?? 0.5,
      seeds: args.seeds,
    });
    // The surface follows the CONTINUOUS density, not the thresholded blocks:
    // the connectivity filter only decides which regions survive, so its
    // verdict is applied by zeroing the density of what it dropped.
    const masked = Float64Array.from(r.density, (d, e) => (solid[e] ? d : 0));
    const { positions, indices } = surfaceNets({
      density: masked,
      grid,
      iso: options?.threshold ?? 0.5,
      mmPerUnit,
    });
    self.postMessage(
      {
        id,
        result: {
          positions,
          indices,
          history: r.history,
          designElements: r.designElements,
          keptElements: solid.reduce((n, v) => n + v, 0),
        },
      },
      [positions.buffer, indices.buffer],
    );
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
