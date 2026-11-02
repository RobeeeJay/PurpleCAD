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
  invalidateEdit,
} from "./internals.js";
import { createSketchUndoSlice } from "./sketchUndoSlice.js";
import { createSketchPatternToolSlice } from "./sketchPatternToolSlice.js";
import { createSketchCentreSlice } from "./sketchCentreSlice.js";
import { createSketchAngleSlice } from "./sketchAngleSlice.js";
import { createSketchCogSlice } from "./sketchCogSlice.js";
import { createSketchOffsetSlice } from "./sketchOffsetSlice.js";
import { createSketchUiStateSlice } from "./sketchUiStateSlice.js";
import { solveConstraints, varFields } from "../three/sketchSolver.js";
import { shapeMidpoint, translateShape } from "../three/sketchGeometry.js";
import {
  moveShapePoint,
  getShapePoint,
} from "../three/sceneObjects/sketchShapes.js";
import { variablesToMap } from "../utils/formulas.js";
import {
  MIRRORABLE_TYPES,
  mirrorShapeGeometry,
  applyMirrorConstraints,
} from "../three/sketchMirror.js";
import {
  CIRCULAR_PATTERNABLE_TYPES,
  rotateShapeGeometry,
  applyCircularPatternConstraints,
} from "../three/sketchCircularPattern.js";
import {
  RECTANGULAR_PATTERNABLE_TYPES,
  translateShapeGeometry,
  applyRectangularPatternConstraints,
  resolveRectPatternParams,
} from "../three/sketchRectangularPattern.js";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { explodeContours, resizeCorner } from "../three/sketchGeometry.js";
import { cogShapeContours } from "../three/cogGeometry.js";
import {
  textShapeContours,
  makeTextShape,
  isFontAvailable,
} from "../three/sketchText.js";
import { computeLineTrim } from "../three/sketchTrim.js";
import { autoHVConstraints } from "../three/sketchConstraints.js";
import {
  SHAPE_INDEX_FIELDS,
  SHAPE_INDEX_LIST_FIELDS,
  remapConstraintShapeIndices,
} from "./internals.js";

// Re-exported: the remap lived here before the cog tool needed it too.
export { SHAPE_INDEX_LIST_FIELDS, remapConstraintShapeIndices };

// Does a constraint reference shape index `idx` in any of its index fields?
const constraintRefsShape = (c, idx) =>
  SHAPE_INDEX_FIELDS.some((f) => c[f] === idx) ||
  SHAPE_INDEX_LIST_FIELDS.some((f) => c[f]?.includes?.(idx));

// Does a constraint attach to a specific endpoint of shape `idx`?
const constraintTouchesPoint = (c, idx, pt) =>
  (c.shapeAIdx === idx && c.pointA === pt) ||
  (c.shapeBIdx === idx && c.pointB === pt) ||
  (c.pointShapeIdx === idx && c.pointKey === pt);

// Constraint rebuild when a trim SHRINKS a line in place (one endpoint moved to
// the cut point): drop distance constraints on the line and any constraint
// attached to the endpoint that moved; the line keeps its index, direction, and
// other endpoint, so H/V + the retained endpoint's constraints stay valid.
const trimShrinkConstraints = (constraints, lineIdx, movedPoint) =>
  constraints.filter((c) => {
    if (
      c.type === "distance" &&
      (c.shapeAIdx === lineIdx || c.shapeBIdx === lineIdx)
    )
      return false;
    if (constraintTouchesPoint(c, lineIdx, movedPoint)) return false;
    return true;
  });

// Constraint rebuild when a trim SPLITS a line into segA (kept at lineIdx, owns
// the original "start") and segB (appended at segBIdx, owns the original "end").
// Distance constraints on the line are dropped; "end"-anchored constraints move
// to segB; H/V apply to both collinear halves; anything else referencing the
// line on a split is dropped to avoid ambiguous over-/under-constraint.
const trimSplitConstraints = (constraints, lineIdx, segBIdx) => {
  const out = [];
  for (const c of constraints) {
    if (
      c.type === "distance" &&
      (c.shapeAIdx === lineIdx || c.shapeBIdx === lineIdx)
    )
      continue;
    if (!constraintRefsShape(c, lineIdx)) {
      out.push(c);
      continue;
    }
    if (c.type === "horizontal" || c.type === "vertical") {
      out.push(c);
      if (c.shapeIdx === lineIdx) out.push({ ...c, shapeIdx: segBIdx });
      continue;
    }
    // Both halves still belong to the shape the centre constraint names.
    if (c.type === "centre") {
      const nc = { ...c };
      for (const f of SHAPE_INDEX_LIST_FIELDS)
        if (c[f]?.includes(lineIdx)) nc[f] = [...c[f], segBIdx];
      out.push(nc);
      continue;
    }
    if (c.type === "coincident" || c.type === "angle") {
      const nc = { ...c };
      if (nc.shapeAIdx === lineIdx && nc.pointA === "end")
        nc.shapeAIdx = segBIdx;
      if (nc.shapeBIdx === lineIdx && nc.pointB === "end")
        nc.shapeBIdx = segBIdx;
      out.push(nc);
      continue;
    }
    // onLine / offset referencing the split line → drop (rare, keeps it safe).
  }
  return out;
};

// Editing a mirror / pattern in place removes its old copy shapes and rebuilds
// fresh ones.  This drops `copyIndices`, reindexes every surviving constraint,
// and returns a `remapIdx` to bring any kept references (sources, a mirror line,
// a pattern centre) into the reduced frame.  remapIdx returns null for a
// removed index.
const removeCopiesForEdit = (shapes, constraints, copyIndices) => {
  const copySet = new Set(copyIndices);
  const indexMap = new Map();
  let ni = 0;
  shapes.forEach((_, i) => indexMap.set(i, copySet.has(i) ? -1 : ni++));
  const workShapes = shapes.filter((_, i) => !copySet.has(i));
  const workConstraints = constraints
    .map((c) => remapConstraintShapeIndices(c, indexMap))
    .filter(Boolean);
  const remapIdx = (i) => {
    const m = indexMap.get(i);
    return m == null || m === -1 ? null : m;
  };
  return { workShapes, workConstraints, remapIdx };
};

// Commit a shapes-only change to a sketch: snapshot for undo, update items +
// the matching CREATE history entry, persist.  Used by grouping (which only
// adds/removes a `group` tag on shapes).
const commitSketchShapesChange = (state, sketchId, newShapes) => {
  pushSketchSnapshot(state, sketchId);
  const updatedItems = state.items.map((item) =>
    item.id === sketchId
      ? Object.assign({}, item, { shapes: newShapes })
      : item,
  );
  const newHistory = state.history.map((entry) =>
    entry.instruction?.type === "create" &&
    entry.instruction.item?.id === sketchId
      ? Object.assign({}, entry, {
          instruction: Object.assign({}, entry.instruction, {
            item: Object.assign({}, entry.instruction.item, {
              shapes: newShapes,
            }),
          }),
        })
      : entry,
  );
  const edit = invalidateEdit(state.history, newHistory, updatedItems);
  saveTimeline(edit.history, state.activeHistoryId);
  return {
    items: edit.items,
    history: withOrphanFlags(edit.history),
  };
};

// Commit the reference underlay (a traced-over image) on a sketch: same
// items + CREATE-entry rewrite + persist as a shapes change, but deliberately
// NOT markCsgDirty — the underlay is a visual guide with no geometric effect,
// so changing it must not force every downstream CSG step to rebuild.
const commitSketchUnderlay = (state, sketchId, underlay) => {
  const patch = (item) => {
    const next = Object.assign({}, item);
    if (underlay) next.underlay = underlay;
    else delete next.underlay;
    return next;
  };
  const updatedItems = state.items.map((item) =>
    item.id === sketchId ? patch(item) : item,
  );
  const newHistory = state.history.map((entry) =>
    entry.instruction?.type === "create" &&
    entry.instruction.item?.id === sketchId
      ? Object.assign({}, entry, {
          instruction: Object.assign({}, entry.instruction, {
            item: patch(entry.instruction.item),
          }),
        })
      : entry,
  );
  saveTimeline(newHistory, state.activeHistoryId);
  return { items: updatedItems, history: withOrphanFlags(newHistory) };
};

export const createSketchSlice = (set) => ({
  ...createSketchUndoSlice(set),

  // Set (or (with null) remove) a sketch's reference underlay image.
  setSketchUnderlay: (sketchId, underlay) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item || item.type !== "sketch") return {};
      return commitSketchUnderlay(state, sketchId, underlay);
    }),

  // --- Interaction state (pure setters) + the text-contour backfill ---
  ...createSketchUiStateSlice(set),

  // Backfill glyph contours on text shapes that predate contour caching, so the
  // font-free consumers (region detection → fills, extrude, explode-on-unlock)
  // see their outlines.  Idempotent; a no-op once every text shape has contours.
  // `tolerance` is the active resolution's glyph simplification deviation; a
  // text shape is (re)simplified when it lacks contours OR was built at a
  // different tolerance, so toggling print/preview resolution re-coarsens or
  // re-smooths extruded text.
  ensureTextContours: (tolerance = 0) =>
    set((state) => {
      // Only re-tessellate a text shape whose EXACT font is loaded — otherwise
      // makeTextShape would rebuild it in the default font (the shape still names
      // the original).  Unloaded fonts keep their stored contours until the App
      // effect loads the font and re-runs this.
      const needs = (s) =>
        s.type === "text" &&
        isFontAvailable(s.font) &&
        (!Array.isArray(s.contours) ||
          // Made before glyphs cached their exact curves.
          !Array.isArray(s.contourCurves) ||
          s.contourTol !== tolerance);
      let changed = false;
      const updatedItems = state.items.map((item) => {
        if (item.type !== "sketch" || !(item.shapes || []).some(needs))
          return item;
        changed = true;
        return Object.assign({}, item, {
          shapes: item.shapes.map((s) =>
            needs(s)
              ? makeTextShape({
                  text: s.text,
                  height: s.height,
                  font: s.font,
                  x: s.x,
                  y: s.y,
                  tolerance,
                })
              : s,
          ),
        });
      });
      if (!changed) return {};
      const newHistory = state.history.map((entry) => {
        if (entry.instruction?.type !== "create") return entry;
        const ui = updatedItems.find(
          (i) => i.id === entry.instruction.item?.id,
        );
        if (!ui || ui.type !== "sketch") return entry;
        return Object.assign({}, entry, {
          instruction: Object.assign({}, entry.instruction, {
            item: Object.assign({}, entry.instruction.item, {
              shapes: ui.shapes,
            }),
          }),
        });
      });
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  ...createSketchPatternToolSlice(set),
  ...createSketchCentreSlice(set),
  ...createSketchAngleSlice(set),
  ...createSketchCogSlice(set),

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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  updateSketchShapes: (sketchId, updatesMap) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shapes = (item.shapes || []).map((s, i) =>
          updatesMap.has(i) ? updatesMap.get(i) : s,
        );
        const constraints = item.constraints || [];
        return Object.assign({}, item, {
          shapes: applyRectangularPatternConstraints(
            applyCircularPatternConstraints(
              applyMirrorConstraints(shapes, constraints),
              constraints,
            ),
            constraints,
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  updateSketchShape: (sketchId, shapeIdx, newShape) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const shapes = item.shapes.map((s, i) =>
          i === shapeIdx ? newShape : s,
        );
        const constraints = item.constraints || [];
        return Object.assign({}, item, {
          shapes: applyRectangularPatternConstraints(
            applyCircularPatternConstraints(
              applyMirrorConstraints(shapes, constraints),
              constraints,
            ),
            constraints,
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  addSketchShapes: (sketchId, newShapes, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), ...newShapes],
              constraints: [
                ...(item.constraints || []),
                ...newConstraints,
                ...autoHVConstraints(
                  newShapes,
                  (item.shapes || []).length,
                  newConstraints,
                ),
              ],
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Live re-projection: replace the shapes of one projection group (projKey =
  // `${sourceId}:${edgeKey}`) with freshly re-fitted ones.  No undo snapshot —
  // this tracks the source automatically, it isn't a user edit.
  updateProjectionShapes: (sketchId, projKey, newShapes) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const old = item.shapes || [];
      const inGroup = (s) => s.projection?.key === projKey;
      const kept = old.filter((s) => !inGroup(s));
      const shapes = [...kept, ...newShapes];
      // Dropping the group's old shapes and APPENDING the refit ones renumbers
      // every shape that sat after them, so the constraints must be remapped —
      // exactly as deleting or trimming shapes does.  Without this, refitting a
      // projection when its source body moves silently re-binds every later
      // constraint to the wrong shape (a "horizontal" landing on a vertical
      // line, a 145 mm dimension on a 30 mm one), and the next drag's
      // repair-solve then yanks unrelated geometry across the sketch.
      const indexMap = new Map();
      const groupOldIdxs = [];
      let ni = 0;
      old.forEach((s, i) => {
        if (inGroup(s)) groupOldIdxs.push(i);
        else indexMap.set(i, ni++);
      });
      // A constraint attached to the projected geometry itself follows the
      // refit shape in the same position; if the refit produced fewer shapes
      // there's no counterpart, so -1 drops the constraint.
      groupOldIdxs.forEach((oldIdx, k) =>
        indexMap.set(oldIdx, k < newShapes.length ? kept.length + k : -1),
      );
      const constraints = (item.constraints || [])
        .map((c) => remapConstraintShapeIndices(c, indexMap))
        .filter(Boolean);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, { shapes, constraints })
          : it,
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Delete a projection constraint: strip the `projection` link from its shapes
  // (or every projected shape when projKey is null), leaving plain editable
  // sketch geometry behind.  A user action, so it snapshots for undo.
  releaseProjection: (sketchId, projKey = null) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      let changed = false;
      const shapes = (item.shapes || []).map((s) => {
        if (!s.projection) return s;
        if (projKey && s.projection.key !== projKey) return s;
        changed = true;
        const { projection, ...rest } = s; // eslint-disable-line no-unused-vars
        return rest;
      });
      if (!changed) return {};
      return commitSketchShapesChange(state, sketchId, shapes);
    }),

  // Tag the given shape indices with a shared, fresh group id so they select /
  // move / delete as a unit.  Needs at least two shapes.
  groupSketchShapes: (sketchId, indices) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const idxSet = new Set(indices || []);
      if (!item || idxSet.size < 2) return {};
      const shapes = item.shapes || [];
      const maxGroup = shapes.reduce(
        (m, s) => (typeof s.group === "number" ? Math.max(m, s.group) : m),
        0,
      );
      const gid = maxGroup + 1;
      const newShapes = shapes.map((s, i) =>
        idxSet.has(i) ? { ...s, group: gid } : s,
      );
      return commitSketchShapesChange(state, sketchId, newShapes);
    }),

  // Dissolve every group that any of the given shapes belongs to.
  ungroupSketchShapes: (sketchId, indices) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const shapes = item.shapes || [];
      const groups = new Set();
      (indices || []).forEach((i) => {
        const g = shapes[i]?.group;
        if (g != null) groups.add(g);
      });
      if (groups.size === 0) return {};
      const newShapes = shapes.map((s) => {
        if (s.group != null && groups.has(s.group)) {
          const { group, ...rest } = s;
          return rest;
        }
        return s;
      });
      return commitSketchShapesChange(state, sketchId, newShapes);
    }),

  addSketchShape: (sketchId, shape, newConstraints = []) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: [...(item.shapes || []), shape],
              constraints: [
                ...(item.constraints || []),
                ...newConstraints,
                ...autoHVConstraints(
                  [shape],
                  (item.shapes || []).length,
                  newConstraints,
                ),
              ],
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Resize an existing chamfer / bevel corner to a new size (mm) — re-derives the
  // bridge + its two legs in place.  The geometry comes out self-consistent (the
  // bridge ends sit exactly on the trimmed leg corners), so no re-solve is needed.
  resizeSketchCorner: (sketchId, bridgeIdx, sizeMm, formula = null) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const res = resizeCorner(
        item.shapes || [],
        bridgeIdx,
        sizeMm / MM_PER_UNIT,
      );
      if (!res) return {};
      pushSketchSnapshot(state, sketchId);
      const map = new Map(res.updates);
      // The re-derived bridge keeps (or replaces) its formula so the label
      // and the next edit still show what the user typed.
      const bridge = map.get(bridgeIdx) ?? (item.shapes || [])[bridgeIdx];
      if (bridge) {
        const next = Object.assign({}, bridge);
        if (formula && typeof formula === "string" && formula.trim())
          next.distanceFormula = formula.trim();
        else delete next.distanceFormula;
        map.set(bridgeIdx, next);
      }
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: (it.shapes || []).map((s, i) =>
                map.has(i) ? map.get(i) : s,
              ),
            })
          : it,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) =>
        entry.instruction?.type === "create" &&
        entry.instruction.item?.id === sketchId
          ? Object.assign({}, entry, {
              instruction: Object.assign({}, entry.instruction, {
                item: Object.assign({}, entry.instruction.item, {
                  shapes: updatedItem?.shapes,
                }),
              }),
            })
          : entry,
      );
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Replace one shape in place (used to re-commit an edited text shape — its
  // `text` constraint keeps pointing at the same index).
  updateSketchTextShape: (sketchId, idx, shape) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) =>
        item.id === sketchId
          ? Object.assign({}, item, {
              shapes: (item.shapes || []).map((s, i) =>
                i === idx ? shape : s,
              ),
            })
          : item,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) =>
        entry.instruction?.type === "create" &&
        entry.instruction.item?.id === sketchId
          ? Object.assign({}, entry, {
              instruction: Object.assign({}, entry.instruction, {
                item: Object.assign({}, entry.instruction.item, {
                  shapes: updatedItem?.shapes,
                }),
              }),
            })
          : entry,
      );
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
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
        // Reindex every constraint type generically (covers mirror / offset /
        // circular- & rectangular-pattern too, which the old per-type filter
        // silently corrupted), dropping any that referenced a deleted shape.
        const constraints = (item.constraints || [])
          .map((c) => remapConstraintShapeIndices(c, indexMap))
          .filter(Boolean);
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Trim the part of line `lineIdx` under (x,y) up to the nearest crossings on
  // either side — deleting the line, shrinking it, or splitting it in two.
  // Skips offset/text geometry and drops the line's distance constraints.
  // `snapshot` is false for the continued trims of a single click-drag so the
  // whole drag is one undo step.
  trimSketchLine: (sketchId, lineIdx, x, y, snapshot = true) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const shapes = item.shapes || [];
      const line = shapes[lineIdx];
      if (!line || line.type !== "line") return {};
      const constraints = item.constraints || [];
      // Offset lines are linked copies — never trim them.
      const offsetIdxs = new Set(
        constraints.filter((c) => c.type === "offset").map((c) => c.shapeIdx),
      );
      if (offsetIdxs.has(lineIdx)) return {};

      const plan = computeLineTrim(shapes, lineIdx, x, y);
      if (!plan) return {};
      const { keepStart, keepEnd } = plan;

      let newShapes, newConstraints;
      if (!keepStart && !keepEnd) {
        // Whole segment between two crossings (or the bare line) → delete it.
        const indexMap = new Map();
        let ni = 0;
        shapes.forEach((_, i) => indexMap.set(i, i === lineIdx ? -1 : ni++));
        newShapes = shapes.filter((_, i) => i !== lineIdx);
        newConstraints = constraints
          .map((c) => remapConstraintShapeIndices(c, indexMap))
          .filter(Boolean);
      } else if (keepStart && keepEnd) {
        // Interior chunk removed → split into the two surviving stubs.
        const segBIdx = shapes.length;
        newShapes = [
          ...shapes.map((s, i) => (i === lineIdx ? keepStart : s)),
          keepEnd,
        ];
        newConstraints = trimSplitConstraints(constraints, lineIdx, segBIdx);
      } else {
        // One end removed → shrink the line in place.
        const seg = keepStart || keepEnd;
        // keepStart retains the original start, so the END moved (and vice versa).
        const movedPoint = keepStart ? "end" : "start";
        newShapes = shapes.map((s, i) => (i === lineIdx ? seg : s));
        newConstraints = trimShrinkConstraints(
          constraints,
          lineIdx,
          movedPoint,
        );
      }

      if (snapshot) pushSketchSnapshot(state, sketchId);

      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: newShapes,
              constraints: newConstraints,
            })
          : it,
      );
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: newShapes,
                constraints: newConstraints,
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
        selectedSketchElement: null,
        sketchMultiSelectedIndices: [],
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
      // Minimise movement: first try satisfying everything by moving ONLY the
      // selected line; free the rest of the sketch only if that fails.
      const othersFixed = new Set();
      (item.shapes || []).forEach((sh, i) => {
        if (i === shapeIdx) return;
        for (const f of varFields(sh)) othersFixed.add(`${i}:${f}`);
      });
      let solved = null;
      for (const opts of [{ fixed: othersFixed }, undefined]) {
        const res = solveConstraints(inputShapes, constraints, opts);
        if (res.ok) {
          solved = res.shapes;
          break;
        }
      }
      if (!solved)
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  // Two-shape geometric constraint (parallel / colinear between two lines;
  // tangent between a line and an arc/circle, or two arcs/circles).  Adds the
  // constraint and re-solves the whole sketch; rejects if it can't be satisfied.
  applySketchPairConstraint: (sketchId, idxA, idxB, type, opts = {}) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      if (idxA === idxB)
        return type === "midpoint"
          ? {
              notification:
                "Midpoint can't pin a point to its own line, arc or curve.",
            }
          : {};
      const shapes = item.shapes || [];
      const a = shapes[idxA],
        b = shapes[idxB];
      if (!a || !b) return {};
      const isLine = (s) => s?.type === "line";
      const isArc = (s) => s?.type === "circle" || s?.type === "arc";
      if (
        (type === "parallel" || type === "colinear") &&
        !(isLine(a) && isLine(b))
      )
        return { notification: `${type} needs two lines.` };
      if (
        type === "tangent" &&
        !(
          (isLine(a) && isArc(b)) ||
          (isArc(a) && isLine(b)) ||
          (isArc(a) && isArc(b))
        )
      )
        return {
          notification:
            "Tangent needs a line + arc/circle, or two arcs/circles.",
        };
      if (
        type === "equal" &&
        !((isLine(a) && isLine(b)) || (isArc(a) && isArc(b)))
      )
        return {
          notification:
            "Equal needs two lines (length), or two circles/arcs (radius).",
        };
      // Midpoint: one POINT + one line/arc/bezier, order-independent.  The
      // point is any snappable point — a standalone point shape, or a keyed
      // point of another shape (endpoint / centre, named by opts.pointKey) —
      // pinned to the target's geometric middle so it tracks it.
      let midpointFields = null;
      if (type === "midpoint") {
        const MIDPOINT_TARGETS = ["line", "arc", "bezier"];
        let pointIdx;
        let pointKey = null;
        if (opts.pointIdx != null) {
          pointIdx = opts.pointIdx;
          if (shapes[pointIdx]?.type !== "point")
            pointKey = opts.pointKey ?? null;
        } else {
          pointIdx =
            a?.type === "point" ? idxA : b?.type === "point" ? idxB : null;
        }
        const targetIdx = pointIdx === idxA ? idxB : idxA;
        const target = shapes[targetIdx];
        if (
          pointIdx == null ||
          (shapes[pointIdx]?.type !== "point" && !pointKey) ||
          !MIDPOINT_TARGETS.includes(target?.type)
        )
          return {
            notification: "Midpoint needs a point and a line, arc or curve.",
          };
        if (
          (item.constraints || []).some(
            (c) =>
              c.type === "midpoint" &&
              c.pointShapeIdx === pointIdx &&
              (c.pointKey ?? null) === pointKey,
          )
        )
          return {
            notification: "That point already has a midpoint constraint.",
          };
        midpointFields = {
          pointShapeIdx: pointIdx,
          targetShapeIdx: targetIdx,
          ...(pointKey ? { pointKey } : {}),
        };
      }
      const dup = (c) =>
        c.type === type &&
        (type === "midpoint"
          ? c.pointShapeIdx === midpointFields.pointShapeIdx &&
            (c.pointKey ?? null) === (midpointFields.pointKey ?? null) &&
            c.targetShapeIdx === midpointFields.targetShapeIdx
          : (c.shapeAIdx === idxA && c.shapeBIdx === idxB) ||
            (c.shapeAIdx === idxB && c.shapeBIdx === idxA));
      const constraints = [
        ...(item.constraints || []).filter((c) => !dup(c)),
        type === "midpoint"
          ? { type, ...midpointFields }
          : { type, shapeAIdx: idxA, shapeBIdx: idxB },
      ];
      // Staged solve, minimising movement: first only the FIRST-picked shape
      // may move, then both picked shapes, then the whole sketch (idxA/idxB
      // arrive in pick order).
      const stagedFixed = (freeIdxs) => {
        const freeSet = new Set(freeIdxs);
        const fixed = new Set();
        shapes.forEach((sh, i) => {
          if (freeSet.has(i)) return;
          for (const f of varFields(sh)) fixed.add(`${i}:${f}`);
        });
        return fixed;
      };
      // Seed each stage at (or near) the solution, but only ever by moving a
      // shape that stage lets move: the point jumps to the target's middle
      // when it is free, otherwise the target translates its middle onto the
      // point.  The solver converges poorly from far seeds, so this matters.
      const seedShapes = (freeIdxs) => {
        const input = shapes.slice();
        if (!midpointFields) return input;
        const pi = midpointFields.pointShapeIdx;
        const ti = midpointFields.targetShapeIdx;
        const freeSet = freeIdxs ? new Set(freeIdxs) : null;
        const m = shapeMidpoint(input[ti]);
        if (!m) return input;
        if (!freeSet || freeSet.has(pi)) {
          const pt = input[pi];
          input[pi] =
            pt.type === "point"
              ? { ...pt, x: m.x, y: m.y }
              : moveShapePoint(pt, midpointFields.pointKey, m);
        } else if (freeSet.has(ti)) {
          const p = getShapePoint(
            input[pi],
            midpointFields.pointKey ?? "point",
          );
          if (p) input[ti] = translateShape(input[ti], p.x - m.x, p.y - m.y);
        }
        return input;
      };
      let solved = null;
      for (const free of [[idxA], [idxA, idxB], null]) {
        const res = solveConstraints(
          seedShapes(free),
          constraints,
          free ? { fixed: stagedFixed(free) } : undefined,
        );
        if (res.ok) {
          solved = res.shapes;
          break;
        }
      }
      if (!solved)
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  ...createSketchOffsetSlice(set),

  deleteSketchConstraint: (sketchId, constraintIdx) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const oldShapes = item.shapes || [];
        const oldConstraints = item.constraints || [];
        const removed = oldConstraints[constraintIdx];

        // Deleting a `text` or `cog` constraint unlocks the shape: explode its
        // contours into ordinary editable line segments in place of the (now
        // unconstrained) primitive.
        if (
          removed &&
          (removed.type === "text" || removed.type === "cog") &&
          typeof removed.shapeIdx === "number" &&
          oldShapes[removed.shapeIdx]?.type === removed.type
        ) {
          const textIdx = removed.shapeIdx;
          // Absolute contours — for text, regenerated from the font when the
          // shape predates contour caching, so the text is never silently lost.
          const absContours =
            removed.type === "cog"
              ? cogShapeContours(oldShapes[textIdx])
              : textShapeContours(oldShapes[textIdx]);
          const keptShapes = oldShapes.filter((_, i) => i !== textIdx);
          const { shapes: lineShapes, constraints: lineCons } = explodeContours(
            absContours,
            keptShapes.length,
          );
          // No usable outlines → keep the text shape, just drop the constraint.
          // Never delete the geometry.
          if (lineShapes.length === 0) {
            return Object.assign({}, item, {
              constraints: oldConstraints.filter((_, i) => i !== constraintIdx),
            });
          }
          const indexMap = new Map();
          let ni = 0;
          oldShapes.forEach((_, i) =>
            indexMap.set(i, i === textIdx ? -1 : ni++),
          );
          const keptConstraints = oldConstraints
            .filter((_, i) => i !== constraintIdx)
            .map((c) => remapConstraintShapeIndices(c, indexMap))
            .filter(Boolean);
          return Object.assign({}, item, {
            shapes: [...keptShapes, ...lineShapes],
            constraints: [...keptConstraints, ...lineCons],
          });
        }

        // Deleting a mirror / pattern constraint removes the WHOLE operation —
        // every copy shape and its constraint — leaving only the source.  Its
        // copies are derived and otherwise non-selectable, so deleting one
        // constraint at a time would strand the copy geometry.  Group by the
        // same key the Edit flow uses.
        const groupOf = (c) => {
          if (c.type === "mirror")
            return (k) => k.type === "mirror" && k.lineIdx === c.lineIdx;
          if (c.type === "circularPattern")
            return (k) =>
              k.type === "circularPattern" &&
              k.centerShapeIdx === c.centerShapeIdx &&
              k.centerPointKey === c.centerPointKey &&
              k.count === c.count;
          if (c.type === "rectangularPattern")
            return (k) =>
              k.type === "rectangularPattern" &&
              k.dx === c.dx &&
              k.dy === c.dy &&
              k.countX === c.countX &&
              k.countY === c.countY;
          return null;
        };
        const inGroup = removed && groupOf(removed);
        if (inGroup) {
          const copyIndices = oldConstraints
            .filter(inGroup)
            .map((c) => c.shapeIdx);
          const { workShapes, workConstraints } = removeCopiesForEdit(
            oldShapes,
            oldConstraints,
            copyIndices,
          );
          return Object.assign({}, item, {
            shapes: workShapes,
            constraints: workConstraints,
          });
        }

        return Object.assign({}, item, {
          constraints: oldConstraints.filter((_, i) => i !== constraintIdx),
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
      };
    }),

  // Create mirrored copies of the picked shapes across the picked mirror
  // line, each linked to its original by a `mirror` constraint. The copies
  // are exact reflections (see sketchMirror.js) and stay in sync via
  // applyMirrorConstraints whenever the original or the mirror line moves —
  // until the `mirror` constraint is deleted, which leaves the copy as
  // ordinary independent geometry.
  confirmMirror: (sketchId) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const mirrorState = state.sketchMirrorState;
      if (!item || !mirrorState || mirrorState.lineIdx == null) return {};
      const done = { activeSketchTool: null, sketchMirrorState: null };

      // Edit mode: drop the old copies first, reindexing every surviving
      // constraint, and bring the line + source selection into the reduced
      // frame.
      let workShapes = item.shapes || [];
      let workConstraints = item.constraints || [];
      let lineIdx = mirrorState.lineIdx;
      let selRaw = mirrorState.shapeIndices || [];
      const copyIndices = mirrorState.editCopyIndices || [];
      const editing = copyIndices.length > 0;
      if (editing) {
        const r = removeCopiesForEdit(workShapes, workConstraints, copyIndices);
        workShapes = r.workShapes;
        workConstraints = r.workConstraints;
        lineIdx = r.remapIdx(lineIdx);
        selRaw = selRaw.map(r.remapIdx).filter((i) => i != null);
      }

      const lineShape = lineIdx == null ? null : workShapes[lineIdx];
      const sel = selRaw.filter(
        (idx) =>
          idx !== lineIdx && MIRRORABLE_TYPES.includes(workShapes[idx]?.type),
      );
      if (!lineShape || lineShape.type !== "line" || sel.length === 0) {
        // A valid edit that empties the mirror still commits the removal.
        if (!editing) return done;
      }

      const base = workShapes.length;
      const newShapes = [];
      const newConstraints = [];
      if (lineShape && lineShape.type === "line") {
        sel.forEach((origIdx) => {
          const copy = mirrorShapeGeometry(workShapes[origIdx], lineShape);
          if (!copy) return;
          const newIdx = base + newShapes.length;
          newShapes.push(copy);
          newConstraints.push({
            type: "mirror",
            shapeIdx: newIdx,
            origIdx,
            lineIdx,
          });
        });
      }
      if (newShapes.length === 0 && !editing) return done;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: [...workShapes, ...newShapes],
              constraints: [...workConstraints, ...newConstraints],
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
        activeSketchTool: null,
        sketchMirrorState: null,
      };
    }),

  // Create `count - 1` rotated copies of the picked shapes around the picked
  // centre point, each linked to its original by a `circularPattern`
  // constraint (index 1..count-1, sharing centre + count). The copies are
  // exact rotations (see sketchCircularPattern.js) and stay in sync via
  // applyCircularPatternConstraints whenever the original or the centre point
  // moves — until the `circularPattern` constraint is deleted, which leaves
  // the copy as ordinary independent geometry. The chosen count becomes the
  // new document default for future circular patterns.
  confirmCircularPattern: (sketchId) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const patternState = state.sketchCircularPatternState;
      if (!item || !patternState || patternState.centerShapeIdx == null)
        return {};
      const count = Math.max(2, Math.round(patternState.count) || 2);
      const { centerPointKey } = patternState;
      const done = {
        activeSketchTool: null,
        sketchCircularPatternState: null,
        circularPatternDefaultCount: count,
      };

      // Edit mode: drop the old copies first, reindexing every surviving
      // constraint, and bring the centre + source selection into the reduced
      // frame.
      let workShapes = item.shapes || [];
      let workConstraints = item.constraints || [];
      let centerShapeIdx = patternState.centerShapeIdx;
      let selRaw = patternState.shapeIndices || [];
      const copyIndices = patternState.editCopyIndices || [];
      const editing = copyIndices.length > 0;
      if (editing) {
        const r = removeCopiesForEdit(workShapes, workConstraints, copyIndices);
        workShapes = r.workShapes;
        workConstraints = r.workConstraints;
        centerShapeIdx = r.remapIdx(centerShapeIdx);
        selRaw = selRaw.map(r.remapIdx).filter((i) => i != null);
      }

      const sel =
        centerShapeIdx == null
          ? []
          : selRaw.filter((idx) =>
              CIRCULAR_PATTERNABLE_TYPES.includes(workShapes[idx]?.type),
            );
      if (sel.length === 0 && !editing) return done;

      const base = workShapes.length;
      const newShapes = [];
      const newConstraints = [];
      if (centerShapeIdx != null) {
        const center = getShapePoint(
          workShapes[centerShapeIdx],
          centerPointKey,
        );
        sel.forEach((origIdx) => {
          for (let index = 1; index < count; index++) {
            const angle = (index * 2 * Math.PI) / count;
            const copy = rotateShapeGeometry(
              workShapes[origIdx],
              center,
              angle,
            );
            if (!copy) continue;
            const newIdx = base + newShapes.length;
            newShapes.push(copy);
            newConstraints.push({
              type: "circularPattern",
              shapeIdx: newIdx,
              origIdx,
              centerShapeIdx,
              centerPointKey,
              count,
              index,
            });
          }
        });
      }
      if (newShapes.length === 0 && !editing) return done;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: [...workShapes, ...newShapes],
              constraints: [...workConstraints, ...newConstraints],
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
        activeSketchTool: null,
        sketchCircularPatternState: null,
        circularPatternDefaultCount: count,
      };
    }),

  // Create a grid of translated copies of the picked shapes, offset by
  // (offsetX, offsetY) per step in X/Y (skipping the (0,0) original cell),
  // each linked to its original by a `rectangularPattern` constraint (grid
  // position i,j sharing dx/dy/countX/countY). The copies are exact
  // translations (see sketchRectangularPattern.js) and stay in sync via
  // applyRectangularPatternConstraints whenever the original moves — until
  // the `rectangularPattern` constraint is deleted, which leaves the copy as
  // ordinary independent geometry. The chosen counts/offsets become the new
  // document defaults for future rectangular patterns.
  confirmRectangularPattern: (sketchId) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const patternState = state.sketchRectangularPatternState;
      if (!item || !patternState) return {};
      const shapes = item.shapes || [];
      // Raw params may be formulas (counts) / mm formulas (offsets); resolve
      // against the live variables, keeping the raws for the constraints.
      const { countX, countY, offsetX, offsetY } = resolveRectPatternParams(
        patternState,
        variablesToMap(state.variables),
      );
      const rawFormula = (v) => (typeof v === "string" ? v : null);
      const dxFormula = rawFormula(patternState.offsetX);
      const dyFormula = rawFormula(patternState.offsetY);
      const countXFormula = rawFormula(patternState.countX);
      const countYFormula = rawFormula(patternState.countY);
      const defaults = {
        activeSketchTool: null,
        sketchRectangularPatternState: null,
        rectangularPatternDefaultCountX: countXFormula ?? countX,
        rectangularPatternDefaultCountY: countYFormula ?? countY,
        rectangularPatternDefaultOffsetX: dxFormula ?? patternState.offsetX,
        rectangularPatternDefaultOffsetY: dyFormula ?? patternState.offsetY,
      };
      // Edit mode (double-clicked an existing pattern): drop the old copies
      // first, reindexing every surviving constraint, and carry the source
      // selection through the same remap so it still points at the originals.
      let workShapes = shapes;
      let workConstraints = item.constraints || [];
      let selRaw = patternState.shapeIndices || [];
      const copyIndices = patternState.editCopyIndices || [];
      const editing = copyIndices.length > 0;
      if (editing) {
        const copySet = new Set(copyIndices);
        const indexMap = new Map();
        let ni = 0;
        workShapes.forEach((_, i) =>
          indexMap.set(i, copySet.has(i) ? -1 : ni++),
        );
        workShapes = workShapes.filter((_, i) => !copySet.has(i));
        workConstraints = workConstraints
          .map((c) => remapConstraintShapeIndices(c, indexMap))
          .filter(Boolean);
        selRaw = selRaw
          .map((i) => indexMap.get(i))
          .filter((i) => i != null && i !== -1);
      }

      const sel = selRaw.filter((idx) =>
        RECTANGULAR_PATTERNABLE_TYPES.includes(workShapes[idx]?.type),
      );
      // Nothing to do only when we're not editing — an edit with no sources
      // (or counts of 1×1) still has to commit the removal of the old copies.
      if (sel.length === 0 && !editing) return defaults;

      const base = workShapes.length;
      const newShapes = [];
      const newConstraints = [];
      sel.forEach((origIdx) => {
        for (let i = 0; i < countX; i++) {
          for (let j = 0; j < countY; j++) {
            if (i === 0 && j === 0) continue;
            const copy = translateShapeGeometry(
              workShapes[origIdx],
              i * offsetX,
              j * offsetY,
            );
            if (!copy) continue;
            const newIdx = base + newShapes.length;
            newShapes.push(copy);
            newConstraints.push({
              type: "rectangularPattern",
              shapeIdx: newIdx,
              origIdx,
              i,
              j,
              dx: offsetX,
              dy: offsetY,
              countX,
              countY,
              ...(dxFormula ? { dxFormula } : {}),
              ...(dyFormula ? { dyFormula } : {}),
              ...(countXFormula ? { countXFormula } : {}),
              ...(countYFormula ? { countYFormula } : {}),
            });
          }
        }
      });
      if (newShapes.length === 0 && !editing) return defaults;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: [...workShapes, ...newShapes],
              constraints: [...workConstraints, ...newConstraints],
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
        ...defaults,
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),

  updateSketchConstraintDistance: (sketchId, constraintIdx, newDistance) =>
    set((state) => {
      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((item) => {
        if (item.id !== sketchId) return item;
        const constraints = (item.constraints || []).map((c, i) =>
          i === constraintIdx &&
          (c.type === "distance" || c.type === "pointLineDistance")
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
      const edit = invalidateEdit(state.history, newHistory, updatedItems);
      saveTimeline(edit.history, state.activeHistoryId);
      return {
        items: edit.items,
        history: withOrphanFlags(edit.history),
      };
    }),
});
