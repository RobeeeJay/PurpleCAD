// Sketch-related actions + interaction state.
//
// Mutations follow a common pattern: snapshot the sketch's shapes /
// constraints for per-sketch undo (`pushSketchSnapshot`), update items,
// rewrite the matching CREATE history entry so the shape changes
// survive reload + replay, persist, and return.

import {
  pushSketchSnapshot,
  withOrphanFlags,
  saveTimeline,
  markCsgDirty,
} from "./internals.js";
import { createSketchUndoSlice } from "./sketchUndoSlice.js";
import { solveConstraints, varFields } from "../three/sketchSolver.js";
import { resolveValue } from "../three/geometryParams.js";

export const createSketchSlice = (set) => ({
  ...createSketchUndoSlice(set),

  // --- Interaction state ---
  activeSketchTool: null,
  setActiveSketchTool: (tool) => set({ activeSketchTool: tool }),

  selectedSketchElement: null, // { type:'point'|'line', shapeIdx, pointKey? }
  setSelectedSketchElement: (el) => set({ selectedSketchElement: el }),

  sketchConstraintMode: null, // 'coincident' | 'distance' | null
  setSketchConstraintMode: (mode) => set({ sketchConstraintMode: mode }),

  sketchDistanceInput: null,
  setSketchDistanceInput: (v) => set({ sketchDistanceInput: v }),

  sketchModifyMode: null, // 'chamfer' | 'bevel' | null
  setSketchModifyMode: (mode) => set({ sketchModifyMode: mode }),

  sketchConstraintFirstPoint: null, // { shapeIdx, pointKey } | null
  setSketchConstraintFirstPoint: (pt) =>
    set({ sketchConstraintFirstPoint: pt }),

  sketchMultiSelectedIndices: [],
  setSketchMultiSelectedIndices: (v) => set({ sketchMultiSelectedIndices: v }),

  sketchLongPressMenu: null, // { x, y, items: [{kind, label, ...}] } | null
  setSketchLongPressMenu: (v) => set({ sketchLongPressMenu: v }),

  // --- Shape + constraint mutations ---
  addSketchConstraints: (sketchId, newConstraints) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              constraints: [...(item.constraints || []), ...newConstraints],
            })
          : item,
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
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  updateSketchShapes: (sketchId, updatesMap) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        return Object.assign({}, item, {
          shapes: (item.shapes || []).map((s, i) =>
            updatesMap.has(i) ? updatesMap.get(i) : s,
          ),
        });
      });
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
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  updateSketchShape: (sketchId, shapeIdx, newShape) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: item.shapes.map((s, i) =>
                i === shapeIdx ? newShape : s,
              ),
            })
          : item,
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
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  addSketchShapes: (sketchId, newShapes, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), ...newShapes],
              constraints: [...(item.constraints || []), ...newConstraints],
            })
          : item,
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  addSketchShape: (sketchId, shape, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), shape],
              constraints: [...(item.constraints || []), ...newConstraints],
            })
          : item,
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  applySketchModify: (
    sketchId,
    shapeUpdatesMap,
    newShape,
    removeConstraintPred,
    addConstraints = [],
  ) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shapes = (item.shapes || []).map((s, i) =>
          shapeUpdatesMap.has(i) ? shapeUpdatesMap.get(i) : s,
        );
        shapes.push(newShape);
        const constraints = [
          ...(item.constraints || []).filter((c) => !removeConstraintPred(c)),
          ...addConstraints,
        ];
        return Object.assign({}, item, { shapes, constraints });
      });
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  deleteSketchShapes: (sketchId, indicesToDelete) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const deleteSet = new Set(indicesToDelete);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const oldShapes = item.shapes || [];
        const indexMap = new Map();
        let newIdx = 0;
        oldShapes.forEach((_, i) => {
          indexMap.set(i, deleteSet.has(i) ? -1 : newIdx++);
        });
        const shapes = oldShapes.filter((_, i) => !deleteSet.has(i));
        const constraints = (item.constraints || [])
          .filter((c) => {
            if (c.type === "onLine")
              return (
                indexMap.get(c.pointShapeIdx) !== -1 &&
                indexMap.get(c.lineShapeIdx) !== -1
              );
            if (c.type === "horizontal" || c.type === "vertical")
              return indexMap.get(c.shapeIdx) !== -1;
            return (
              indexMap.get(c.shapeAIdx) !== -1 &&
              indexMap.get(c.shapeBIdx) !== -1
            );
          })
          .map((c) => {
            if (c.type === "onLine")
              return {
                ...c,
                pointShapeIdx: indexMap.get(c.pointShapeIdx),
                lineShapeIdx: indexMap.get(c.lineShapeIdx),
              };
            if (c.type === "horizontal" || c.type === "vertical")
              return { ...c, shapeIdx: indexMap.get(c.shapeIdx) };
            return {
              ...c,
              shapeAIdx: indexMap.get(c.shapeAIdx),
              shapeBIdx: indexMap.get(c.shapeBIdx),
            };
          });
        return Object.assign({}, item, { shapes, constraints });
      });
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  applySketchHVConstraint: (sketchId, shapeIdx, type) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const shape = item && (item.shapes || [])[shapeIdx];
      if (!item || !shape || shape.type !== "line") return {};
      // Replace any existing H/V on this shape with the requested one.
      const constraints = [
        ...(item.constraints || []).filter(
          (c) =>
            !(
              (c.type === "horizontal" || c.type === "vertical") &&
              c.shapeIdx === shapeIdx
            ),
        ),
        { type, shapeIdx },
      ];
      // Pre-level the line as a hint, then numerically solve the WHOLE system so
      // connected geometry (angles, coincidents, …) is resolved together.  If
      // the constraint can't be satisfied the whole change is rejected.
      const my = (shape.y1 + shape.y2) / 2;
      const mx = (shape.x1 + shape.x2) / 2;
      const snapped =
        type === "horizontal"
          ? { ...shape, y1: my, y2: my }
          : { ...shape, x1: mx, x2: mx };
      const inputShapes = (item.shapes || []).slice();
      inputShapes[shapeIdx] = snapped;
      const { shapes: solved, ok } = solveConstraints(inputShapes, constraints);
      if (!ok)
        return {
          notification:
            "Can't apply that constraint — it would break another constraint",
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  // Offset the selected lines: create parallel copies at a signed distance,
  // each linked to its original by an `offset` constraint (so edits to the
  // original flow through the solver to the copy), with coincident constraints
  // where the originals shared a corner.  `distance` is an mm formula; its
  // sign picks the side.
  offsetSketchGeometry: (sketchId, lineIndices, distance) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const shapes = item.shapes || [];
      const sel = (lineIndices || []).filter((idx) => {
        const t = shapes[idx]?.type;
        return t === "line" || t === "circle";
      });
      if (sel.length === 0) return {};
      const dScene = resolveValue(distance, 0.5);
      if (!Number.isFinite(dScene) || dScene === 0) return {};

      // One group id for this whole offset so editing its dimension changes
      // every copy together.
      const offsetGroup =
        1 +
        (item.constraints || []).reduce(
          (m, c) => (c.type === "offset" ? Math.max(m, c.offsetGroup ?? 0) : m),
          0,
        );

      const base = shapes.length;
      const newShapes = [];
      const newConstraints = [];
      const newIdxOf = new Map();
      sel.forEach((origIdx) => {
        const o = shapes[origIdx];
        const newIdx = base + newShapes.length;
        newIdxOf.set(origIdx, newIdx);
        if (o.type === "circle") {
          // Concentric copy: radius grows by the signed offset (clamped to stay
          // positive when offsetting inward past the centre).
          newShapes.push({
            type: "circle",
            cx: o.cx,
            cy: o.cy,
            r: Math.max(1e-4, (o.r ?? 0) + dScene),
            ...(o.dashed ? { dashed: true } : null),
          });
        } else {
          const odx = o.x2 - o.x1,
            ody = o.y2 - o.y1;
          const len = Math.hypot(odx, ody) || 1e-9;
          // Right normal: placing at +dScene here makes the signed perpendicular
          // distance the solver measures equal +dScene (see the offset residual).
          const nx = ody / len,
            ny = -odx / len;
          newShapes.push({
            type: "line",
            x1: o.x1 + dScene * nx,
            y1: o.y1 + dScene * ny,
            x2: o.x2 + dScene * nx,
            y2: o.y2 + dScene * ny,
            ...(o.dashed ? { dashed: true } : null),
          });
        }
        newConstraints.push({
          type: "offset",
          shapeIdx: newIdx,
          origIdx,
          distance,
          offsetGroup,
        });
      });

      // Carry shared corners over to the copies: group the originals' endpoints
      // by position and chain a coincident between the matching new endpoints.
      const EPS = 1e-4;
      const key = (x, y) => `${Math.round(x / EPS)},${Math.round(y / EPS)}`;
      const groups = new Map();
      sel.forEach((origIdx) => {
        const o = shapes[origIdx];
        if (o.type !== "line") return; // circles share no corners
        [
          ["start", o.x1, o.y1],
          ["end", o.x2, o.y2],
        ].forEach(([pk, x, y]) => {
          const k = key(x, y);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push({ origIdx, pk });
        });
      });
      groups.forEach((grp) => {
        for (let i = 1; i < grp.length; i++) {
          const a = grp[0];
          const b = grp[i];
          if (a.origIdx === b.origIdx) continue;
          newConstraints.push({
            type: "coincident",
            shapeAIdx: newIdxOf.get(a.origIdx),
            pointA: a.pk,
            shapeBIdx: newIdxOf.get(b.origIdx),
            pointB: b.pk,
          });
        }
      });

      const allShapes = [...shapes, ...newShapes];
      const allConstraints = [...(item.constraints || []), ...newConstraints];
      // Pin every existing shape so ONLY the new copies move — the offset is
      // measured relative to the originals, so without this the solver could
      // satisfy it by nudging the originals instead.
      const fixed = new Set();
      for (let i = 0; i < base; i++)
        for (const f of varFields(shapes[i])) fixed.add(`${i}:${f}`);
      // Solve so the offset corners meet (line lengths adjust to the new
      // intersections); keep the raw placement if it can't converge.
      const { shapes: solved, ok } = solveConstraints(
        allShapes,
        allConstraints,
        {
          fixed,
        },
      );
      const finalShapes = ok ? solved : allShapes;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: finalShapes,
              constraints: allConstraints,
            })
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  // Change the offset distance (whole group, or one constraint) and re-solve so
  // only the offset copies move.  `formula` is a signed mm string.
  updateSketchOffsetDistance: (sketchId, offsetGroup, constraintIdx, formula) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const constraints = (item.constraints || []).map((c, i) => {
        if (c.type !== "offset") return c;
        const inGroup =
          offsetGroup != null
            ? c.offsetGroup === offsetGroup
            : i === constraintIdx;
        return inGroup ? { ...c, distance: formula } : c;
      });
      const offsetTargets = new Set(
        constraints.filter((c) => c.type === "offset").map((c) => c.shapeIdx),
      );
      const fixed = new Set();
      (item.shapes || []).forEach((s, i) => {
        if (offsetTargets.has(i)) return;
        for (const f of varFields(s)) fixed.add(`${i}:${f}`);
      });
      const { shapes: solved, ok } = solveConstraints(
        item.shapes,
        constraints,
        {
          fixed,
        },
      );
      const finalShapes = ok ? solved : item.shapes;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, { shapes: finalShapes, constraints })
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  deleteSketchConstraint: (sketchId, constraintIdx) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        return Object.assign({}, item, {
          constraints: (item.constraints || []).filter(
            (_, i) => i !== constraintIdx,
          ),
        });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  toggleSketchShapesDashed: (sketchId, indices) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const idxSet = new Set(indices);
        const oldShapes = item.shapes || [];
        const allDashed = indices.every((i) => oldShapes[i]?.dashed);
        const shapes = oldShapes.map((s, i) => {
          if (!idxSet.has(i)) return s;
          return { ...s, dashed: allDashed ? false : true };
        });
        return Object.assign({}, item, { shapes });
      });
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
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  updateSketchConstraintDistance: (sketchId, constraintIdx, newDistance) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const constraints = (item.constraints || []).map((c, i) =>
          i === constraintIdx && c.type === "distance"
            ? Object.assign({}, c, { distance: newDistance })
            : c,
        );
        return Object.assign({}, item, { constraints });
      });
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),
});
