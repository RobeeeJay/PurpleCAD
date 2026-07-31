// Sketch-mode interaction / selection state: pure set() wrappers for the
// active tool, current selection, constraint/modify sub-modes, the text-tool
// draft, multi-select + selection-type filters, the long-press menu, and the
// pending SVG import.  No geometry — split out of sketchSlice.js and composed
// back via spread.  (The one MUTATION that lived in this region,
// ensureTextContours, stays in sketchSlice.js with the other commits.)

export const createSketchUiStateSlice = (set) => ({
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

  sketchConstraintMode: null, // 'coincident' | 'distance' | 'midpoint' | null
  setSketchConstraintMode: (mode) =>
    set((s) => ({
      sketchConstraintMode: mode,
      // The midpoint tool's first pick only means anything inside its mode.
      ...(mode !== "midpoint" && s.sketchMidpointFirst
        ? { sketchMidpointFirst: null }
        : null),
    })),
  // Guided midpoint pick: { kind: 'point' | 'target', shapeIdx, pointKey? } | null.
  sketchMidpointFirst: null,
  setSketchMidpointFirst: (v) => set({ sketchMidpointFirst: v }),

  sketchDistanceInput: null,
  setSketchDistanceInput: (v) => set({ sketchDistanceInput: v }),

  sketchModifyMode: null, // 'chamfer' | 'bevel' | null
  setSketchModifyMode: (mode) => set({ sketchModifyMode: mode }),

  // Chamfer setback / bevel radius, in mm (scene units × MM_PER_UNIT). Drives
  // both the modify preview and the committed cut.
  // Chamfer setback / bevel radius: a bare mm number or a formula string
  // over the document variables.
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

  sketchMultiSelectedIndices: [],
  setSketchMultiSelectedIndices: (v) => set({ sketchMultiSelectedIndices: v }),
  // Mirror of sketchHover's closure-local constraint selection so React
  // surfaces (the status tag) can count it.
  selectedSketchConstraintIdx: null,
  setSelectedSketchConstraintIdx: (v) =>
    set({ selectedSketchConstraintIdx: v }),

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
  // Saved set before a Cmd/Ctrl-click solo isolate (see soloSketchSelType).
  sketchSelTypesSolo: null,
  toggleSketchSelType: (key) =>
    set((s) => ({
      sketchSelTypes: { ...s.sketchSelTypes, [key]: !s.sketchSelTypes[key] },
      sketchSelTypesSolo: null,
    })),
  // Cmd/Ctrl-click: isolate one kind (others off), saving the prior set; a second
  // solo-click on the isolated kind restores it.
  soloSketchSelType: (key) =>
    set((s) => {
      const KEYS = ["line", "point", "shape", "constraint", "object"];
      const cur = s.sketchSelTypes;
      const isolated = KEYS.every((k) => (k === key ? cur[k] : !cur[k]));
      if (isolated && s.sketchSelTypesSolo) {
        return {
          sketchSelTypes: s.sketchSelTypesSolo,
          sketchSelTypesSolo: null,
        };
      }
      const saved = s.sketchSelTypesSolo || cur;
      const next = {};
      for (const k of KEYS) next[k] = k === key;
      return { sketchSelTypes: next, sketchSelTypesSolo: saved };
    }),

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

  // In-progress placement of a sketch reference underlay (a PNG/JPEG traced
  // over).  Holds the live values the placement bar edits; Confirm writes them
  // onto the sketch item, Cancel throws them away.  `editing` marks a re-open
  // of an already-committed underlay, so Cancel restores rather than removes.
  // { sketchId, dataUrl, name, imageAspect, widthMm, offsetX, offsetY,
  //   rotationDeg, opacity, editing, original } | null
  underlayImport: null,
  setUnderlayImport: (v) => set({ underlayImport: v }),
  updateUnderlayImport: (partial) =>
    set((state) =>
      state.underlayImport
        ? { underlayImport: { ...state.underlayImport, ...partial } }
        : {},
    ),
  clearUnderlayImport: () => set({ underlayImport: null }),
});
