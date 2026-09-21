// Phase machines for the 3D Modify tools -- chamfer, push/pull, shell,
// origin, hole, emboss, texture and draft.  Each holds the in-progress
// picks/params for one tool's overlay bar; Confirm reads them and writes a
// timeline entry, Cancel/Esc drops them.  Split out of uiSlice.js because
// they share nothing with the view/selection state beyond living on the
// same store.

import { TOOL_RESET_PATCH } from "./uiToolReset.js";

export const createUiModifyToolsSlice = (set, get) => ({
  setChamferEditTarget: (target) => set({ chamferEditTarget: target }),
  // Why the live chamfer/fillet preview couldn't be built at the current
  // values -- shown in the dialog, so a too-big distance says so at once
  // instead of only after Confirm.
  chamferPreviewError: null,
  setChamferPreviewError: (message) => set({ chamferPreviewError: message }),
  // Setting either face-select mode clears the other — only one pick/confirm
  // overlay can be active at a time.
  setChamferSelectMode: (mode) =>
    set((s) => {
      const own = {
        chamferSelectMode: mode,
        chamferPreviewError: null,
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

  setToolError: (msg) => set({ toolError: msg || null }),

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
  // Editing views the pre-emboss step (beginEmbossEdit) — a plain cancel puts
  // the user back on the entry.  After a commit, updateEmbossEntry has already
  // landed there (active is the entry or null at the tip), so no restore.
  cancelEmbossTool: () => {
    const { embossTool, activeHistoryId, restoreToHistory } = get();
    if (
      embossTool?.editEntryId != null &&
      activeHistoryId != null &&
      activeHistoryId !== embossTool.editEntryId
    )
      restoreToHistory(embossTool.editEntryId);
    set({ embossTool: null });
  },
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
          faceCount: sel.faceCount ?? 0,
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
  // Re-open a committed emboss step to edit its params, replaying the frozen
  // recipe.  The timeline is restored to the PREVIOUS step so the pre-emboss
  // body is on screen: re-picking a face must happen against the source the op
  // re-runs on — the same state the user picked at creation, in the same local
  // frame — not the relief-carrying result mesh.
  beginEmbossEdit: (entryId) => {
    const state = get();
    const idx = state.history.findIndex((h) => h.id === entryId);
    const entry = state.history[idx];
    const r = entry?.instruction?.patches?.regenerator;
    if (idx < 1 || r?.kind !== "emboss") return;
    state.restoreToHistory(state.history[idx - 1].id);
    set({
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
    });
  },

  startTextureTool: () =>
    set({
      ...TOOL_RESET_PATCH,
      textureTool: {
        picking: "faces",
        itemId: null,
        face: null,
        faceSet: null,
        faceTris: null,
        faceCount: 0,
        facesValid: false,
        params: {
          png: null,
          pngName: null,
          projection: "center",
          offsetHMm: 0,
          offsetVMm: 0,
          rotationDeg: 0,
          sizeMm: 10,
          depthMm: 1,
          resolutionMm: 1,
          wrap: false,
        },
      },
    }),
  // Editing views the pre-texture step (beginTextureEdit) — a plain cancel
  // puts the user back on the entry; after a commit the update already landed.
  cancelTextureTool: () => {
    const { textureTool, activeHistoryId, restoreToHistory } = get();
    if (
      textureTool?.editEntryId != null &&
      activeHistoryId != null &&
      activeHistoryId !== textureTool.editEntryId
    )
      restoreToHistory(textureTool.editEntryId);
    set({ textureTool: null });
  },
  setTextureLibraryOpen: (open) => set({ textureLibraryOpen: open }),
  setTexturePicking: (kind) =>
    set((s) =>
      s.textureTool
        ? {
            textureTool: {
              ...s.textureTool,
              picking: s.textureTool.picking === kind ? null : kind,
            },
          }
        : {},
    ),
  // Same selection shape the emboss face pick produces; a curved pick nudges
  // the still-default "center" projection to "conform" (same rationale).
  setTextureFaceSelection: (sel) =>
    set((s) => {
      if (!s.textureTool) return {};
      const params =
        sel.faceSet && s.textureTool.params.projection === "center"
          ? { ...s.textureTool.params, projection: "conform" }
          : s.textureTool.params;
      return {
        textureTool: {
          ...s.textureTool,
          itemId: sel.itemId,
          face: sel.face,
          faceSet: sel.faceSet,
          faceTris: sel.faceTris ?? null,
          faceCount: sel.faceCount ?? 0,
          facesValid: !!sel.valid,
          picking: sel.keepPicking ? s.textureTool.picking : null,
          params,
        },
      };
    }),
  updateTextureParams: (partial) =>
    set((s) =>
      s.textureTool
        ? {
            textureTool: {
              ...s.textureTool,
              params: { ...s.textureTool.params, ...partial },
            },
          }
        : {},
    ),
  // Re-open a committed texture step for editing.  The timeline is restored to
  // the PREVIOUS step so the pre-texture body is on screen: re-picking faces
  // must happen against the source the op re-runs on, in its frame.
  beginTextureEdit: (entryId) => {
    const state = get();
    const idx = state.history.findIndex((h) => h.id === entryId);
    const entry = state.history[idx];
    const r = entry?.instruction?.patches?.regenerator;
    if (idx < 1 || r?.kind !== "texture") return;
    state.restoreToHistory(state.history[idx - 1].id);
    set({
      textureTool: {
        picking: null,
        editEntryId: entryId,
        itemId: entry.itemId,
        source: r.source,
        face: r.face,
        faceSet: r.faceSet || null,
        faceTris: r.faceTris || null,
        faceCount: r.faceCount ?? 0,
        facesValid: true,
        params: { ...r.params },
      },
    });
  },

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
});
