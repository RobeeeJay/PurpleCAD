// UI / ephemeral state: selection, hover, render mode, theme, dialog
// state, busy counter, modal targets for the various edit dialogs.
// Nothing here touches history or persistence — these are all
// runtime-only setters.

import {
  getSystemTheme,
  loadSnapSettings,
  saveSnapSettings,
  SNAP_DEFAULTS,
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
  // Active tessellation mode; its density (mm deviation) is previewPrecisionMm /
  // printPrecisionMm, configurable in Settings.  See three/resolution.js.
  curveResolution: "preview", // "preview" | "print"

  sketchPlacementMode: false,
  extrudeSelectMode: null, // null | "profile" | "depth"
  extrudeRetargetId: null, // id of the extrude being retargeted, or null
  // When retargeting a whole multi-area extrude, the ids of every prism in its
  // createGroup step (the selection is rebuilt as one unit).  null otherwise.
  extrudeRetargetGroup: null,

  // Sub-geometry selection used by the 3D Bevel/Chamfer toolbar buttons.
  selectedSubGeometry: null,

  // Selection widget (top-left of the 3D view): what a click selects.  Object
  // mode (default) greys the sub-types; with it off, the face/edge/point toggles
  // decide, with hover priority point > edge > face.  `selectionOverride` is a
  // tool-forced set of allowed sub-types (e.g. extrude → ["face"]) that wins
  // over the user's toggles until the tool clears it.
  selObject: true,
  selFace: false,
  selEdge: false,
  selPoint: false,
  selectionOverride: null,

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

  // Shell dialog target.  { itemId } opens a fresh shell on a selected body;
  // { itemId, entryId } reopens a committed shell's timeline step to edit its
  // thickness.  Null = closed.
  shellTarget: null,

  // Change-origin tool.  `originToolActive` arms it (click an object to pick its
  // origin); `originDialogItemId` is the object whose OriginDialog is open;
  // `originVertexPick` is the object whose next click snaps the origin to a
  // vertex.
  originToolActive: false,
  originDialogItemId: null,
  originVertexPick: null,

  // Sketch→solid sweep tools (Revolve / Pipe / Loft), all sharing one select
  // mode driven by the Modify toolbar.  Shape:
  //   { kind:"revolve"|"pipe"|"loft", profile, axis, secondProfile, params }
  // `profile`/`secondProfile` are extrudeProfile snapshots; `axis` is
  // { sketchId, shapeIdx }; `params` holds the op's editable settings.  null
  // when no sweep tool is active.  Phase is derived (profile==null → pick
  // profile; then pick axis/second; then show params + Confirm).
  sweepSelectMode: null,
  // Timeline "Retarget" / "Edit" target for a committed sweep.
  sweepRetargetTarget: null,

  // Whether the Y=0 ground plane shows shadows for scene objects.
  shadowsEnabled: false,

  // When true, the Objects tree hides items whose visibility is toggled off
  // (and any of their descendants), instead of showing them dimmed.
  hideHiddenItems: false,

  // Cross-section view: clip away everything on the camera-home (+X) side of
  // the world ZY plane (x=0).  The plane is fixed in world space, so rotating
  // the view sweeps the cut through different parts of the model.
  crossSectionView: false,

  // Plane-object creation: a base frame (from a selected sketch / face, or the
  // default XY) the dialog then adjusts — rotation (deg, per-axis) + offset
  // along the plane normal.  { base:{position,rotation}, rot:{x,y,z}, offset }
  planeTool: null,
  // True while picking the 3 points that define a new plane in the 3D view.
  planePickActive: false,

  // Pending circular/rectangular 3D pattern: { patternType, sourceId, ... }.
  // For circular the dialog also captures an `axis` ({ origin, dir } in world,
  // picked off a sketch line or face edge); the dialog adds counts/angle/spacing.
  pattern3dTool: null,
  // True while picking the circular pattern's rotation axis in the 3D view.
  circularAxisPick: false,

  // 3D Mirror dialog open-flag (truthy while open).  The dialog itself owns the
  // picked object/plane ids; this just gates its visibility.  Named *3d to avoid
  // colliding with the sketch slice's startMirrorTool (the 2D sketch mirror).
  mirror3dTool: null,

  // Sketch Project tool: while open, clicks/marquee-drags accumulate the
  // projected sketch shapes (with a live preview) into `shapes`; the dialog
  // confirms (commits them) or cancels.
  projectTool: null,

  // Split tool: a guided pick flow (no pre-selection needed).  splitTool holds
  // the chosen object + cut plane; splitPick names which a viewport click picks.
  splitTool: null,
  splitPick: null, // "object" | "cut" | null

  // Solo: when set, the viewport shows ONLY this item (even if marked hidden)
  // and hides every other object.  Ephemeral (not history/persisted).  soloView
  // is the camera snapshot captured when solo turned on, restored when it ends.
  soloItemId: null,
  soloView: null,

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
  // field of view.  Persisted (SQLite/localStorage) so they survive a reload.
  ...loadSnapSettings(),
};

export const createUiSlice = (set) => ({
  selectItem: (id) =>
    set({ selectedId: id, selectedIds: id != null ? [id] : [] }),

  // Replace the whole selection with an explicit id list (used by tools that
  // restore a previously-captured pick set, e.g. the Mirror dialog).
  setSelection: (ids) =>
    set({ selectedIds: [...ids], selectedId: ids[ids.length - 1] ?? null }),

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
    set({
      chamferSelectMode: mode,
      pushPullSelectMode: null,
      // Chamfer/fillet pick edges and faces; nothing else.
      selectionOverride: mode ? ["edge", "face"] : null,
    }),
  setPushPullSelectMode: (mode) =>
    set({
      pushPullSelectMode: mode,
      chamferSelectMode: null,
      selectionOverride: mode ? ["face"] : null,
    }),

  // Selection-widget toggles.  Turning a sub-type on leaves object mode; turning
  // object off keeps at least one sub-type so something stays selectable.
  toggleSelObject: () =>
    set((s) => {
      if (!s.selObject) return { selObject: true };
      const any = s.selFace || s.selEdge || s.selPoint;
      return { selObject: false, ...(any ? null : { selFace: true }) };
    }),
  toggleSelFace: () => set((s) => ({ selObject: false, selFace: !s.selFace })),
  toggleSelEdge: () => set((s) => ({ selObject: false, selEdge: !s.selEdge })),
  toggleSelPoint: () =>
    set((s) => ({ selObject: false, selPoint: !s.selPoint })),
  setSelectionOverride: (types) => set({ selectionOverride: types }),
  setPushPullRetargetTarget: (target) =>
    set({ pushPullRetargetTarget: target }),
  setPushPullEditTarget: (target) => set({ pushPullEditTarget: target }),
  setShellTarget: (target) => set({ shellTarget: target }),
  setOriginToolActive: (v) =>
    set({
      originToolActive: !!v,
      // Origin works on whole objects → lock the selection widget to Object.
      selectionOverride: v ? ["object"] : null,
      ...(v ? null : { originDialogItemId: null, originVertexPick: null }),
    }),
  openOriginDialog: (itemId) =>
    set({ originDialogItemId: itemId, originVertexPick: null }),
  closeOriginDialog: () => set({ originDialogItemId: null }),
  setOriginVertexPick: (itemId) => set({ originVertexPick: itemId }),

  // ── Plane object + 3D pattern tools ─────────────────────────────────────
  // false when off, else a mode string ("points" | "face") naming what a
  // viewport click contributes to the plane being defined.
  setPlanePickActive: (v) => set({ planePickActive: v || false }),
  startPlaneTool: (base) =>
    set({ planeTool: { base, rot: { x: 0, y: 0, z: 0 }, offset: 0 } }),
  updatePlaneTool: (partial) =>
    set((state) =>
      state.planeTool ? { planeTool: { ...state.planeTool, ...partial } } : {},
    ),
  cancelPlaneTool: () => set({ planeTool: null }),
  // Mirror / circular / rectangular patterns all act on whole objects, so they
  // lock the selection widget to Object mode while active.
  startPattern3d: (v) =>
    set({ pattern3dTool: v, selectionOverride: ["object"] }),
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
    set({ mirror3dTool: seed || {}, selectionOverride: ["object"] }),
  cancelMirror3d: () => set({ mirror3dTool: null, selectionOverride: null }),

  startProjectTool: () => set({ projectTool: { shapes: [] } }),
  addProjectShapes: (shapes) =>
    set((state) =>
      state.projectTool
        ? { projectTool: { shapes: [...state.projectTool.shapes, ...shapes] } }
        : {},
    ),
  cancelProjectTool: () => set({ projectTool: null }),

  // Solo controls.  setItemSolo captures the camera snapshot (first solo);
  // switchItemSolo re-points an active solo without re-capturing the view;
  // clearItemSolo ends solo (the caller restores the view from soloView first).
  startSplit3d: (seed) =>
    set({
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

  setItemSolo: (id, view) => set({ soloItemId: id, soloView: view ?? null }),
  switchItemSolo: (id) => set({ soloItemId: id }),
  clearItemSolo: () => set({ soloItemId: null, soloView: null }),

  // ── Sweep tools (Revolve / Pipe / Loft) ─────────────────────────────────
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
      sweepSelectMode: {
        kind,
        profile: null,
        axis: null,
        secondProfile: null,
        params: { rotations: 1, offsetPerRotation: 0, prism: false, sides: 6 },
      },
      chamferSelectMode: null,
      pushPullSelectMode: null,
      selectionOverride: null,
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
  setShadowsEnabled: (v) => set({ shadowsEnabled: !!v }),
  toggleCrossSectionView: () =>
    set((state) => ({ crossSectionView: !state.crossSectionView })),
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
  setExtrudeSelectMode: (mode) =>
    set({ extrudeSelectMode: mode, selectionOverride: mode ? ["face"] : null }),
  setCutExtrudeInProgress: (v) => set({ cutExtrudeInProgress: !!v }),
  setExtrudeRetargetId: (id) => set({ extrudeRetargetId: id }),
  setExtrudeRetargetGroup: (ids) => set({ extrudeRetargetGroup: ids }),
  // Selecting a raster render mode also leaves the path-traced view, so the
  // four modes (wireframe/shaded/transparent/path-traced) act as one radio set.
  setRenderMode: (mode) => set({ renderMode: mode, pathTraceView: false }),
  setPathTraceView: (v) => set({ pathTraceView: !!v }),
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
  setAlwaysExtrudeSingleObject: (v) =>
    set((state) => {
      const alwaysExtrudeSingleObject = !!v;
      saveSnapSettings({ ...state, alwaysExtrudeSingleObject });
      return { alwaysExtrudeSingleObject };
    }),
  // Restore every configurable setting to its default (the snap/precision group
  // plus the session-only theme + orientation widget).
  resetSettings: () =>
    set(() => {
      saveSnapSettings(SNAP_DEFAULTS);
      return {
        ...SNAP_DEFAULTS,
        theme: getSystemTheme(),
        widgetVisible: true,
      };
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

  // Tessellation density (mm deviation) for the two resolution modes.  Clamped
  // to a sane range; lower = denser.  A change re-triggers scene regeneration
  // because the resolved precision is a scene-sync effect dependency.
  setPreviewPrecisionMm: (v) =>
    set((state) => {
      const n = Number(v);
      const previewPrecisionMm =
        Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(0.001, n)) : 0.5;
      saveSnapSettings({ ...state, previewPrecisionMm });
      return { previewPrecisionMm };
    }),
  setPrintPrecisionMm: (v) =>
    set((state) => {
      const n = Number(v);
      const printPrecisionMm =
        Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(0.001, n)) : 0.01;
      saveSnapSettings({ ...state, printPrecisionMm });
      return { printPrecisionMm };
    }),

  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: !!open }),
  setAboutDialogOpen: (open) => set({ aboutDialogOpen: !!open }),
});
