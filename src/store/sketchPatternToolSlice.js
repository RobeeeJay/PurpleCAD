// Sketch pattern-tool interaction state: the in-progress pick state for the
// Mirror, Circular Pattern, and Rectangular Pattern tools (start / cancel /
// toggle-shape / set-param / begin-edit).  Pure state setters — the geometry
// COMMITS (confirmMirror / confirmCircularPattern / confirmRectangularPattern)
// stay in sketchSlice.js with the rest of the shape/constraint mutations, since
// they share that file's commit boilerplate and shared reindex helpers.  Split
// out of sketchSlice.js and composed back via spread.

import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";

export const createSketchPatternToolSlice = (set) => ({
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
  // Offsets are mm (a number or a mm formula string); counts may be formulas.
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
          countX: clicked.countXFormula ?? clicked.countX,
          countY: clicked.countYFormula ?? clicked.countY,
          // Raw values are mm (or a mm formula); dx/dy are scene units.
          offsetX: clicked.dxFormula ?? clicked.dx * MM_PER_UNIT,
          offsetY: clicked.dyFormula ?? clicked.dy * MM_PER_UNIT,
          editCopyIndices: copyIndices,
        },
      };
    }),
});
