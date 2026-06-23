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
import {
  RECTANGULAR_PATTERNABLE_TYPES,
  translateShapeGeometry,
  applyRectangularPatternConstraints,
} from "../three/sketchRectangularPattern.js";
import { getShapePoint } from "../three/sceneObjects/sketchShapes.js";
import { explodeContours } from "../three/sketchGeometry.js";
import {
  textShapeContours,
  makeTextShape,
  isFontAvailable,
} from "../three/sketchText.js";
import { computeLineTrim } from "../three/sketchTrim.js";

// Shape types the Offset tool can copy.
export const OFFSETTABLE_TYPES = ["line", "circle", "arc", "ellipse", "bezier"];

// Every field on a constraint that references a shape by index, across all
// constraint types (coincident/distance/angle use A/B; onLine uses
// point/line; H/V and the copy ops use shapeIdx; mirror/offset/pattern carry
// a source origIdx; mirror adds lineIdx; circularPattern adds centerShapeIdx).
// `i`, `j`, `index`, `count`, `offsetGroup` are NOT shape indices.
const SHAPE_INDEX_FIELDS = [
  "shapeAIdx",
  "shapeBIdx",
  "shapeIdx",
  "origIdx",
  "pointShapeIdx",
  "lineShapeIdx",
  "lineIdx",
  "centerShapeIdx",
];

// Remap a constraint's shape-index fields through `indexMap` (old index → new
// index, or -1 for a removed shape).  Returns null when the constraint
// references any removed shape, so the caller can drop it.  Used when deleting
// shapes (e.g. replacing a rectangular pattern's copies) so every surviving
// constraint keeps pointing at the right geometry.
export const remapConstraintShapeIndices = (constraint, indexMap) => {
  const out = { ...constraint };
  for (const f of SHAPE_INDEX_FIELDS) {
    if (typeof constraint[f] === "number") {
      const next = indexMap.get(constraint[f]);
      if (next == null || next === -1) return null;
      out[f] = next;
    }
  }
  return out;
};

// Does a constraint reference shape index `idx` in any of its index fields?
const constraintRefsShape = (c, idx) =>
  SHAPE_INDEX_FIELDS.some((f) => c[f] === idx);

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
  saveTimeline(newHistory, state.activeHistoryId);
  return {
    items: markCsgDirty(updatedItems),
    history: withOrphanFlags(newHistory),
  };
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
      ...(tool !== "rectangularPattern"
        ? { sketchRectangularPatternState: null }
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

  // Chamfer setback / bevel radius, in mm (scene units × MM_PER_UNIT). Drives
  // both the modify preview and the committed cut.
  sketchModifyDistMm: 2.5,
  setSketchModifyDistMm: (mm) => set({ sketchModifyDistMm: mm }),

  sketchConstraintFirstPoint: null, // { shapeIdx, pointKey } | null
  setSketchConstraintFirstPoint: (pt) =>
    set({ sketchConstraintFirstPoint: pt }),

  // In-progress Text tool: the anchor point + current text/height/font being
  // edited in the Text dialog (drives its live preview).  editIdx is the shape
  // index when editing an existing text, or null when creating a new one.
  textDraft: null, // { x, y, text, heightMm, font, editIdx } | null
  setTextDraft: (v) => set({ textDraft: v }),
  updateTextDraft: (partial) =>
    set((s) =>
      s.textDraft ? { textDraft: { ...s.textDraft, ...partial } } : {},
    ),
  clearTextDraft: () => set({ textDraft: null }),

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
        (!Array.isArray(s.contours) || s.contourTol !== tolerance);
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  sketchMultiSelectedIndices: [],
  setSketchMultiSelectedIndices: (v) => set({ sketchMultiSelectedIndices: v }),

  // Sketch selection-type filter (the top-right widget): which kinds a click
  // resolves to.  line/point/shape on by default (the priority point > line >
  // shape that was always the behaviour); constraint/object opt-in.  `object` is
  // only usable while the Project tool is picking 3D geometry.
  sketchSelTypes: {
    line: true,
    point: true,
    shape: true,
    constraint: true,
    object: false,
  },
  toggleSketchSelType: (key) =>
    set((s) => ({
      sketchSelTypes: { ...s.sketchSelTypes, [key]: !s.sketchSelTypes[key] },
    })),

  sketchLongPressMenu: null, // { x, y, items: [{kind, label, ...}] } | null
  setSketchLongPressMenu: (v) => set({ sketchLongPressMenu: v }),

  // Pending SVG import placement: the parsed shapes plus an interactive scale +
  // offset the user adjusts before confirming.
  // { sketchId, shapes, scale, offsetX, offsetY } | null
  svgImport: null,
  setSvgImport: (v) => set({ svgImport: v }),
  updateSvgImport: (partial) =>
    set((state) =>
      state.svgImport ? { svgImport: { ...state.svgImport, ...partial } } : {},
    ),
  clearSvgImport: () => set({ svgImport: null }),

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

  // Re-open the Mirror tool to edit an existing mirror, seeded from the
  // constraint the user double-clicked.  A "mirror" is the set of mirror
  // constraints sharing the same mirror line; its sources are their distinct
  // origIdx and its copies are their shapeIdx.  editCopyIndices is carried so
  // Confirm replaces those copies rather than adding a second mirror.
  beginMirrorEdit: (sketchId, constraintIdx) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const clicked = (item?.constraints || [])[constraintIdx];
      if (!clicked || clicked.type !== "mirror") return {};
      const group = (item.constraints || []).filter(
        (c) => c.type === "mirror" && c.lineIdx === clicked.lineIdx,
      );
      return {
        activeSketchTool: "mirror",
        sketchMirrorState: {
          lineIdx: clicked.lineIdx,
          shapeIndices: [...new Set(group.map((c) => c.origIdx))],
          editCopyIndices: group.map((c) => c.shapeIdx),
        },
      };
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

  // Re-open the Circular Pattern tool to edit an existing pattern, seeded from
  // the constraint the user double-clicked.  A "pattern" is the set of
  // circularPattern constraints sharing the same centre point + count; its
  // sources are their distinct origIdx and its copies are their shapeIdx.
  beginCircularPatternEdit: (sketchId, constraintIdx) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const clicked = (item?.constraints || [])[constraintIdx];
      if (!clicked || clicked.type !== "circularPattern") return {};
      const group = (item.constraints || []).filter(
        (c) =>
          c.type === "circularPattern" &&
          c.centerShapeIdx === clicked.centerShapeIdx &&
          c.centerPointKey === clicked.centerPointKey &&
          c.count === clicked.count,
      );
      return {
        activeSketchTool: "circularPattern",
        sketchCircularPatternState: {
          centerShapeIdx: clicked.centerShapeIdx,
          centerPointKey: clicked.centerPointKey,
          count: clicked.count,
          shapeIndices: [...new Set(group.map((c) => c.origIdx))],
          editCopyIndices: group.map((c) => c.shapeIdx),
        },
      };
    }),

  // Rectangular Pattern tool: toggle geometry to preview/copy as a grid of
  // repeats offset in X and Y.
  // { shapeIndices: number[], countX, countY, offsetX, offsetY } | null
  sketchRectangularPatternState: null,
  setSketchRectangularPatternState: (v) =>
    set({ sketchRectangularPatternState: v }),

  // Document defaults for the rectangular pattern inputs — remember the last
  // values entered so new rectangular patterns start from them.
  rectangularPatternDefaultCountX: 2,
  rectangularPatternDefaultCountY: 2,
  rectangularPatternDefaultOffsetX: 10,
  rectangularPatternDefaultOffsetY: 10,

  startRectangularPatternTool: () =>
    set((state) => ({
      activeSketchTool: "rectangularPattern",
      sketchRectangularPatternState: {
        shapeIndices: [],
        countX: state.rectangularPatternDefaultCountX,
        countY: state.rectangularPatternDefaultCountY,
        offsetX: state.rectangularPatternDefaultOffsetX,
        offsetY: state.rectangularPatternDefaultOffsetY,
      },
    })),

  cancelRectangularPatternTool: () =>
    set((state) => ({
      activeSketchTool:
        state.activeSketchTool === "rectangularPattern"
          ? null
          : state.activeSketchTool,
      sketchRectangularPatternState: null,
    })),

  toggleRectangularPatternShape: (shapeIdx) =>
    set((state) => {
      const cur = state.sketchRectangularPatternState;
      if (!cur) return {};
      const shapeIndices = cur.shapeIndices.includes(shapeIdx)
        ? cur.shapeIndices.filter((i) => i !== shapeIdx)
        : [...cur.shapeIndices, shapeIdx];
      return { sketchRectangularPatternState: { ...cur, shapeIndices } };
    }),

  setRectangularPatternCountX: (countX) =>
    set((state) => {
      const cur = state.sketchRectangularPatternState;
      if (!cur) return {};
      return { sketchRectangularPatternState: { ...cur, countX } };
    }),

  setRectangularPatternCountY: (countY) =>
    set((state) => {
      const cur = state.sketchRectangularPatternState;
      if (!cur) return {};
      return { sketchRectangularPatternState: { ...cur, countY } };
    }),

  setRectangularPatternOffsetX: (offsetX) =>
    set((state) => {
      const cur = state.sketchRectangularPatternState;
      if (!cur) return {};
      return { sketchRectangularPatternState: { ...cur, offsetX } };
    }),

  setRectangularPatternOffsetY: (offsetY) =>
    set((state) => {
      const cur = state.sketchRectangularPatternState;
      if (!cur) return {};
      return { sketchRectangularPatternState: { ...cur, offsetY } };
    }),

  // Re-open the Rectangular Pattern tool to edit an existing pattern, seeded
  // from the constraint the user double-clicked.  A "pattern" is the set of
  // rectangularPattern constraints sharing the same offsets + counts; its
  // sources are their distinct origIdx and its copies are their shapeIdx.
  // editCopyIndices is carried so Confirm replaces those copies rather than
  // appending a second pattern.  No-op (and no tool change) if the index isn't
  // a rectangularPattern constraint.
  beginRectangularPatternEdit: (sketchId, constraintIdx) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      const clicked = (item?.constraints || [])[constraintIdx];
      if (!clicked || clicked.type !== "rectangularPattern") return {};
      const group = (item.constraints || []).filter(
        (c) =>
          c.type === "rectangularPattern" &&
          c.dx === clicked.dx &&
          c.dy === clicked.dy &&
          c.countX === clicked.countX &&
          c.countY === clicked.countY,
      );
      const sourceIndices = [...new Set(group.map((c) => c.origIdx))];
      const copyIndices = group.map((c) => c.shapeIdx);
      return {
        activeSketchTool: "rectangularPattern",
        sketchRectangularPatternState: {
          shapeIndices: sourceIndices,
          countX: clicked.countX,
          countY: clicked.countY,
          offsetX: clicked.dx,
          offsetY: clicked.dy,
          editCopyIndices: copyIndices,
        },
      };
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

  // Live re-projection: replace the shapes of one projection group (projKey =
  // `${sourceId}:${edgeKey}`) with freshly re-fitted ones.  No undo snapshot —
  // this tracks the source automatically, it isn't a user edit.
  updateProjectionShapes: (sketchId, projKey, newShapes) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const kept = (item.shapes || []).filter(
        (s) => s.projection?.key !== projKey,
      );
      const shapes = [...kept, ...newShapes];
      const updatedItems = state.items.map((it) =>
        it.id === sketchId ? Object.assign({}, it, { shapes }) : it,
      );
      const newHistory = state.history.map((entry) =>
        entry.instruction?.type === "create" &&
        entry.instruction.item?.id === sketchId
          ? Object.assign({}, entry, {
              instruction: Object.assign({}, entry.instruction, {
                item: Object.assign({}, entry.instruction.item, { shapes }),
              }),
            })
          : entry,
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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

  // Two-shape geometric constraint (parallel / colinear between two lines;
  // tangent between a line and an arc/circle, or two arcs/circles).  Adds the
  // constraint and re-solves the whole sketch; rejects if it can't be satisfied.
  applySketchPairConstraint: (sketchId, idxA, idxB, type) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item || idxA === idxB) return {};
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
      const dup = (c) =>
        c.type === type &&
        ((c.shapeAIdx === idxA && c.shapeBIdx === idxB) ||
          (c.shapeAIdx === idxB && c.shapeBIdx === idxA));
      const constraints = [
        ...(item.constraints || []).filter((c) => !dup(c)),
        { type, shapeAIdx: idxA, shapeBIdx: idxB },
      ];
      const { shapes: solved, ok } = solveConstraints(
        shapes.slice(),
        constraints,
      );
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
        const oldShapes = item.shapes || [];
        const oldConstraints = item.constraints || [];
        const removed = oldConstraints[constraintIdx];

        // Deleting a `text` constraint unlocks the text: explode its glyph
        // contours into ordinary editable line segments in place of the (now
        // unconstrained) text shape.
        if (
          removed &&
          removed.type === "text" &&
          typeof removed.shapeIdx === "number" &&
          oldShapes[removed.shapeIdx]?.type === "text"
        ) {
          const textIdx = removed.shapeIdx;
          // Absolute glyph contours — regenerated from the font when the shape
          // predates contour caching, so the text is never silently lost.
          const absContours = textShapeContours(oldShapes[textIdx]);
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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
      const countX = Math.max(1, Math.round(patternState.countX) || 1);
      const countY = Math.max(1, Math.round(patternState.countY) || 1);
      const offsetX = patternState.offsetX;
      const offsetY = patternState.offsetY;
      const defaults = {
        activeSketchTool: null,
        sketchRectangularPatternState: null,
        rectangularPatternDefaultCountX: countX,
        rectangularPatternDefaultCountY: countY,
        rectangularPatternDefaultOffsetX: offsetX,
        rectangularPatternDefaultOffsetY: offsetY,
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
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
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
