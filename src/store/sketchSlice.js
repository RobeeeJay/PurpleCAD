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
import { getShapePoint } from "../three/sceneObjects/sketchShapes.js";

// Shape types the Offset tool can copy.
export const OFFSETTABLE_TYPES = ["line", "circle", "arc", "ellipse", "bezier"];

// Approximate parallel offset of a cubic bezier: shift each control point along
// the curve normal at its parameter (endpoints exact, interior approximate).
// A true offset of a bezier isn't a bezier, so this is the usual CAD
// approximation — good for the gentle curves sketches use.
const offsetBezierGeometry = (o, d) => {
  const { p0, p1, p2, p3 } = o;
  const deriv = (t) => {
    const mt = 1 - t;
    return {
      x:
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x),
      y:
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y),
    };
  };
  const off = (pt, t) => {
    const tg = deriv(t);
    let len = Math.hypot(tg.x, tg.y);
    if (len < 1e-9) {
      // Degenerate tangent (coincident control points) → use the chord.
      const cx = p3.x - p0.x,
        cy = p3.y - p0.y;
      len = Math.hypot(cx, cy) || 1e-9;
      return { x: pt.x + (d * cy) / len, y: pt.y + (d * -cx) / len };
    }
    // Right normal, matching the line-offset convention.
    return { x: pt.x + (d * tg.y) / len, y: pt.y + (d * -tg.x) / len };
  };
  return {
    type: "bezier",
    p0: off(p0, 0),
    p1: off(p1, 1 / 3),
    p2: off(p2, 2 / 3),
    p3: off(p3, 1),
    ...(o.dashed ? { dashed: true } : null),
  };
};

// Geometric offset of a sketch shape by a signed scene distance (right-normal
// = +d side, matching the line convention; circles/arcs/ellipses grow their
// radii by +d).  Returns null for types that can't be offset.
export const offsetShapeGeometry = (o, d) => {
  const dashed = o.dashed ? { dashed: true } : null;
  switch (o.type) {
    case "line": {
      const odx = o.x2 - o.x1,
        ody = o.y2 - o.y1;
      const len = Math.hypot(odx, ody) || 1e-9;
      const nx = ody / len,
        ny = -odx / len;
      return {
        type: "line",
        x1: o.x1 + d * nx,
        y1: o.y1 + d * ny,
        x2: o.x2 + d * nx,
        y2: o.y2 + d * ny,
        ...dashed,
      };
    }
    case "circle":
      return {
        type: "circle",
        cx: o.cx,
        cy: o.cy,
        r: Math.max(1e-4, (o.r ?? 0) + d),
        ...dashed,
      };
    case "arc":
      return {
        type: "arc",
        cx: o.cx,
        cy: o.cy,
        r: Math.max(1e-4, (o.r ?? 0) + d),
        startAngle: o.startAngle,
        endAngle: o.endAngle,
        ...dashed,
      };
    case "ellipse":
      return {
        type: "ellipse",
        cx: o.cx,
        cy: o.cy,
        rx: Math.max(1e-4, (o.rx ?? 0) + d),
        ry: Math.max(1e-4, (o.ry ?? 0) + d),
        rotation: o.rotation || 0,
        ...dashed,
      };
    case "bezier":
      return offsetBezierGeometry(o, d);
    default:
      return null;
  }
};

// Beziers aren't solver variables, so re-solving can't move their offset
// copies — recompute them geometrically from the (pinned) original at the
// constraint's current distance.  Returns the same array ref when unchanged.
const recomputeBezierOffsets = (shapes, constraints) => {
  let out = shapes;
  constraints.forEach((c) => {
    if (c.type !== "offset") return;
    const orig = out[c.origIdx];
    const tgt = out[c.shapeIdx];
    if (orig?.type !== "bezier" || tgt?.type !== "bezier") return;
    const d = resolveValue(c.distance, 0);
    if (!Number.isFinite(d)) return;
    if (out === shapes) out = shapes.slice();
    out[c.shapeIdx] = offsetShapeGeometry(orig, d);
  });
  return out;
};

export const createSketchSlice = (set) => ({
  ...createSketchUndoSlice(set),

  // --- Interaction state ---
  activeSketchTool: null,
  setActiveSketchTool: (tool) =>
    set({
      activeSketchTool: tool,
      ...(tool !== "mirror" ? { sketchMirrorState: null } : null),
      ...(tool !== "circularPattern"
        ? { sketchCircularPatternState: null }
        : null),
    }),

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

  // Mirror tool: pick a mirror line, then toggle geometry to preview/mirror
  // across it. { lineIdx: number|null, shapeIndices: number[] } | null
  sketchMirrorState: null,
  setSketchMirrorState: (v) => set({ sketchMirrorState: v }),

  startMirrorTool: () =>
    set({
      activeSketchTool: "mirror",
      sketchMirrorState: { lineIdx: null, shapeIndices: [] },
    }),

  cancelMirrorTool: () =>
    set((state) => ({
      activeSketchTool:
        state.activeSketchTool === "mirror" ? null : state.activeSketchTool,
      sketchMirrorState: null,
    })),

  setMirrorLine: (lineIdx) =>
    set((state) => ({
      sketchMirrorState: { ...(state.sketchMirrorState || {}), lineIdx },
    })),

  reselectMirrorLine: () =>
    set((state) => ({
      sketchMirrorState: { ...(state.sketchMirrorState || {}), lineIdx: null },
    })),

  toggleMirrorShape: (shapeIdx) =>
    set((state) => {
      const cur = state.sketchMirrorState;
      if (!cur || cur.lineIdx == null) return {};
      const shapeIndices = cur.shapeIndices.includes(shapeIdx)
        ? cur.shapeIndices.filter((i) => i !== shapeIdx)
        : [...cur.shapeIndices, shapeIdx];
      return { sketchMirrorState: { ...cur, shapeIndices } };
    }),

  // Circular Pattern tool: pick a centre point, then toggle geometry to
  // preview/copy as rotated repeats around it.
  // { centerShapeIdx, centerPointKey, shapeIndices: number[], count } | null
  sketchCircularPatternState: null,
  setSketchCircularPatternState: (v) => set({ sketchCircularPatternState: v }),

  // Document default for the "instances per 360°" input — remembers the last
  // value entered so new circular patterns start from it.
  circularPatternDefaultCount: 4,

  startCircularPatternTool: () =>
    set((state) => ({
      activeSketchTool: "circularPattern",
      sketchCircularPatternState: {
        centerShapeIdx: null,
        centerPointKey: null,
        shapeIndices: [],
        count: state.circularPatternDefaultCount,
      },
    })),

  cancelCircularPatternTool: () =>
    set((state) => ({
      activeSketchTool:
        state.activeSketchTool === "circularPattern"
          ? null
          : state.activeSketchTool,
      sketchCircularPatternState: null,
    })),

  setCircularPatternCenter: (centerShapeIdx, centerPointKey) =>
    set((state) => ({
      sketchCircularPatternState: {
        ...(state.sketchCircularPatternState || {}),
        centerShapeIdx,
        centerPointKey,
      },
    })),

  reselectCircularPatternCenter: () =>
    set((state) => ({
      sketchCircularPatternState: {
        ...(state.sketchCircularPatternState || {}),
        centerShapeIdx: null,
        centerPointKey: null,
      },
    })),

  toggleCircularPatternShape: (shapeIdx) =>
    set((state) => {
      const cur = state.sketchCircularPatternState;
      if (!cur || cur.centerShapeIdx == null) return {};
      const shapeIndices = cur.shapeIndices.includes(shapeIdx)
        ? cur.shapeIndices.filter((i) => i !== shapeIdx)
        : [...cur.shapeIndices, shapeIdx];
      return { sketchCircularPatternState: { ...cur, shapeIndices } };
    }),

  setCircularPatternCount: (count) =>
    set((state) => {
      const cur = state.sketchCircularPatternState;
      if (!cur) return {};
      return { sketchCircularPatternState: { ...cur, count } };
    }),

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
        const shapes = (item.shapes || []).map((s, i) =>
          updatesMap.has(i) ? updatesMap.get(i) : s,
        );
        const constraints = item.constraints || [];
        return Object.assign({}, item, {
          shapes: applyCircularPatternConstraints(
            applyMirrorConstraints(shapes, constraints),
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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
          shapes: applyCircularPatternConstraints(
            applyMirrorConstraints(shapes, constraints),
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
      const sel = (lineIndices || []).filter((idx) =>
        OFFSETTABLE_TYPES.includes(shapes[idx]?.type),
      );
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
        const copy = offsetShapeGeometry(shapes[origIdx], dScene);
        if (!copy) return;
        const newIdx = base + newShapes.length;
        newIdxOf.set(origIdx, newIdx);
        newShapes.push(copy);
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
      const finalShapes = recomputeBezierOffsets(
        ok ? solved : item.shapes,
        constraints,
      );

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

  // Live preview of an offset-distance edit: re-solve and update ONLY the live
  // items (geometry + the shown constraint value) — no snapshot, history, or CSG
  // dirtying.  Enter commits via updateSketchOffsetDistance; Escape restores by
  // previewing the original value.
  previewSketchOffsetDistance: (
    sketchId,
    offsetGroup,
    constraintIdx,
    formula,
  ) =>
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
      const finalShapes = recomputeBezierOffsets(
        ok ? solved : item.shapes,
        constraints,
      );
      return {
        items: state.items.map((it) =>
          it.id === sketchId
            ? Object.assign({}, it, {
                shapes: finalShapes,
                constraints,
              })
            : it,
        ),
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
      const shapes = item.shapes || [];
      const lineIdx = mirrorState.lineIdx;
      const lineShape = shapes[lineIdx];
      const sel = (mirrorState.shapeIndices || []).filter(
        (idx) =>
          idx !== lineIdx && MIRRORABLE_TYPES.includes(shapes[idx]?.type),
      );
      if (!lineShape || lineShape.type !== "line" || sel.length === 0)
        return { activeSketchTool: null, sketchMirrorState: null };

      const base = shapes.length;
      const newShapes = [];
      const newConstraints = [];
      sel.forEach((origIdx) => {
        const copy = mirrorShapeGeometry(shapes[origIdx], lineShape);
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
      if (newShapes.length === 0)
        return { activeSketchTool: null, sketchMirrorState: null };

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: [...shapes, ...newShapes],
              constraints: [...(it.constraints || []), ...newConstraints],
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
      const shapes = item.shapes || [];
      const { centerShapeIdx, centerPointKey } = patternState;
      const count = Math.max(2, Math.round(patternState.count) || 2);
      const sel = (patternState.shapeIndices || []).filter((idx) =>
        CIRCULAR_PATTERNABLE_TYPES.includes(shapes[idx]?.type),
      );
      if (sel.length === 0)
        return {
          activeSketchTool: null,
          sketchCircularPatternState: null,
          circularPatternDefaultCount: count,
        };

      const base = shapes.length;
      const newShapes = [];
      const newConstraints = [];
      sel.forEach((origIdx) => {
        for (let index = 1; index < count; index++) {
          const angle = (index * 2 * Math.PI) / count;
          const copy = rotateShapeGeometry(
            shapes[origIdx],
            getShapePoint(shapes[centerShapeIdx], centerPointKey),
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
      if (newShapes.length === 0)
        return {
          activeSketchTool: null,
          sketchCircularPatternState: null,
          circularPatternDefaultCount: count,
        };

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: [...shapes, ...newShapes],
              constraints: [...(it.constraints || []), ...newConstraints],
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
        activeSketchTool: null,
        sketchCircularPatternState: null,
        circularPatternDefaultCount: count,
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
