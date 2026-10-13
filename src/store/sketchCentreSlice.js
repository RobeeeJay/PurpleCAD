// Sketch Centre tool: pick two connected shapes (A, then B) and hold the centre
// of A on the centre of B, plus an X/Y offset.  The pick state, the commit, and
// the re-open-to-edit path live here; the picking clicks and the preview live
// in three/cameraControls/sketchCentreTool.js.  Composed into the sketch slice
// via spread, like the offset and pattern-tool slices.

import {
  pushSketchSnapshot,
  withOrphanFlags,
  saveTimeline,
  invalidateEdit,
} from "./internals.js";
import { solveConstraints, varFields } from "../three/sketchSolver.js";
import { resolveValue } from "../three/geometryParams.js";
import { shapeSetCentre, translateShape } from "../three/sketchGeometry.js";

// An offset as the constraint stores it: a mm formula STRING.  A bare number on
// a constraint means legacy scene units, so a number typed as millimetres has
// to be written down as text to keep meaning millimetres.
export const asMmFormula = (v) =>
  v == null || v === "" ? "0" : typeof v === "number" ? String(v) : v;

export const moveShape = (shape, dx, dy) =>
  shape.type === "point"
    ? { ...shape, x: shape.x + dx, y: shape.y + dy }
    : (translateShape(shape, dx, dy) ?? shape);

// How far Shape A has to travel for its centre to land on Shape B's plus the
// offset, in scene units.  Shared by the commit and the dialog's preview, so
// the ghost shows exactly where Confirm will put the shape.
export const centreMove = (shapes, shapesA, shapesB, offsetX, offsetY) => {
  const a = shapeSetCentre(shapes, shapesA);
  const b = shapeSetCentre(shapes, shapesB);
  if (!a || !b) return null;
  return {
    dx: b.x + resolveValue(asMmFormula(offsetX)) - a.x,
    dy: b.y + resolveValue(asMmFormula(offsetY)) - a.y,
    target: {
      x: b.x + resolveValue(asMmFormula(offsetX)),
      y: b.y + resolveValue(asMmFormula(offsetY)),
    },
  };
};

// Every variable field of every shape except `keep` -- pinned, so a solve can
// only move what is left.
const fixAllBut = (shapes, keep) => {
  const fixed = new Set();
  shapes.forEach((shape, i) => {
    if (keep.has(i)) return;
    for (const f of varFields(shape)) fixed.add(`${i}:${f}`);
  });
  return fixed;
};

export const createSketchCentreSlice = (set) => ({
  // { picking: "A"|"B"|null, shapesA: number[], shapesB: number[],
  //   offsetX, offsetY, editIdx: number|null } | null
  sketchCentreState: null,

  startCentreTool: () =>
    set({
      activeSketchTool: "centre",
      sketchCentreState: {
        picking: "A",
        shapesA: [],
        shapesB: [],
        offsetX: "0",
        offsetY: "0",
        editIdx: null,
      },
    }),

  cancelCentreTool: () =>
    set((state) => ({
      activeSketchTool:
        state.activeSketchTool === "centre" ? null : state.activeSketchTool,
      sketchCentreState: null,
    })),

  setCentrePicking: (picking) =>
    set((state) =>
      state.sketchCentreState
        ? { sketchCentreState: { ...state.sketchCentreState, picking } }
        : {},
    ),

  // Record the shape just clicked for whichever button is live.  Picking A
  // moves straight on to B while B is still empty, so the natural two clicks
  // need no trip to the dialog in between.
  pickCentreShape: (indices) =>
    set((state) => {
      const cur = state.sketchCentreState;
      if (!cur?.picking || !indices?.length) return {};
      if (cur.picking === "A")
        return {
          sketchCentreState: {
            ...cur,
            shapesA: indices,
            picking: cur.shapesB.length ? null : "B",
          },
        };
      return {
        sketchCentreState: { ...cur, shapesB: indices, picking: null },
      };
    }),

  setCentreOffset: (axis, value) =>
    set((state) => {
      const cur = state.sketchCentreState;
      if (!cur) return {};
      const key = axis === "x" ? "offsetX" : "offsetY";
      return { sketchCentreState: { ...cur, [key]: value } };
    }),

  // Re-open the tool on an existing centre constraint (double-click its icon).
  // Confirm then updates it in place rather than adding a second one.
  beginCentreEdit: (sketchId, constraintIdx) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const c = (item?.constraints || [])[constraintIdx];
      if (!c || c.type !== "centre") return {};
      return {
        activeSketchTool: "centre",
        sketchCentreState: {
          picking: null,
          shapesA: c.shapesA,
          shapesB: c.shapesB,
          offsetX: c.offsetX ?? "0",
          offsetY: c.offsetY ?? "0",
          editIdx: constraintIdx,
        },
      };
    }),

  // Move Shape A so its centre sits on Shape B's (plus the offset), and keep it
  // there.  A is moved RIGIDLY first -- a shape's own constraints all survive a
  // translation -- and the whole sketch is then solved, so anything A is tied
  // to elsewhere follows.  The solve tries to disturb as little as it can:
  // everything but A held still, then B held still, then nothing held.  If no
  // arrangement satisfies every constraint, nothing changes.
  confirmCentre: (sketchId) =>
    set((state) => {
      const tool = state.sketchCentreState;
      const item = state.items.find((i) => i.id === sketchId);
      if (!tool || !item) return {};
      const { shapesA, shapesB, editIdx } = tool;
      if (!shapesA.length || !shapesB.length) return {};
      if (shapesA.some((i) => shapesB.includes(i)))
        return {
          notification:
            "Shape A and Shape B are the same shape — pick two separate shapes.",
        };

      const shapes = item.shapes || [];
      const offsetX = asMmFormula(tool.offsetX);
      const offsetY = asMmFormula(tool.offsetY);
      const move = centreMove(shapes, shapesA, shapesB, offsetX, offsetY);
      if (!move) return {};

      const constraint = { type: "centre", shapesA, shapesB, offsetX, offsetY };
      const existing = item.constraints || [];
      const constraints =
        editIdx != null && existing[editIdx]?.type === "centre"
          ? existing.map((c, i) => (i === editIdx ? constraint : c))
          : [...existing, constraint];

      const { dx, dy } = move;
      const inA = new Set(shapesA);
      const moved = shapes.map((s, i) =>
        inA.has(i) ? moveShape(s, dx, dy) : s,
      );
      const everythingButB = new Set(shapes.map((_, i) => i));
      shapesB.forEach((i) => everythingButB.delete(i));
      let solved = null;
      for (const fixed of [
        fixAllBut(shapes, inA),
        fixAllBut(shapes, everythingButB),
        new Set(),
      ]) {
        const res = solveConstraints(moved, constraints, { fixed });
        if (res.ok) {
          solved = res.shapes;
          break;
        }
      }
      if (!solved)
        return {
          notification:
            "Can't centre those shapes — it would break another constraint",
        };

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, { shapes: solved, constraints })
          : it,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
        activeSketchTool:
          state.activeSketchTool === "centre" ? null : state.activeSketchTool,
        sketchCentreState: null,
      };
    }),
});
