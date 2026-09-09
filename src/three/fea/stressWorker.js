// Web Worker body for the stress solve: a part-sized model is seconds of
// conjugate gradient, and on the main thread that freezes the viewport.
//
// The maths lives in stressField.js (pure arrays, no DOM / THREE), so it runs
// here unchanged.

import { solveStressField } from "./stressField.js";

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    const r = solveStressField(args);
    // The volumetric field and its grid DO cross back: the display mesh
    // samples them directly, because a CAD body's own vertices are far too
    // sparse to carry a plot.  The displacement vector does not -- it is three
    // floats per node and nothing outside the solver reads it.
    self.postMessage(
      {
        id,
        result: {
          vertexStress: r.vertexStress,
          field: r.field,
          occ: r.occ,
          grid: r.grid,
          max: r.max,
          iterations: r.iterations,
          residual: r.residual,
          converged: r.converged,
          unsupportedLoad: r.unsupportedLoad,
          elements: r.elements,
        },
      },
      [r.vertexStress.buffer, r.field.buffer, r.occ.buffer],
    );
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
