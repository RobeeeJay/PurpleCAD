// Sketch-related actions + interaction state.
//
// Mutations follow a common pattern: snapshot the sketch's shapes /
// constraints for per-sketch undo (`pushSketchSnapshot`), update items,
// rewrite the matching CREATE history entry so the shape changes
// survive reload + replay, persist, and return.

import {
  pushSketchSnapshot,
  sketchUndoStacks,
  withOrphanFlags,
  saveTimeline,
  UNDO_LIMIT,
} from "./internals.js";

export const createSketchSlice = (set) => ({
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  undoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.undoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.redoStack = [
        ...stacks.redoStack,
        {
          shapes: (item.shapes || []).slice(),
          constraints: (item.constraints || []).slice(),
        },
      ].slice(-UNDO_LIMIT);
      const prev = stacks.undoStack[stacks.undoStack.length - 1];
      stacks.undoStack = stacks.undoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId
          ? Object.assign({}, i, {
              shapes: prev.shapes,
              constraints: prev.constraints,
            })
          : i,
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  redoSketch: (sketchId) =>
    set((state) => {
      const stacks = sketchUndoStacks.get(sketchId);
      if (!stacks || stacks.redoStack.length === 0) return {};
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      stacks.undoStack = [
        ...stacks.undoStack,
        {
          shapes: (item.shapes || []).slice(),
          constraints: (item.constraints || []).slice(),
        },
      ].slice(-UNDO_LIMIT);
      const next = stacks.redoStack[stacks.redoStack.length - 1];
      stacks.redoStack = stacks.redoStack.slice(0, -1);
      const updatedItems = state.items.map((i) =>
        i.id === sketchId
          ? Object.assign({}, i, {
              shapes: next.shapes,
              constraints: next.constraints,
            })
          : i,
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),

  applySketchHVConstraint: (sketchId, shapeIdx, type) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shape = (item.shapes || [])[shapeIdx];
        if (!shape || shape.type !== "line") return item;
        const mid =
          type === "horizontal"
            ? { y: (shape.y1 + shape.y2) / 2 }
            : { x: (shape.x1 + shape.x2) / 2 };
        const snapped =
          type === "horizontal"
            ? { ...shape, y1: mid.y, y2: mid.y }
            : { ...shape, x1: mid.x, x2: mid.x };
        const shapes = (item.shapes || []).map((s, i) =>
          i === shapeIdx ? snapped : s,
        );
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
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
      return { items: updatedItems, history: withOrphanFlags(newHistory) };
    }),
});
