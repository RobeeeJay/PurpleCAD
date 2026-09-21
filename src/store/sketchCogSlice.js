// Sketch Cog tool: pick a centre point, set the gear's parameters, Confirm.
// The result is a `cog` shape locked by a `cog` constraint -- an editable
// primitive, re-opened by double-clicking its marker -- or, with "break into
// vectors", plain lines that are no longer a cog.  The picking click and the
// preview live in three/cameraControls/sketchCogTool.js.  Composed into the
// sketch slice via spread, like the centre and pattern-tool slices.

import {
  pushSketchSnapshot,
  withOrphanFlags,
  saveTimeline,
  markCsgDirty,
  remapConstraintShapeIndices,
} from "./internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import {
  cogProblem,
  cogShapeContours,
  makeCogShape,
} from "../three/cogGeometry.js";
import { explodeContours } from "../three/sketchGeometry.js";

// A new cog's starting values, in mm (teeth are a count).
export const COG_DEFAULTS = {
  pitchDiameter: 40,
  holeDiameter: 8,
  teeth: 20,
  backlash: 0,
  rootFillet: 0.5,
};
// The length parameters -- the ones the dialog shows in mm and the shape
// stores in scene units.
const LENGTHS = ["pitchDiameter", "holeDiameter", "backlash", "rootFillet"];

// The dialog's mm values as a shape's scene-unit parameters.
export const cogParamsFromMm = (mm) => ({
  ...Object.fromEntries(LENGTHS.map((k) => [k, mm[k] / MM_PER_UNIT])),
  teeth: mm.teeth,
});
const mmFromShape = (shape) => ({
  ...Object.fromEntries(LENGTHS.map((k) => [k, shape[k] * MM_PER_UNIT])),
  teeth: shape.teeth,
});

// What stops Confirm, in words: no centre yet, or parameters that can't make a
// gear.
export function cogToolProblem(tool) {
  if (!tool.centre) return "Pick the centre first.";
  return cogProblem(cogParamsFromMm(tool.params));
}

// The shape the dialog describes, at its centre, keeping an edited cog's
// rotation.  Shared by the preview and the commit, so the ghost is exactly what
// Confirm makes.
export const cogShapeFromTool = (tool) => ({
  ...makeCogShape({ ...tool.centre, ...cogParamsFromMm(tool.params) }),
  ...(tool.rotation ? { rotation: tool.rotation } : null),
});

// Write a sketch's new shapes and constraints: an undo step, the items, and the
// sketch's create entry on the timeline (which is what a reload replays).
function commitSketch(state, sketchId, shapes, constraints) {
  pushSketchSnapshot(state, sketchId);
  const updatedItems = state.items.map((it) =>
    it.id === sketchId ? Object.assign({}, it, { shapes, constraints }) : it,
  );
  const newHistory = state.history.map((entry) =>
    entry.instruction?.type === "create" &&
    entry.instruction.item?.id === sketchId
      ? Object.assign({}, entry, {
          instruction: Object.assign({}, entry.instruction, {
            item: Object.assign({}, entry.instruction.item, {
              shapes,
              constraints,
            }),
          }),
        })
      : entry,
  );
  saveTimeline(newHistory, state.activeHistoryId);
  return {
    items: markCsgDirty(updatedItems),
    history: withOrphanFlags(newHistory),
  };
}

const closed = (state) => ({
  activeSketchTool:
    state.activeSketchTool === "cog" ? null : state.activeSketchTool,
  sketchCogState: null,
});

export const createSketchCogSlice = (set) => ({
  // { picking: boolean, centre: {x,y}|null, params: mm values, explode,
  //   rotation, editIdx: shape index|null, constraintIdx: number|null } | null
  sketchCogState: null,

  // The dialog opens straight away with its Centre button live.
  startCogTool: () =>
    set({
      activeSketchTool: "cog",
      sketchCogState: {
        picking: true,
        centre: null,
        params: { ...COG_DEFAULTS },
        explode: false,
        rotation: 0,
        editIdx: null,
        constraintIdx: null,
      },
    }),

  cancelCogTool: () => set((state) => closed(state)),

  setCogPicking: (picking) =>
    set((state) =>
      state.sketchCogState
        ? { sketchCogState: { ...state.sketchCogState, picking } }
        : {},
    ),

  pickCogCentre: (centre) =>
    set((state) =>
      state.sketchCogState?.picking
        ? {
            sketchCogState: {
              ...state.sketchCogState,
              centre: { x: centre.x, y: centre.y },
              picking: false,
            },
          }
        : {},
    ),

  setCogParam: (key, value) =>
    set((state) => {
      const cur = state.sketchCogState;
      if (!cur) return {};
      return {
        sketchCogState: { ...cur, params: { ...cur.params, [key]: value } },
      };
    }),

  setCogExplode: (explode) =>
    set((state) =>
      state.sketchCogState
        ? { sketchCogState: { ...state.sketchCogState, explode } }
        : {},
    ),

  // Re-open the dialog on an existing cog (double-click its marker); Confirm
  // then replaces it in place.
  beginCogEdit: (sketchId, constraintIdx) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const c = (item?.constraints || [])[constraintIdx];
      const shape = (item?.shapes || [])[c?.shapeIdx];
      if (c?.type !== "cog" || shape?.type !== "cog") return {};
      return {
        activeSketchTool: "cog",
        sketchCogState: {
          picking: false,
          centre: { x: shape.x, y: shape.y },
          params: mmFromShape(shape),
          explode: false,
          rotation: shape.rotation || 0,
          editIdx: c.shapeIdx,
          constraintIdx,
        },
      };
    }),

  confirmCog: (sketchId) =>
    set((state) => {
      const tool = state.sketchCogState;
      const item = state.items.find((i) => i.id === sketchId);
      if (!tool || !item) return {};
      const problem = cogToolProblem(tool);
      if (problem) return { notification: problem };

      const cog = cogShapeFromTool(tool);
      const shapes = item.shapes || [];
      const constraints = item.constraints || [];
      const editing =
        tool.editIdx != null &&
        shapes[tool.editIdx]?.type === "cog" &&
        constraints[tool.constraintIdx]?.type === "cog";

      if (!tool.explode) {
        const next = editing
          ? {
              shapes: shapes.map((s, i) => (i === tool.editIdx ? cog : s)),
              constraints,
            }
          : {
              shapes: [...shapes, cog],
              constraints: [
                ...constraints,
                { type: "cog", shapeIdx: shapes.length },
              ],
            };
        return {
          ...commitSketch(state, sketchId, next.shapes, next.constraints),
          ...closed(state),
        };
      }

      // Break into vectors: the outline and hole become closed chains of
      // lines joined by coincident constraints, and no cog is left behind.  An
      // edited cog is replaced, so everything after it shifts down one index.
      let keptShapes = shapes;
      let keptConstraints = constraints;
      if (editing) {
        const indexMap = new Map();
        let ni = 0;
        shapes.forEach((_, i) =>
          indexMap.set(i, i === tool.editIdx ? -1 : ni++),
        );
        keptShapes = shapes.filter((_, i) => i !== tool.editIdx);
        keptConstraints = constraints
          .map((c) => remapConstraintShapeIndices(c, indexMap))
          .filter(Boolean);
      }
      const lines = explodeContours(cogShapeContours(cog), keptShapes.length);
      return {
        ...commitSketch(
          state,
          sketchId,
          [...keptShapes, ...lines.shapes],
          [...keptConstraints, ...lines.constraints],
        ),
        ...closed(state),
      };
    }),
});
