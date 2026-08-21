// Phase machines for the tools that CREATE or place geometry -- box,
// measure, plane, 3D pattern, mirror, boolean, project, split, point-to-point
// and sweep/loft.  Pure pick/param bookkeeping: none of these need `get`,
// they only ever replace their own slot.

import { TOOL_RESET_PATCH } from "./uiToolReset.js";

export const createUiConstructToolsSlice = (set) => ({
  openBoxDialog: (id) => set({ boxDialog: { id } }),
  openBoxCreate: (type, position) =>
    set({ boxDialog: { create: { type, position } } }),
  closeBoxDialog: () => set({ boxDialog: null }),

  startMeasureTool: () =>
    set({ ...TOOL_RESET_PATCH, measureTool: { picks: [] } }),
  cancelMeasureTool: () => set({ measureTool: null }),
  // Add a clicked entity (3D); keep at most the last two so a third click starts
  // a fresh distance from the previous pick.
  addMeasurePick: (entity) =>
    set((s) => {
      if (!s.measureTool || !entity) return {};
      const picks = [...s.measureTool.picks, entity];
      while (picks.length > 2) picks.shift();
      return { measureTool: { ...s.measureTool, picks } };
    }),
  clearMeasurePicks: () =>
    set((s) => (s.measureTool ? { measureTool: { picks: [] } } : {})),
  setPlanePickActive: (v) => set({ planePickActive: v || false }),
  startPlaneTool: (base) =>
    set({
      ...TOOL_RESET_PATCH,
      planeTool: { base, rot: { x: 0, y: 0, z: 0 }, offset: 0 },
    }),
  updatePlaneTool: (partial) =>
    set((state) =>
      state.planeTool ? { planeTool: { ...state.planeTool, ...partial } } : {},
    ),
  cancelPlaneTool: () => set({ planeTool: null }),
  // Mirror / circular / rectangular patterns all act on whole objects, so they
  // lock the selection widget to Object mode while active.
  startPattern3d: (v) =>
    set({
      ...TOOL_RESET_PATCH,
      pattern3dTool: v,
      selectionOverride: ["object"],
    }),
  updatePattern3d: (partial) =>
    set((state) =>
      state.pattern3dTool
        ? { pattern3dTool: { ...state.pattern3dTool, ...partial } }
        : {},
    ),
  cancelPattern3d: () =>
    set({
      pattern3dTool: null,
      circularAxisPick: false,
      selectionOverride: null,
    }),
  setCircularAxisPick: (v) => set({ circularAxisPick: !!v }),
  startMirror3d: (seed) =>
    set({
      ...TOOL_RESET_PATCH,
      mirror3dTool: seed || {},
      selectionOverride: ["object"],
    }),
  cancelMirror3d: () => set({ mirror3dTool: null, selectionOverride: null }),

  startBooleanTool: (operation) =>
    set({
      ...TOOL_RESET_PATCH,
      booleanTool: { operation },
      selectionOverride: ["object"],
      additiveObjectPick: true,
    }),
  cancelBooleanTool: () =>
    set({
      booleanTool: null,
      selectionOverride: null,
      additiveObjectPick: false,
      booleanCutIds: [],
    }),
  setAdditiveObjectPick: (v) => set({ additiveObjectPick: !!v }),
  setBooleanCutIds: (ids) => set({ booleanCutIds: [...ids] }),
  startProjectTool: () =>
    set({ ...TOOL_RESET_PATCH, projectTool: { shapes: [] } }),
  addProjectShapes: (shapes) =>
    set((state) =>
      state.projectTool
        ? { projectTool: { shapes: [...state.projectTool.shapes, ...shapes] } }
        : {},
    ),
  cancelProjectTool: () => set({ projectTool: null }),

  startSplit3d: (seed) =>
    set({
      ...TOOL_RESET_PATCH,
      splitTool: {
        objectId: null,
        objectName: null,
        cutFrame: null,
        cutLabel: null,
        ...(seed || {}),
      },
      splitPick: "object",
    }),
  updateSplit3d: (partial) =>
    set((state) =>
      state.splitTool ? { splitTool: { ...state.splitTool, ...partial } } : {},
    ),
  cancelSplit3d: () => set({ splitTool: null, splitPick: null }),
  setSplitPick: (v) => set({ splitPick: v || null }),

  startPointToPointTool: () =>
    set({
      ...TOOL_RESET_PATCH,
      pointToPointTool: { picking: "A", a: null, b: null },
    }),
  cancelPointToPointTool: () => set({ pointToPointTool: null }),
  // Arm one of the two picks (toggles off if already armed).
  setPointToPointPicking: (which) =>
    set((s) =>
      s.pointToPointTool
        ? {
            pointToPointTool: {
              ...s.pointToPointTool,
              picking: s.pointToPointTool.picking === which ? null : which,
            },
          }
        : {},
    ),
  // Store a picked vertex { itemId, point } for A or B; auto-advance A→B.
  setPointToPointPoint: (which, itemId, point) =>
    set((s) => {
      if (!s.pointToPointTool) return {};
      const t = {
        ...s.pointToPointTool,
        [which === "A" ? "a" : "b"]: { itemId, point },
      };
      t.picking = which === "A" && !t.b ? "B" : null;
      return { pointToPointTool: t };
    }),
  setSweepSelectMode: (v) =>
    set({
      sweepSelectMode: v,
      // A sweep tool is exclusive with the face-select tools.
      ...(v
        ? {
            chamferSelectMode: null,
            pushPullSelectMode: null,
            selectionOverride: null,
          }
        : null),
    }),
  startSweepTool: (kind) =>
    set({
      ...TOOL_RESET_PATCH,
      sweepSelectMode: {
        kind,
        profile: null,
        axis: null,
        secondProfile: null,
        params: { rotations: 1, offsetPerRotation: 0, prism: false, sides: 6 },
      },
    }),
  cancelSweepTool: () =>
    set({ sweepSelectMode: null, sweepRetargetTarget: null }),
  setSweepProfile: (profile) =>
    set((state) =>
      state.sweepSelectMode
        ? { sweepSelectMode: { ...state.sweepSelectMode, profile } }
        : {},
    ),
  setSweepAxis: (axis) =>
    set((state) =>
      state.sweepSelectMode
        ? { sweepSelectMode: { ...state.sweepSelectMode, axis } }
        : {},
    ),
  // Pipe path: { sketchId, shapeIdx } of a line in the path sketch.
  setSweepPath: (path) =>
    set((state) =>
      state.sweepSelectMode
        ? { sweepSelectMode: { ...state.sweepSelectMode, path } }
        : {},
    ),
  // Loft second profile (the loop to loft to, on a parallel plane).
  setSweepSecondProfile: (secondProfile) =>
    set((state) =>
      state.sweepSelectMode
        ? { sweepSelectMode: { ...state.sweepSelectMode, secondProfile } }
        : {},
    ),
  // Which loft profile the next click sets ("start" | "end") — driven by the loft
  // dialog's pick buttons so either end can be (re)chosen.
  setSweepLoftPick: (loftPick) =>
    set((state) =>
      state.sweepSelectMode
        ? { sweepSelectMode: { ...state.sweepSelectMode, loftPick } }
        : {},
    ),
  setSweepParams: (partial) =>
    set((state) =>
      state.sweepSelectMode
        ? {
            sweepSelectMode: {
              ...state.sweepSelectMode,
              params: { ...state.sweepSelectMode.params, ...partial },
            },
          }
        : {},
    ),
  setSweepRetargetTarget: (target) => set({ sweepRetargetTarget: target }),
});
