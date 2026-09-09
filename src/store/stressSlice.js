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
import { buildLoadCase } from "../three/fea/stressField.js";
import {
  cancelOptimisation,
  optimiseAsync,
} from "../three/fea/topologyWorkerClient.js";
import { maxItemId } from "./internals.js";
import { geometrySignature } from "../three/sceneObjects/stressDisplay.js";

// Mechanical properties, which the render materials do not carry: those are
// PBR appearance only.  Yield is what a reading is judged against.
//
// Nominal BULK figures.  A printed part is weaker than its material and
// anisotropic with it -- layer adhesion governs, so a load pulling across the
// layers can fail well under these numbers.  Treat them as the optimistic end.
export const STRUCTURAL_MATERIALS = [
  { name: "Steel", E: 200000, nu: 0.3, yield: 250 },
  { name: "Stainless", E: 193000, nu: 0.3, yield: 215 },
  { name: "Aluminium 6061", E: 68900, nu: 0.33, yield: 276 },
  { name: "Titanium", E: 114000, nu: 0.34, yield: 880 },
  { name: "ABS", E: 2300, nu: 0.35, yield: 40 },
  { name: "PLA", E: 3500, nu: 0.36, yield: 55 },
  { name: "Nylon", E: 2000, nu: 0.39, yield: 45 },
  { name: "PETG", E: 2100, nu: 0.38, yield: 50 },
];

// What the tool opens on.
export const DEFAULT_STRUCTURAL_MATERIAL = "PETG";

// Whether a body can be analysed at all.
//
// Derived from the ITEM, deliberately, so it is reactive: asking the scene
// whether a mesh exists answers "not yet" on the render a selection triggers
// -- the mesh is built by an effect that runs after it -- and nothing renders
// again afterwards, so the button stays dead on a body that is perfectly
// analysable.
//
// Booleans and the modify ops leave a baked mesh; extrudes are built
// analytically but get real triangles in the scene. Primitives are raymarched
// on a box hull, so they have no triangles to pick faces from and are excluded
// rather than offered and then unable to take a pick.
export const isAnalysableBody = (item) =>
  !!item &&
  (!!item.geometryData?.positions?.length ||
    item.type === "extrude" ||
    item.type === "csg");

export const stressInitial = {
  // { phase, itemId, fixtures, loadFaces, params } while the tool is open.
  stressTool: null,
  // { itemId, vertexStress, display, ceiling, max, material, iterations } or null.
  stressResult: null,
  stressSolving: false,

  // Generative design: the same picks as a stress case, plus a volume budget.
  // { phase, itemId, fixtures, loadFaces, params } while the tool is open.
  optimiseTool: null,
  // { positions, keptElements, designElements, history } once it has run.
  optimiseResult: null,
  optimiseProgress: null,
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
          material: DEFAULT_STRUCTURAL_MATERIAL,
          forceN: 500,
          // Straight down in the USER frame, where Z is up (axisDisplay.js).
          direction: [0, 0, -1],
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

  // Start the picks over without closing the tool: the force, material and
  // detail the user has already set are theirs to keep.
  clearStressFaces: () =>
    set((st) =>
      st.stressTool
        ? {
            stressTool: { ...st.stressTool, fixtures: [], loadFaces: [] },
          }
        : {},
    ),

  cancelStressTool: () => {
    cancelStressWork();
    set({ stressTool: null, stressSolving: false });
  },

  clearStressResult: () => set({ stressResult: null }),

  startOptimiseTool: (itemId) =>
    set({
      optimiseTool: {
        phase: "fixtures",
        itemId,
        fixtures: [],
        loadFaces: [],
        params: {
          material: DEFAULT_STRUCTURAL_MATERIAL,
          forceN: 500,
          direction: [0, 0, -1],
          resolution: 28,
          volumeFraction: 0.4,
          iterations: 25,
        },
      },
      optimiseResult: null,
      optimiseProgress: null,
    }),

  setOptimisePhase: (phase) =>
    set((s) =>
      s.optimiseTool ? { optimiseTool: { ...s.optimiseTool, phase } } : {},
    ),

  setOptimiseParams: (partial) =>
    set((s) =>
      s.optimiseTool
        ? {
            optimiseTool: {
              ...s.optimiseTool,
              params: { ...s.optimiseTool.params, ...partial },
            },
          }
        : {},
    ),

  setOptimiseFaceSelection: ({ itemId, faceTris }) =>
    set((s) => {
      if (!s.optimiseTool) return {};
      const key = s.optimiseTool.phase === "loads" ? "loadFaces" : "fixtures";
      return {
        optimiseTool: {
          ...s.optimiseTool,
          itemId: itemId ?? s.optimiseTool.itemId,
          [key]: faceTris ?? [],
        },
      };
    }),

  clearOptimiseFaces: () =>
    set((s) =>
      s.optimiseTool
        ? { optimiseTool: { ...s.optimiseTool, fixtures: [], loadFaces: [] } }
        : {},
    ),

  cancelOptimiseTool: () => {
    cancelOptimisation();
    set({ optimiseTool: null, optimiseResult: null, optimiseProgress: null });
  },

  // Run SIMP over the picked load case.  The design space is the body itself,
  // so the same voxelisation and boundary conditions the stress view uses
  // drive it -- including how load that lands on nodes with no material is
  // handled, which must not be re-derived.
  runOptimisation: async () => {
    const state = get();
    const tool = state.optimiseTool;
    if (!tool) return null;
    const item = state.items.find((i) => i.id === tool.itemId);
    const surface = item?.geometryData?.positions?.length
      ? item.geometryData
      : state._cameraControls?.meshSurface?.(tool.itemId);
    if (!surface?.positions?.length) return null;
    const material =
      STRUCTURAL_MATERIALS.find((m) => m.name === tool.params.material) ??
      STRUCTURAL_MATERIALS[0];
    const [dx, dy, dz] = tool.params.direction;
    const force = [dx, dz, -dy].map((c) => c * tool.params.forceN);
    const load = buildLoadCase({
      positions: Array.from(surface.positions),
      indices: surface.indices ? Array.from(surface.indices) : null,
      fixtures: tool.fixtures,
      loads: [{ soup: tool.loadFaces, force }],
      resolution: tool.params.resolution,
    });
    // Held voxels seed the connectivity check: material that ends up joined to
    // nothing that is held would print as a loose lump.
    const seeds = [];
    const { grid, occ } = load;
    for (let e = 0; e < occ.length; e++) {
      if (!occ[e]) continue;
      const i = e % grid.nx,
        j = Math.floor(e / grid.nx) % grid.ny,
        k = Math.floor(e / (grid.nx * grid.ny));
      const n = i + (grid.nx + 1) * (j + (grid.ny + 1) * k);
      if (load.fixed[n * 3]) seeds.push(e);
    }
    set({ optimiseProgress: { iteration: 0, of: tool.params.iterations } });
    try {
      const r = await optimiseAsync(
        {
          grid,
          occ,
          fixed: load.fixed,
          forces: load.forces,
          material: { E: material.E, nu: material.nu },
          seeds,
          mmPerUnit: 10,
          options: {
            volumeFraction: tool.params.volumeFraction,
            iterations: tool.params.iterations,
          },
        },
        (p) =>
          set({
            optimiseProgress: {
              iteration: p.iteration + 1,
              of: tool.params.iterations,
              compliance: p.compliance,
            },
          }),
      );
      set({ optimiseResult: r, optimiseProgress: null });
      return r;
    } catch (e) {
      set({ optimiseProgress: null, toolError: e.message });
      return null;
    }
  },

  // Commit the optimised shape as a new body beside the original, rather than
  // replacing it: the input is a design SPACE, and keeping it means the run
  // can be repeated with a different budget.
  applyOptimisation: () =>
    set((state) => {
      const r = state.optimiseResult;
      const tool = state.optimiseTool;
      if (!r?.positions?.length || !tool) return {};
      const source = state.items.find((i) => i.id === tool.itemId);
      const id = maxItemId(state.history) + 1;
      const item = {
        id,
        name: `${source?.name ?? "Body"} optimised`,
        type: "csg",
        children: [],
        parentId: null,
        position: source?.position ?? { x: 0, y: 0, z: 0 },
        rotation: source?.rotation ?? { x: 0, y: 0, z: 0 },
        scale: source?.scale ?? { x: 1, y: 1, z: 1 },
        material: source?.material,
        geometryData: {
          positions: Array.from(r.positions),
          normals: null,
          indices: null,
        },
      };
      get().addItem(item, "Optimised");
      // Hide the blank rather than delete it: the two occupy the same space,
      // so leaving both visible shows the block you started from and none of
      // the result. It stays in the tree to be un-hidden, or re-run against a
      // different budget.
      if (source) get().toggleItemVisibility(source.id);
      return { optimiseResult: null, optimiseTool: null };
    }),

  runStressAnalysis: async ({
    itemId,
    fixtures,
    loads,
    materialName = DEFAULT_STRUCTURAL_MATERIAL,
    resolution = 40,
    theme,
  }) => {
    const state = get();
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return null;
    // A baked mesh when there is one; otherwise the surface the renderer is
    // drawing, which is what an extrude or a primitive has instead.
    const surface = item.geometryData?.positions?.length
      ? item.geometryData
      : state._cameraControls?.meshSurface?.(itemId);
    if (!surface?.positions?.length) return null;
    const material =
      STRUCTURAL_MATERIALS.find((m) => m.name === materialName) ??
      STRUCTURAL_MATERIALS[0];
    set({ stressSolving: true, toolError: null });
    try {
      const startedAt = Date.now();
      const r = await solveStressAsync({
        positions: Array.from(surface.positions),
        indices: surface.indices ? Array.from(surface.indices) : null,
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
        positions: surface.positions,
        indices: surface.indices,
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
      if (r.converged === false)
        throw new Error(
          "The load case could not be solved: check that the held faces really hold the part.",
        );
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
          elements: r.elements,
          seconds: (Date.now() - startedAt) / 1000,
          unsupportedLoad: r.unsupportedLoad,
          signature: geometrySignature(surface.positions),
        },
      });
      return get().stressResult;
    } catch (e) {
      set({ stressSolving: false, toolError: e.message });
      return null;
    }
  },
});
