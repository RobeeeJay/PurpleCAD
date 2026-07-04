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
  // Combined-axis indicator: off by default, persisted via snap settings
  // (loadSnapSettings below overrides this with the saved value).
  axisVisible: false,
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

  // Hole tool: a guided flow — pick a face, then a point (a vertex or a spot on
  // the face plane), then set length / diameter / metric thread / tolerance and
  // confirm.  face/point are in the target's local geometry frame.
  //   { phase:"face"|"point"|"params", itemId, face:{normal,point}, point, params }
  holeTool: null,

  // Emboss/deboss tool: stamp sketch geometry onto a body face as relief.
  //   { picking:null|"geometry"|"faces", itemId, profiles:[], face, faceSet, params }
  embossTool: null,

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
  projectsDialogOpen: false,

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
export const TOOL_RESET_PATCH = {
  sketchPlacementMode: false,
  extrudeSelectMode: null,
  extrudeRetargetId: null,
  extrudeRetargetGroup: null,
  extrudeEditTarget: null,
  extrudeDepthInput: null,
  cutExtrudeInProgress: false,
  chamferSelectMode: null,
  chamferRetargetTarget: null,
  chamferEditTarget: null,
  pushPullSelectMode: null,
  pushPullRetargetTarget: null,
  pushPullEditTarget: null,
  shellTarget: null,
  holeTool: null,
  embossTool: null,
  draftTool: null,
  measureTool: null,
  sweepSelectMode: null,
  sweepRetargetTarget: null,
  planeTool: null,
  planePickActive: false,
  pattern3dTool: null,
  circularAxisPick: false,
  mirror3dTool: null,
  booleanTool: null,
  booleanCutIds: [],
  additiveObjectPick: false,
  projectTool: null,
  splitTool: null,
  splitPick: null,
  originToolActive: false,
  originDialogItemId: null,
  originVertexPick: null,
  pointToPointTool: null,
  selectionOverride: null,
  toolError: null,
};

export const createUiSlice = (set) => ({
  // Cancel every in-progress tool operation (used when a new tool is selected).
  cancelActiveTools: () => set({ ...TOOL_RESET_PATCH }),

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
    set((s) => {
      const own = {
        chamferSelectMode: mode,
        pushPullSelectMode: null,
        // Chamfer/fillet pick edges and faces; nothing else.
        selectionOverride: mode ? ["edge", "face"] : null,
      };
      return mode && !s.chamferSelectMode
        ? { ...TOOL_RESET_PATCH, ...own }
        : own;
    }),
  setPushPullSelectMode: (mode) =>
    set((s) => {
      const own = {
        pushPullSelectMode: mode,
        chamferSelectMode: null,
        selectionOverride: mode ? ["face"] : null,
      };
      return mode && !s.pushPullSelectMode
        ? { ...TOOL_RESET_PATCH, ...own }
        : own;
    }),

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
  setSelectionOverride: (types) => set({ selectionOverride: types }),
  setPushPullRetargetTarget: (target) =>
    set({ pushPullRetargetTarget: target }),
  setPushPullEditTarget: (target) => set({ pushPullEditTarget: target }),
  setShellTarget: (target) =>
    set((s) =>
      target && !s.shellTarget
        ? { ...TOOL_RESET_PATCH, shellTarget: target }
        : { shellTarget: target },
    ),
  setOriginToolActive: (v) =>
    set((s) => {
      const own = {
        originToolActive: !!v,
        // Origin works on whole objects → lock the selection widget to Object.
        selectionOverride: v ? ["object"] : null,
        ...(v ? null : { originDialogItemId: null, originVertexPick: null }),
      };
      return v && !s.originToolActive ? { ...TOOL_RESET_PATCH, ...own } : own;
    }),
  openOriginDialog: (itemId) =>
    set({ originDialogItemId: itemId, originVertexPick: null }),
  closeOriginDialog: () => set({ originDialogItemId: null }),
  setOriginVertexPick: (itemId) => set({ originVertexPick: itemId }),

  startHoleTool: () =>
    set({
      ...TOOL_RESET_PATCH,
      holeTool: {
        phase: "face",
        itemId: null,
        face: null,
        point: null,
        params: {
          lengthMm: 10,
          threadType: "M6",
          diameterMm: 6,
          pitchMm: 1.0,
          toleranceMm: 0.1,
          threaded: true,
        },
      },
    }),
  cancelHoleTool: () => set({ holeTool: null }),
  // Re-open a committed hole's timeline step to edit its params.  Replays the
  // frozen pre-hole source so changes re-cut the original body.
  beginHoleEdit: (entryId) =>
    set((state) => {
      const entry = state.history.find((h) => h.id === entryId);
      const r = entry?.instruction?.patches?.regenerator;
      if (r?.kind !== "hole") return {};
      const h = r.hole;
      return {
        holeTool: {
          phase: "params",
          itemId: entry.itemId,
          editEntryId: entryId,
          source: r.source,
          face: {
            normal: { x: -h.dir.x, y: -h.dir.y, z: -h.dir.z },
            point: h.point,
          },
          point: h.point,
          params: {
            lengthMm: h.length,
            diameterMm: h.diameter,
            pitchMm: h.pitch || 0,
            toleranceMm: h.tolerance || 0,
            threaded: !!h.threaded,
            threadType: h.threadType || "none",
          },
        },
      };
    }),
  setHoleFace: (itemId, face) =>
    set((s) =>
      s.holeTool
        ? { holeTool: { ...s.holeTool, itemId, face, phase: "point" } }
        : {},
    ),
  setHolePoint: (point) =>
    set((s) =>
      s.holeTool ? { holeTool: { ...s.holeTool, point, phase: "params" } } : {},
    ),
  updateHoleParams: (partial) =>
    set((s) =>
      s.holeTool
        ? {
            holeTool: {
              ...s.holeTool,
              params: { ...s.holeTool.params, ...partial },
            },
          }
        : {},
    ),

  // Operation error surfaced under a tool dialog (null clears the line).
  setToolError: (msg) => set({ toolError: msg || null }),

  // ── Emboss tool ─────────────────────────────────────────────────────────
  startEmbossTool: () =>
    set({
      ...TOOL_RESET_PATCH,
      embossTool: {
        // Open straight into geometry picking — the first thing the user does.
        picking: "geometry",
        itemId: null,
        profiles: [],
        face: null,
        faceSet: null,
        // Accumulated triangles of a multi-face selection (flat x,y,z; 9 per tri)
        // and whether they form one set connected within 45° (gates Confirm).
        faceTris: null,
        facesValid: false,
        params: {
          deboss: false,
          angleDeg: 0,
          offsetMm: 0,
          offsetVMm: 0,
          scale: 1,
          distanceMm: 2,
          projection: "center",
          mirrorH: false,
          mirrorV: false,
        },
      },
    }),
  cancelEmbossTool: () => set({ embossTool: null }),
  // Arm one of the two picks (toggles off if it was already armed).
  setEmbossPicking: (kind) =>
    set((s) =>
      s.embossTool
        ? {
            embossTool: {
              ...s.embossTool,
              picking: s.embossTool.picking === kind ? null : kind,
            },
          }
        : {},
    ),
  setEmbossProfiles: (profiles) =>
    set((s) =>
      s.embossTool ? { embossTool: { ...s.embossTool, profiles } } : {},
    ),
  // Set the (possibly multi-face) emboss target.  `keepPicking` leaves the face
  // pick armed so the user can keep adding faces; a primitive's single curved
  // face clears it (one click is the whole face).
  setEmbossFaceSelection: (sel) =>
    set((s) => {
      if (!s.embossTool) return {};
      // A curved surface (sphere / cylinder / developable all return a faceSet;
      // flat faces return null) is degenerate under centre projection — a flat
      // stamp tangent at one point barely intersects.  So nudge the still-default
      // "center" to "conform" on a curved pick; a manual conform choice is kept.
      const params =
        sel.faceSet && s.embossTool.params.projection === "center"
          ? { ...s.embossTool.params, projection: "conform" }
          : s.embossTool.params;
      return {
        embossTool: {
          ...s.embossTool,
          itemId: sel.itemId,
          face: sel.face,
          faceSet: sel.faceSet,
          faceTris: sel.faceTris ?? null,
          facesValid: !!sel.valid,
          picking: sel.keepPicking ? s.embossTool.picking : null,
          params,
        },
      };
    }),
  updateEmbossParams: (partial) =>
    set((s) =>
      s.embossTool
        ? {
            embossTool: {
              ...s.embossTool,
              params: { ...s.embossTool.params, ...partial },
            },
          }
        : {},
    ),
  // Re-open a committed emboss step to edit its params, replaying the frozen recipe.
  beginEmbossEdit: (entryId) =>
    set((state) => {
      const entry = state.history.find((h) => h.id === entryId);
      const r = entry?.instruction?.patches?.regenerator;
      if (r?.kind !== "emboss") return {};
      return {
        embossTool: {
          picking: null,
          editEntryId: entryId,
          itemId: entry.itemId,
          source: r.source,
          profiles: r.profiles || [],
          face: r.face,
          faceSet: r.faceSet || null,
          faceTris: r.faceTris || null,
          // A committed emboss had a valid face selection.
          facesValid: true,
          params: { ...r.params },
        },
      };
    }),

  // ── Draft tool ──────────────────────────────────────────────────────────
  // Guided like Hole/Emboss — no pre-selection needed; the body is learned from
  // the main-face pick.
  // ── Primitive dimensions dialog ──────────────────────────────────────────
  // Edit an existing primitive's dimensions ({ id }), or create a new one with a
  // live ghost preview that's only added to the timeline on Confirm
  // ({ create: { type, position } }).
  openBoxDialog: (id) => set({ boxDialog: { id } }),
  openBoxCreate: (type, position) =>
    set({ boxDialog: { create: { type, position } } }),
  closeBoxDialog: () => set({ boxDialog: null }),

  // ── Measure tool ──────────────────────────────────────────────────────────
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

  startDraftTool: () =>
    set({
      ...TOOL_RESET_PATCH,
      draftTool: {
        picking: "main",
        itemId: null,
        source: null,
        neutral: null,
        faces: [],
        angleDeg: 3,
        flip: false,
      },
    }),
  cancelDraftTool: () => set({ draftTool: null }),
  setDraftPicking: (kind) =>
    set((s) =>
      s.draftTool
        ? {
            draftTool: {
              ...s.draftTool,
              picking: s.draftTool.picking === kind ? null : kind,
            },
          }
        : {},
    ),
  // The neutral (main) face is the pivot plane; one click sets it (and the body
  // it belongs to), then arm the face pick automatically.
  setDraftNeutral: (neutral, itemId) =>
    set((s) =>
      s.draftTool
        ? {
            draftTool: {
              ...s.draftTool,
              neutral,
              itemId: itemId ?? s.draftTool.itemId,
              picking: "faces",
            },
          }
        : {},
    ),
  // Toggle a face in the drafted set (matched by normal + nearby centroid).
  toggleDraftFace: (face) =>
    set((s) => {
      if (!s.draftTool) return {};
      const same = (a, b) =>
        Math.abs(a.nx - b.nx) < 0.02 &&
        Math.abs(a.ny - b.ny) < 0.02 &&
        Math.abs(a.nz - b.nz) < 0.02 &&
        Math.hypot(a.cx - b.cx, a.cy - b.cy, a.cz - b.cz) < 0.1;
      const has = s.draftTool.faces.some((f) => same(f, face));
      const faces = has
        ? s.draftTool.faces.filter((f) => !same(f, face))
        : [...s.draftTool.faces, face];
      return { draftTool: { ...s.draftTool, faces } };
    }),
  updateDraftParams: (partial) =>
    set((s) =>
      s.draftTool ? { draftTool: { ...s.draftTool, ...partial } } : {},
    ),
  beginDraftEdit: (entryId) =>
    set((state) => {
      const entry = state.history.find((h) => h.id === entryId);
      const r = entry?.instruction?.patches?.regenerator;
      if (r?.kind !== "draft") return {};
      return {
        draftTool: {
          picking: null,
          editEntryId: entryId,
          itemId: entry.itemId,
          source: r.source,
          neutral: r.neutral,
          faces: r.faces || [],
          angleDeg: r.angleDeg ?? 3,
          flip: !!r.flip,
        },
      };
    }),

  // ── Plane object + 3D pattern tools ─────────────────────────────────────
  // false when off, else a mode string ("points" | "face") naming what a
  // viewport click contributes to the plane being defined.
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

  // Boolean tools act on whole objects, so they lock the selection widget to
  // Object mode while the dialog is open.
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

  // Solo controls.  setItemSolo captures the camera snapshot (first solo);
  // switchItemSolo re-points an active solo without re-capturing the view;
  // clearItemSolo ends solo (the caller restores the view from soloView first).
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

  // ── Point-to-Point move ──────────────────────────────────────────────────
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
  // Selecting a raster render mode also leaves the path-traced view, so the
  // four modes (wireframe/shaded/transparent/path-traced) act as one radio set.
  setRenderMode: (mode) => set({ renderMode: mode, pathTraceView: false }),
  setPathTraceView: (v) => set({ pathTraceView: !!v }),
  setProjectionMode: (mode) => set({ projectionMode: mode }),

  toggleProjectionMode: () =>
    set((state) => ({
      projectionMode:
        state.projectionMode === "perspective" ? "orthographic" : "perspective",
    })),

  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),

  toggleWidgetVisibility: () =>
    set((state) => ({ widgetVisible: !state.widgetVisible })),

  toggleAxisVisibility: () =>
    set((state) => {
      const axisVisible = !state.axisVisible;
      saveSnapSettings({ ...state, axisVisible });
      return { axisVisible };
    }),

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
  setProjectsDialogOpen: (open) => set({ projectsDialogOpen: !!open }),
});
