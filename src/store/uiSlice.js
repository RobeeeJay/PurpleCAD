// UI / ephemeral state: selection, hover, render mode, theme, dialog
// state, busy counter, modal targets for the various edit dialogs.
// Nothing here touches history or persistence — these are all
// runtime-only setters.

import { getSystemTheme } from "./internals.js";

export const uiInitial = {
  selectedId: null,
  selectedIds: [],
  hoveredId: null,

  theme: getSystemTheme(),
  renderMode: "shaded",
  projectionMode: "perspective",
  widgetVisible: true,
  axisVisible: true,
  constraintsVisible: true,
  dimensionsVisible: true,
  cameraResetTrigger: 0,
  curveResolution: "preview", // "preview" (32 pts) | "print" (128 pts)

  sketchPlacementMode: false,
  extrudeSelectMode: null, // null | "profile" | "depth"
  extrudeRetargetId: null, // id of the extrude being retargeted, or null

  // Sub-geometry selection used by the 3D Bevel/Chamfer toolbar buttons.
  selectedSubGeometry: null,

  // Active extrude-depth input overlay.  Populated when the user enters
  // "depth" mode after picking a profile; cleared when they confirm or
  // cancel the extrude.  defaultDepth is in scene units (multiply by
  // MM_PER_UNIT for display).
  extrudeDepthInput: null,

  // Modal state for editing the depth/length of an extrude from the
  // timeline, and chamfer/fillet parameters from the same.
  extrudeEditTarget: null,
  chamferEditTarget: null,

  // Whether the Y=0 ground plane shows shadows for scene objects.
  shadowsEnabled: false,

  // Non-reactive slot holding the live cameraControls object (set by
  // Viewport during mount).  Lets UI components outside the Viewport
  // call viewport-anchored helpers (eg dropSelectedToGround) without
  // prop-drilling a ref through React Context.  Don't subscribe — it's
  // a handle, not state.
  _cameraControls: null,

  // Counter of in-flight long-running OCC operations.  Drives the
  // global <BusyIndicator>; a counter (not a boolean) means concurrent
  // operations stack correctly.
  pendingOperations: 0,
};

export const createUiSlice = (set) => ({
  selectItem: (id) =>
    set({ selectedId: id, selectedIds: id != null ? [id] : [] }),

  addToSelection: (id) =>
    set((state) => {
      if (!id) return { selectedIds: [], selectedId: null };
      const already = state.selectedIds.includes(id);
      if (already) {
        const newIds = state.selectedIds.filter((i) => i !== id);
        return { selectedIds: newIds, selectedId: newIds[0] ?? null };
      }
      const newIds = [...state.selectedIds, id];
      return { selectedIds: newIds, selectedId: state.selectedId ?? id };
    }),

  setHoveredId: (id) => set({ hoveredId: id }),
  setSelectedSubGeometry: (data) => set({ selectedSubGeometry: data }),
  clearSelectedSubGeometry: () => set({ selectedSubGeometry: null }),

  setExtrudeDepthInput: (v) => set({ extrudeDepthInput: v }),
  setExtrudeEditTarget: (target) => set({ extrudeEditTarget: target }),
  setChamferEditTarget: (target) => set({ chamferEditTarget: target }),
  setShadowsEnabled: (v) => set({ shadowsEnabled: !!v }),
  setCameraControls: (controls) => set({ _cameraControls: controls }),

  beginOperation: () =>
    set((state) => ({ pendingOperations: state.pendingOperations + 1 })),
  endOperation: () =>
    set((state) => ({
      pendingOperations: Math.max(0, state.pendingOperations - 1),
    })),

  toggleConstraintsVisible: () =>
    set((state) => ({ constraintsVisible: !state.constraintsVisible })),
  toggleDimensionsVisible: () =>
    set((state) => ({ dimensionsVisible: !state.dimensionsVisible })),
  toggleCurveResolution: () =>
    set((state) => ({
      curveResolution: state.curveResolution === "print" ? "preview" : "print",
    })),

  setSketchPlacementMode: (active) => set({ sketchPlacementMode: active }),
  setExtrudeSelectMode: (mode) => set({ extrudeSelectMode: mode }),
  setExtrudeRetargetId: (id) => set({ extrudeRetargetId: id }),
  setRenderMode: (mode) => set({ renderMode: mode }),
  setProjectionMode: (mode) => set({ projectionMode: mode }),

  toggleProjectionMode: () =>
    set((state) => ({
      projectionMode:
        state.projectionMode === "perspective" ? "isometric" : "perspective",
    })),

  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),

  toggleWidgetVisibility: () =>
    set((state) => ({ widgetVisible: !state.widgetVisible })),

  toggleAxisVisibility: () =>
    set((state) => ({ axisVisible: !state.axisVisible })),
});
