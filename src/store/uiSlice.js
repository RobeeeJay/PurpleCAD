// UI / ephemeral state: selection, hover, render mode, theme, dialog
// state, busy counter, modal targets for the various edit dialogs.
// Nothing here touches history or persistence — these are all
// runtime-only setters.

import {
  getSystemTheme,
  loadSnapSettings,
  saveSnapSettings,
} from "./internals.js";

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
  // When retargeting a whole multi-area extrude, the ids of every prism in its
  // createGroup step (the selection is rebuilt as one unit).  null otherwise.
  extrudeRetargetGroup: null,

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

  // Set by the Timeline's chamfer/fillet "Retarget" button:
  // { itemId, entryId }. While set, BevelSection watches
  // selectedSubGeometry and automatically re-applies that chamfer/fillet
  // to the next face/edge picked on this item — updating entryId's
  // history entry in place rather than appending a new step — then
  // clears this back to null.
  chamferRetargetTarget: null,

  // null | "chamfer" | "fillet" — toggled by BevelSection's toolbar
  // buttons. While set, ChamferOverlay shows a hint banner and (once
  // selectedSubGeometry has faces/edges) the distance/angle confirmation
  // overlay, mirroring extrudeSelectMode's pick-then-confirm flow.
  chamferSelectMode: null,

  // null | "pushpull" — toggled by the Modify toolbar's Push/Pull button.
  // While set, PushPullOverlay shows a hint banner and (once
  // selectedSubGeometry has faces) the distance confirmation overlay,
  // mirroring chamferSelectMode.  Mutually exclusive with chamferSelectMode:
  // entering one mode clears the other.
  pushPullSelectMode: null,

  // Set by the Timeline's push/pull "Retarget" button: { itemId, entryId }.
  // While set, PushPullOverlay re-applies to the next face selection by
  // updating entryId's history entry in place (rather than appending a new
  // step), then clears back to null — mirrors chamferRetargetTarget.
  pushPullRetargetTarget: null,

  // Modal state for editing a committed push/pull's distance from the
  // timeline: { entryId }.  Mirrors chamferEditTarget.
  pushPullEditTarget: null,

  // Sketch→solid sweep tools (Revolve / Pipe / Loft), all sharing one select
  // mode driven by the Modify toolbar.  Shape:
  //   { kind:"revolve"|"pipe"|"loft", profile, axis, secondProfile, params }
  // `profile`/`secondProfile` are extrudeProfile snapshots; `axis` is
  // { sketchId, shapeIdx }; `params` holds the op's editable settings.  null
  // when no sweep tool is active.  Phase is derived (profile==null → pick
  // profile; then pick axis/second; then show params + Confirm).
  sweepSelectMode: null,
  // Timeline "Retarget" / "Edit" targets for a committed sweep, mirroring the
  // push/pull equivalents.
  sweepRetargetTarget: null,
  sweepEditTarget: null,

  // Whether the Y=0 ground plane shows shadows for scene objects.
  shadowsEnabled: false,

  // When true, the Objects tree hides items whose visibility is toggled off
  // (and any of their descendants), instead of showing them dimmed.
  hideHiddenItems: false,

  // Cross-section view: clip away everything on the camera-home (+X) side of
  // the world ZY plane (x=0).  The plane is fixed in world space, so rotating
  // the view sweeps the cut through different parts of the model.
  crossSectionView: false,

  // Path-traced render mode (prototype): replaces the raster view with a
  // progressively-accumulated GPU path trace.  `pathTraceView` is the user's
  // toggle; `pathTracerActive` is set true by pathTrace.js only once the tracer
  // is actually running, so a failed start can't freeze the raster view.
  pathTraceView: false,
  pathTracerActive: false,
  // { samples, target } while the tracer is accumulating — drives the
  // progress bar across the top of the viewport. Reset to 0 samples whenever
  // the camera moves (the accumulation buffer resets too).
  pathTraceProgress: null,

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

  // When the regeneration orchestrator is recalculating timeline steps,
  // this tracks how many items have completed vs. how many need to be
  // regenerated.  null when no recalculation is in flight.  The
  // BusyIndicator promotes its spinner to a progress bar while this is
  // set, since recalcs over a many-step timeline can take long enough
  // that "Working…" alone leaves the user wondering how far along they
  // are.
  regenProgress: null,

  // True from the moment the user confirms a cut-extrude until the
  // async CSG difference + consumeItems lands.  Lets the Viewport
  // keep "transparent" render mode active across the brief window
  // between extrudeSelectMode going null and the cut actually being
  // visible — without this, the source solid pops back to opaque for
  // a frame before the cut result replaces it.
  cutExtrudeInProgress: false,

  // Transient message shown as a centered overlay (auto-dismissed by the
  // consumer component after a short delay).  null = nothing visible.
  notification: null,

  settingsDialogOpen: false,
  aboutDialogOpen: false,

  // Snap-to-grid + perspective FOV: when snap is enabled, dragged/moved objects
  // (3D gizmo translate and sketch drags) snap to snapDistanceMm in world space,
  // and gizmo rotations snap to snapAngleDeg.  `fov` is the perspective camera's
  // field of view.  Persisted to localStorage so they survive a reload.
  ...loadSnapSettings(),
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
  setChamferRetargetTarget: (target) => set({ chamferRetargetTarget: target }),
  // Setting either face-select mode clears the other — only one pick/confirm
  // overlay can be active at a time.
  setChamferSelectMode: (mode) =>
    set({ chamferSelectMode: mode, pushPullSelectMode: null }),
  setPushPullSelectMode: (mode) =>
    set({ pushPullSelectMode: mode, chamferSelectMode: null }),
  setPushPullRetargetTarget: (target) =>
    set({ pushPullRetargetTarget: target }),
  setPushPullEditTarget: (target) => set({ pushPullEditTarget: target }),

  // ── Sweep tools (Revolve / Pipe / Loft) ─────────────────────────────────
  setSweepSelectMode: (v) =>
    set({
      sweepSelectMode: v,
      // A sweep tool is exclusive with the face-select tools.
      ...(v ? { chamferSelectMode: null, pushPullSelectMode: null } : null),
    }),
  startSweepTool: (kind) =>
    set({
      sweepSelectMode: {
        kind,
        profile: null,
        axis: null,
        secondProfile: null,
        params: { rotations: 1, offsetPerRotation: 0, prism: false, sides: 6 },
      },
      chamferSelectMode: null,
      pushPullSelectMode: null,
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
  setSweepEditTarget: (target) => set({ sweepEditTarget: target }),
  setShadowsEnabled: (v) => set({ shadowsEnabled: !!v }),
  toggleCrossSectionView: () =>
    set((state) => ({ crossSectionView: !state.crossSectionView })),
  togglePathTraceView: () =>
    set((state) => ({ pathTraceView: !state.pathTraceView })),
  setCameraControls: (controls) => set({ _cameraControls: controls }),

  beginOperation: () =>
    set((state) => ({ pendingOperations: state.pendingOperations + 1 })),
  endOperation: () =>
    set((state) => ({
      pendingOperations: Math.max(0, state.pendingOperations - 1),
    })),

  setRegenProgress: (progress) => set({ regenProgress: progress }),

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
  setCutExtrudeInProgress: (v) => set({ cutExtrudeInProgress: !!v }),
  setExtrudeRetargetId: (id) => set({ extrudeRetargetId: id }),
  setExtrudeRetargetGroup: (ids) => set({ extrudeRetargetGroup: ids }),
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

  toggleHideHiddenItems: () =>
    set((state) => ({ hideHiddenItems: !state.hideHiddenItems })),

  showNotification: (message) => set({ notification: message }),
  clearNotification: () => set({ notification: null }),

  toggleSnap: () =>
    set((state) => {
      const next = { ...state, snapEnabled: !state.snapEnabled };
      saveSnapSettings(next);
      return { snapEnabled: next.snapEnabled };
    }),
  setSnapDistanceMm: (v) =>
    set((state) => {
      const n = Number(v);
      const snapDistanceMm = Number.isFinite(n) && n > 0 ? n : 5;
      saveSnapSettings({ ...state, snapDistanceMm });
      return { snapDistanceMm };
    }),
  setSnapAngleDeg: (v) =>
    set((state) => {
      const n = Number(v);
      const snapAngleDeg = Number.isFinite(n) && n > 0 ? n : 9;
      saveSnapSettings({ ...state, snapAngleDeg });
      return { snapAngleDeg };
    }),
  setFov: (v) =>
    set((state) => {
      const n = Number(v);
      // Clamp to a sane perspective range; very low = nearly orthographic.
      const fov = Number.isFinite(n) ? Math.min(90, Math.max(5, n)) : 35;
      saveSnapSettings({ ...state, fov });
      return { fov };
    }),

  setCurveDetectionAngleDeg: (v) =>
    set((state) => {
      const n = Number(v);
      const curveDetectionAngleDeg =
        Number.isFinite(n) && n >= 0 ? Math.min(90, n) : 5;
      saveSnapSettings({ ...state, curveDetectionAngleDeg });
      return { curveDetectionAngleDeg };
    }),

  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: !!open }),
  setAboutDialogOpen: (open) => set({ aboutDialogOpen: !!open }),
});
