// UI / ephemeral state: selection, hover, render mode, theme, dialog
// state, busy counter, modal targets for the various edit dialogs.
// Nothing here touches history or persistence — these are all
// runtime-only setters.

import { getSystemTheme, loadSnapSettings, welcomeDue } from "./internals.js";
import { TOOL_RESET_PATCH } from "./uiToolReset.js";
export { TOOL_RESET_PATCH };
import { createUiModifyToolsSlice } from "./uiModifyToolsSlice.js";
import { createUiConstructToolsSlice } from "./uiConstructToolsSlice.js";
import { createUiViewSettingsSlice } from "./uiViewSettingsSlice.js";

export const uiInitial = {
  selectedId: null,
  selectedIds: [],
  hoveredId: null,

  theme: getSystemTheme(),
  renderMode: "shaded",
  projectionMode: "perspective",
  widgetVisible: true,
  // Combined-axis indicator: off by default, persisted via snap settings
  // (loadSnapSettings below overrides this with the saved value).
  axisVisible: false,
  constraintsVisible: true,
  dimensionsVisible: true,
  cameraResetTrigger: 0,

  sketchPlacementMode: false,
  extrudeSelectMode: null, // null | "profile" | "depth"
  extrudeRetargetId: null, // id of the extrude being retargeted, or null
  // When retargeting a whole multi-area extrude, the ids of every prism in its
  // createGroup step (the selection is rebuilt as one unit).  null otherwise.
  extrudeRetargetGroup: null,
  // Id of a FUSED extrude (extrudeUnion / extrudeCut csg item) being edited.
  // Its prism recipes live in regenerator.extrudeDefs, not as store items, so it
  // can't use extrudeRetargetGroup (which keys on a createGroup's prism ids).
  extrudeRetargetFusedId: null,
  // While an extrusion is edited from the timeline, the timeline shows its
  // step -- the scene as it was when it was made -- and returns here after:
  // { to: activeHistoryId } (to: null = the latest step).  Null otherwise.
  extrudeEditReturn: null,

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
  // Chain selection: when on, a face/edge pick follows the curve across the
  // curveDetectionAngleDeg limit (a whole fillet / smooth edge run selects as
  // one).  Only meaningful for face/edge selection, so it's gated on those in
  // the widget — but the flag is remembered while gated off so re-enabling a
  // face/edge type restores the user's choice.  Default on preserves the
  // previous always-chaining behaviour.
  selChain: true,
  selectionOverride: null,
  // When true, a plain object click adds to (toggles) the multi-selection
  // instead of replacing it — no shift needed.  Set by pick tools that gather
  // several objects at once (e.g. the Boolean dialog).
  additiveObjectPick: false,
  // Saved selection-type set before a Cmd/Ctrl-click "solo" isolate, so a second
  // solo-click restores it.  Cleared by any normal toggle.
  selTypeSolo: null,

  // Active extrude-depth input overlay.  Populated when the user enters
  // "depth" mode after picking a profile; cleared when they confirm or
  // cancel the extrude.  defaultDepth is in scene units (multiply by
  // MM_PER_UNIT for display).
  extrudeDepthInput: null,

  // Arms the chamfer/fillet creation overlay as an editor: { itemId, entryId }
  // of the committed entry being edited; Confirm updates it in place.
  chamferEditTarget: null,

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
  // step), then clears back to null.
  pushPullRetargetTarget: null,

  // Modal state for editing a committed push/pull's distance from the
  // timeline: { entryId }.
  pushPullEditTarget: null,

  // Shell dialog target.  { itemId } opens a fresh shell on a selected body;
  // { itemId, entryId } reopens a committed shell's timeline step to edit its
  // thickness.  Null = closed.
  shellTarget: null,

  // Simplify dialog target, the same shape as shellTarget: { itemId } for a
  // fresh simplify of a mesh body, { itemId, entryId } to edit a committed one.
  simplifyTarget: null,
  // Convert to Surfaces dialog target, the same shape: { itemId } for a fresh
  // conversion of a mesh body, { itemId, entryId } to edit a committed one.
  convertTarget: null,

  // Change-origin tool.  `originToolActive` arms it (click an object to pick its
  // origin); `originDialogItemId` is the object whose OriginDialog is open;
  // `originVertexPick` is the object whose next click snaps the origin to a
  // vertex.
  originToolActive: false,
  originDialogItemId: null,
  originVertexPick: null,

  // Hole tool: a guided flow — pick a face, then a point (a vertex or a spot on
  // the face plane), then set length / diameter / metric thread / tolerance and
  // confirm.  face/point are in the target's local geometry frame.
  //   { phase:"face"|"point"|"params", itemId, face:{normal,point}, point, params }
  holeTool: null,

  // Emboss/deboss tool: stamp sketch geometry onto a body face as relief.
  //   { picking:null|"geometry"|"faces", itemId, profiles:[], face, faceSet, params }
  embossTool: null,

  // Texture tool: bump-map displacement on a picked connected-face set.
  //   { picking:null|"faces", itemId, face, faceSet, faceTris, params }
  textureTool: null,
  // Texture library picker (defaults + imports) opened from TextureDialog.
  textureLibraryOpen: false,

  // The last operation error for the active tool dialog (emboss/draft/…), shown
  // as a line under the dialog.  The tool's live preview sets it on failure (with
  // the OCC message) and clears it on success; cleared when a tool starts.
  toolError: null,

  // Measure tool: read-only inspection of distances / dimensions / lengths.
  //   3D: { picks:[entity…] } accumulated by clicking (entity = world-space
  //   point/segment/face/object, see three/measure.js); sketch reads the live
  //   line/point selection instead.  null when off.
  measureTool: null,

  // Box (parametric cube) dimensions dialog: the id of the box being created or
  // edited, or null.  The dialog previews live (resizes the mesh in place) and
  // commits the dimensions via modifyItem.
  boxDialog: null,

  // Draft tool: taper selected faces about a neutral (main) face's plane.
  //   { picking:null|"main"|"faces", itemId, source, neutral:{nx..,cx..},
  //     faces:[{nx..,cx..}], angleDeg, flip }
  draftTool: null,

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

  // Boolean (Union / Difference / Intersection) dialog: { operation }.  The
  // dialog owns the picked primary/secondary object ids; this just carries which
  // operation is running and gates visibility.
  booleanTool: null,
  // Ids of the Cut tool's cutting objects, so the 3D view can tint them red
  // (distinct from the base).  Kept in sync by the dialog; empty otherwise.
  booleanCutIds: [],

  // Sketch Project tool: while open, clicks/marquee-drags accumulate the
  // projected sketch shapes (with a live preview) into `shapes`; the dialog
  // confirms (commits them) or cancels.
  projectTool: null,

  // Split tool: a guided pick flow (no pre-selection needed).  splitTool holds
  // the chosen object + cut plane; splitPick names which a viewport click picks.
  splitTool: null,
  splitPick: null, // "object" | "cut" | null

  // Point-to-Point move: pick a vertex on object A, then a vertex on a different
  // object B; confirming shifts A so A's vertex lands on B's.  Points are world
  // coords captured at pick time.  { picking:"A"|"B"|null, a:{itemId,point}, b:{…} }
  pointToPointTool: null,

  // Drop to ground: pick a face (normal and point in the body's local frame)
  // that is turned to face straight down before the drop.
  // { picking: bool, face: { itemId, normal, point } | null }
  faceToGroundTool: null,

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

  // Bumped each time the user hits Cancel in the BusyIndicator.  A
  // synchronous native OCC call can't be interrupted mid-computation, so
  // "cancel" means: stop the step-wise timeline recalc between steps AND
  // discard the result of any single in-flight op (runOp captures this
  // token and drops a result whose token has since changed).
  cancelEpoch: 0,
  // Set alongside a cancel bump so an op that returns "no result" because it
  // was cancelled doesn't surface a misleading "could not apply" notice.
  operationCancelled: false,

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
  // What the notification offers to do about itself, or null: today only
  // { kind: "simplifyToFit", itemId, targetTriangles } (see
  // uiViewSettingsSlice#simplifyToFit).
  notificationAction: null,

  settingsDialogOpen: false,
  aboutDialogOpen: false,
  welcomeDialogOpen: welcomeDue(),
  projectsDialogOpen: false,
  // Debug browser for every object in the scene (Objects list header).
  sceneInspectorOpen: false,

  // Snap-to-grid + perspective FOV: when snap is enabled, dragged/moved objects
  // (3D gizmo translate and sketch drags) snap to snapDistanceMm in world space,
  // and gizmo rotations snap to snapAngleDeg.  `fov` is the perspective camera's
  // field of view.  Persisted (SQLite/localStorage) so they survive a reload.
  ...loadSnapSettings(),
};

// Every in-progress 3D tool / modal state, reset to its idle value.  Starting
// any tool spreads this first (so its own state, set afterwards, wins), which
// cancels whatever operation was in progress.  The tools' React overlays /
// dialogs watch these fields and tear down their previews when they go idle.
// (Sketch-mode drawing tools are excluded — they own their own switching.)

export const createUiSlice = (set, get) => ({
  // The tool phase machines and the view/settings actions live in sibling
  // slices -- this file keeps the selection, solo and busy-counter core.
  ...createUiModifyToolsSlice(set, get),
  ...createUiConstructToolsSlice(set),
  ...createUiViewSettingsSlice(set),

  // Cancel every in-progress tool operation (used when a new tool is selected).
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
  // Selection-widget toggles.  Turning a sub-type on leaves object mode; turning
  // object off keeps at least one sub-type so something stays selectable.
  toggleSelObject: () =>
    set((s) => {
      if (!s.selObject) return { selObject: true, selTypeSolo: null };
      const any = s.selFace || s.selEdge || s.selPoint;
      return {
        selObject: false,
        selTypeSolo: null,
        ...(any ? null : { selFace: true }),
      };
    }),
  toggleSelFace: () =>
    set((s) => ({ selObject: false, selFace: !s.selFace, selTypeSolo: null })),
  toggleSelEdge: () =>
    set((s) => ({ selObject: false, selEdge: !s.selEdge, selTypeSolo: null })),
  toggleSelPoint: () =>
    set((s) => ({
      selObject: false,
      selPoint: !s.selPoint,
      selTypeSolo: null,
    })),
  // Chain toggle: only actionable while a face or edge type is on (the widget
  // greys it otherwise), but the value is kept either way so it's remembered.
  toggleSelChain: () =>
    set((s) => (s.selFace || s.selEdge ? { selChain: !s.selChain } : {})),
  // Cmd/Ctrl-click: isolate one type (others off), saving the prior set; a second
  // solo-click on the isolated type restores it.
  soloSelType: (key) =>
    set((s) => {
      const cur = {
        selObject: s.selObject,
        selFace: s.selFace,
        selEdge: s.selEdge,
        selPoint: s.selPoint,
      };
      const flag = {
        object: "selObject",
        face: "selFace",
        edge: "selEdge",
        point: "selPoint",
      }[key];
      if (!flag) return {};
      const isolated = Object.entries(cur).every(([f, v]) =>
        f === flag ? v : !v,
      );
      if (isolated && s.selTypeSolo) {
        return { ...s.selTypeSolo, selTypeSolo: null };
      }
      const saved = s.selTypeSolo || cur;
      return {
        selObject: flag === "selObject",
        selFace: flag === "selFace",
        selEdge: flag === "selEdge",
        selPoint: flag === "selPoint",
        selTypeSolo: saved,
      };
    }),

  // Operation error surfaced under a tool dialog (null clears the line).
  // ── Emboss tool ─────────────────────────────────────────────────────────
  // ── Texture tool ──────────────────────────────────────────────────────────
  // Bump-map displacement on a picked connected-face set.  Mirrors the emboss
  // state machine; the PNG rides as a dataURL in params so the recipe (and the
  // saved document) is self-contained.
  // ── Draft tool ──────────────────────────────────────────────────────────
  // Guided like Hole/Emboss — no pre-selection needed; the body is learned from
  // the main-face pick.
  // ── Primitive dimensions dialog ──────────────────────────────────────────
  // Edit an existing primitive's dimensions ({ id }), or create a new one with a
  // live ghost preview that's only added to the timeline on Confirm
  // ({ create: { type, position } }).
  // ── Measure tool ──────────────────────────────────────────────────────────

  // ── Plane object + 3D pattern tools ─────────────────────────────────────
  // false when off, else a mode string ("points" | "face") naming what a
  // viewport click contributes to the plane being defined.
  // Boolean tools act on whole objects, so they lock the selection widget to
  // Object mode while the dialog is open.

  // Solo controls.  setItemSolo captures the camera snapshot (first solo);
  // switchItemSolo re-points an active solo without re-capturing the view;
  // clearItemSolo ends solo (the caller restores the view from soloView first).
  // ── Point-to-Point move ──────────────────────────────────────────────────

  setItemSolo: (id, view) => set({ soloItemId: id, soloView: view ?? null }),
  switchItemSolo: (id) => set({ soloItemId: id }),
  clearItemSolo: () => set({ soloItemId: null, soloView: null }),

  // ── Sweep tools (Revolve / Pipe / Loft) ─────────────────────────────────
  setCameraControls: (controls) => set({ _cameraControls: controls }),

  beginOperation: () =>
    // A fresh operation clears any stale cancel flag from a prior one.
    set((state) => ({
      pendingOperations: state.pendingOperations + 1,
      operationCancelled: false,
    })),
  endOperation: () =>
    set((state) => ({
      pendingOperations: Math.max(0, state.pendingOperations - 1),
    })),

  // Cancel whatever is driving the BusyIndicator.  Bumps cancelEpoch, which the
  // Viewport observes to ask the worker to ABORT its in-flight native op (via
  // the shared cancel flag — frees the CPU), the regen loop to bail between
  // steps, and runOp to discard any result that still lands; the counters clear
  // immediately so the dialog dismisses at once.
  requestOperationCancel: () =>
    set((state) => {
      // eslint-disable-next-line no-console
      console.log(
        `[OCC] CANCEL requested (epoch ${state.cancelEpoch} -> ${state.cancelEpoch + 1}); worker aborts the in-flight op, its result is discarded`,
      );
      return {
        cancelEpoch: state.cancelEpoch + 1,
        operationCancelled: true,
        pendingOperations: 0,
        regenProgress: null,
      };
    }),

  setRegenProgress: (progress) => set({ regenProgress: progress }),

  setSketchPlacementMode: (active) =>
    set((s) =>
      active && !s.sketchPlacementMode
        ? { ...TOOL_RESET_PATCH, sketchPlacementMode: true }
        : { sketchPlacementMode: active },
    ),
  setExtrudeSelectMode: (mode) =>
    set((s) => {
      const own = {
        extrudeSelectMode: mode,
        selectionOverride: mode ? ["face"] : null,
      };
      // Only cancel other tools when ENTERING extrude, not on phase changes.
      return mode && !s.extrudeSelectMode
        ? { ...TOOL_RESET_PATCH, ...own }
        : own;
    }),
  setCutExtrudeInProgress: (v) => set({ cutExtrudeInProgress: !!v }),
  setExtrudeRetargetId: (id) => set({ extrudeRetargetId: id }),
  setExtrudeRetargetGroup: (ids) => set({ extrudeRetargetGroup: ids }),
  setExtrudeRetargetFusedId: (id) => set({ extrudeRetargetFusedId: id }),
  // Selecting a raster render mode also leaves the path-traced view, so the
  // four modes (wireframe/shaded/transparent/path-traced) act as one radio set.

  // Tessellation density (mm deviation) for the two resolution modes.  Clamped
  // to a sane range; lower = denser.  A change re-triggers scene regeneration
  // because the resolved precision is a scene-sync effect dependency.
});
