// The angle dimension between two sketch lines: opening its field, and applying
// a value to a new or existing constraint.  Composed into the sketch slice via
// spread, like the offset and centre slices.

import {
  pushSketchSnapshot,
  withOrphanFlags,
  saveTimeline,
  invalidateEdit,
} from "./internals.js";
import { solveConstraints, varFields } from "../three/sketchSolver.js";
import {
  angleSense,
  linesAngleDeg,
  turnLineToAngle,
} from "../three/sketchAngle.js";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";

const REFUSED = "Can't apply that angle — it would break another constraint";

export const createSketchAngleSlice = (set) => ({
  // { shapeAIdx, shapeBIdx, defaultAngle, constraintIdx? } | null
  sketchAngleInput: null,
  setSketchAngleInput: (v) => set({ sketchAngleInput: v }),

  // Open the field on two picked lines, seeded with the angle they make now.
  beginSketchAngle: (sketchId, idxA, idxB) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const a = item?.shapes?.[idxA];
      const b = item?.shapes?.[idxB];
      if (a?.type !== "line" || b?.type !== "line")
        return { notification: "Angle needs two lines." };
      const now = linesAngleDeg(a, b, angleSense(a, b));
      return {
        sketchAngleInput: {
          shapeAIdx: idxA,
          shapeBIdx: idxB,
          // Lines lying along each other make no angle to keep.
          defaultAngle: now > 0.01 && now < 179.99 ? now.toFixed(2) : "90",
        },
      };
    }),

  applySketchAngle: (sketchId, raw) =>
    set((state) => {
      const input = state.sketchAngleInput;
      const item = state.items.find((i) => i.id === sketchId);
      if (!input || !item) return {};
      const variables = variablesToMap(state.variables);
      const deg = evaluateFormula(raw, variables);
      // 0 and 180 are parallel, which has its own constraint; the residual
      // can't steer towards them either, having no slope there.
      if (!Number.isFinite(deg) || deg <= 0 || deg >= 180)
        return {
          notification: "An angle has to be between 0 and 180 degrees.",
        };
      const { shapeAIdx: idxA, shapeBIdx: idxB, constraintIdx } = input;
      const shapes = item.shapes;
      const a = shapes[idxA];
      const b = shapes[idxB];
      const sense =
        constraintIdx != null
          ? item.constraints[constraintIdx].sense
          : angleSense(a, b);
      const constraints =
        constraintIdx != null
          ? item.constraints.map((c, i) =>
              i === constraintIdx ? { ...c, angle: raw } : c,
            )
          : [
              ...(item.constraints || []),
              {
                type: "angleDimension",
                shapeAIdx: idxA,
                shapeBIdx: idxB,
                sense,
                angle: raw,
              },
            ];
      const fixedAllBut = (free) => {
        const fixed = new Set();
        shapes.forEach((sh, i) => {
          if (free.includes(i)) return;
          for (const f of varFields(sh)) fixed.add(`${i}:${f}`);
        });
        return fixed;
      };
      const seeded = (idx) => {
        const input2 = shapes.slice();
        input2[idx] =
          idx === idxA
            ? turnLineToAngle(a, b, sense, deg)
            : turnLineToAngle(b, a, sense, deg);
        return input2;
      };
      // Minimise movement: the first-picked line alone, then the other alone
      // (the first may be pinned to an axis), both, then the whole sketch.
      let solved = null;
      for (const [turned, free] of [
        [idxA, [idxA]],
        [idxB, [idxB]],
        [idxA, [idxA, idxB]],
        [idxA, null],
        [idxB, null],
      ]) {
        const res = solveConstraints(seeded(turned), constraints, {
          variables,
          ...(free ? { fixed: fixedAllBut(free) } : {}),
        });
        if (res.ok) {
          solved = res.shapes;
          break;
        }
      }
      if (!solved) return { sketchAngleInput: null, notification: REFUSED };

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId ? { ...it, shapes: solved, constraints } : it,
      );
      const newHistory = state.history.map((entry) =>
        entry.instruction?.type === "create" &&
        entry.instruction.item?.id === sketchId
          ? {
              ...entry,
              instruction: {
                ...entry.instruction,
                item: {
                  ...entry.instruction.item,
                  shapes: solved,
                  constraints,
                },
              },
            }
          : entry,
      );
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        sketchAngleInput: null,
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),
});
