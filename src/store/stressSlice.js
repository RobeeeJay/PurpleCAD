// Stress analysis: the tool's picks, and the field it produced.
//
// The RESULT is deliberately not part of the item.  It is one float per
// surface vertex -- mesh-sized -- and items are persisted into .pcad and
// frozen into every downstream op's `regenerator.source`, where mesh-dense
// data stacks up O(k^2) (see the "frozen sources nest" landmine in CLAUDE.md).
// It is also a view of a load case rather than part of the part, so it is
// transient: it lives here, keyed by item, and is dropped when the geometry it
// describes is rebuilt.

import {
  solveStressAsync,
  cancelStressWork,
} from "../three/fea/stressWorkerClient.js";
import { rampCeiling, stressVertexColors } from "../three/fea/stressColors.js";
import { buildStressMesh } from "../three/fea/stressMesh.js";
import { geometrySignature } from "../three/sceneObjects/stressDisplay.js";

// Mechanical properties, which the render materials do not carry: those are
// PBR appearance only.  Yield is what a reading is judged against.
export const STRUCTURAL_MATERIALS = [
  { name: "Steel", E: 200000, nu: 0.3, yield: 250 },
  { name: "Stainless", E: 193000, nu: 0.3, yield: 215 },
  { name: "Aluminium 6061", E: 68900, nu: 0.33, yield: 276 },
  { name: "Titanium", E: 114000, nu: 0.34, yield: 880 },
  { name: "ABS", E: 2300, nu: 0.35, yield: 40 },
  { name: "PLA", E: 3500, nu: 0.36, yield: 55 },
  { name: "Nylon", E: 2000, nu: 0.39, yield: 45 },
];

export const stressInitial = {
  // { phase, itemId, fixtures, loadFaces, params } while the tool is open.
  stressTool: null,
  // { itemId, vertexStress, display, ceiling, max, material, iterations } or null.
  stressResult: null,
  stressSolving: false,
};

export const createStressSlice = (set, get) => ({
  startStressTool: (itemId) =>
    set({
      stressTool: {
        phase: "fixtures",
        itemId,
        fixtures: [],
        loadFaces: [],
        params: {
          material: "Steel",
          forceN: 500,
          direction: [0, -1, 0],
          resolution: 40,
        },
      },
      stressResult: null,
    }),

  setStressPhase: (phase) =>
    set((s) =>
      s.stressTool ? { stressTool: { ...s.stressTool, phase } } : {},
    ),

  setStressParams: (partial) =>
    set((s) =>
      s.stressTool
        ? {
            stressTool: {
              ...s.stressTool,
              params: { ...s.stressTool.params, ...partial },
            },
          }
        : {},
    ),

  // A picked face set replaces whichever list the tool is currently on.
  setStressFaceSelection: ({ itemId, faceTris }) =>
    set((s) => {
      if (!s.stressTool) return {};
      const key = s.stressTool.phase === "loads" ? "loadFaces" : "fixtures";
      return {
        stressTool: {
          ...s.stressTool,
          itemId: itemId ?? s.stressTool.itemId,
          [key]: faceTris ?? [],
        },
      };
    }),

  cancelStressTool: () => {
    cancelStressWork();
    set({ stressTool: null, stressSolving: false });
  },

  clearStressResult: () => set({ stressResult: null }),

  runStressAnalysis: async ({
    itemId,
    fixtures,
    loads,
    materialName = "Steel",
    resolution = 40,
    theme,
  }) => {
    const state = get();
    const item = state.items.find((i) => i.id === itemId);
    if (!item?.geometryData?.positions?.length) return null;
    const material =
      STRUCTURAL_MATERIALS.find((m) => m.name === materialName) ??
      STRUCTURAL_MATERIALS[0];
    set({ stressSolving: true, toolError: null });
    try {
      const r = await solveStressAsync({
        positions: Array.from(item.geometryData.positions),
        indices: item.geometryData.indices
          ? Array.from(item.geometryData.indices)
          : null,
        material: { E: material.E, nu: material.nu },
        fixtures,
        loads,
        resolution,
      });
      // The plot gets its own resolution: the body's vertices are sampled for
      // the summary numbers, but what is DRAWN is a subdivided surface sampled
      // from the volumetric field.  A fused box has eight vertices, and a
      // per-vertex plot on it showed eight distinct colours for the whole
      // part.
      const display = buildStressMesh({
        positions: item.geometryData.positions,
        indices: item.geometryData.indices,
        solution: { grid: r.grid, field: r.field, occ: r.occ },
      });
      // The ramp's top is the material's YIELD, so a colour means a fraction
      // of the stress the part can actually take, and the top of the scale
      // means "at or past yield" -- the question an engineer is asking.
      //
      // Scaling to the field instead makes the plot mesh-dependent: the peak
      // is the singular element at the fixture (measured 1522 MPa against beam
      // theory's 288 for the same bar), and even the 98th percentile came out
      // at 351, above the true root stress, which flattened the whole part
      // onto the bottom of the ramp.
      const ceiling = material.yield;
      // Reported next to it, so the peak is visible without being allowed to
      // set the scale.
      const robustPeak = rampCeiling(display.stress);
      set({
        stressSolving: false,
        stressResult: {
          itemId,
          vertexStress: r.vertexStress,
          display: {
            positions: display.positions,
            colors: stressVertexColors(display.stress, {
              theme: theme ?? get().theme,
              ceiling,
            }),
            stress: display.stress,
          },
          ceiling,
          robustPeak,
          max: r.max,
          material,
          iterations: r.iterations,
          signature: geometrySignature(item.geometryData.positions),
        },
      });
      return get().stressResult;
    } catch (e) {
      set({ stressSolving: false, toolError: e.message });
      return null;
    }
  },
});
