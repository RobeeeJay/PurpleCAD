// Timeline entry EDITS: re-open a committed step (chamfer, push/pull, shell,
// hole, emboss, texture, draft, revolve, pipe, loft) and update it IN PLACE
// rather than appending a new step — the create+edit symmetry every output-
// producing tool follows.  Each of these rewrites the entry, relinks the
// source chain and forward-invalidates, so a later step never keeps building
// on the pre-edit geometry.  Split out of historySlice.js.

import {
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  withUndo,
  commitEntryEdit,
} from "./internals.js";
// Change a committed step's parameters from its timeline Edit: mark the
// regenerator dirty and clear its geometry so the regen orchestrator rebuilds
// it, then relink so later steps build on the edited result.  Shared by the
// ops whose edit is only a parameter change (push/pull, shell, simplify).
function withEditedParams(state, entryId, kind, params) {
  const newHistory = state.history.map((entry) => {
    if (entry.id !== entryId) return entry;
    const inst = entry.instruction;
    if (inst?.type !== "modify") return entry;
    const r = inst.patches?.regenerator;
    if (r?.kind !== kind) return entry;
    return {
      ...entry,
      instruction: {
        ...inst,
        patches: {
          ...inst.patches,
          regenerator: { ...r, ...params, regeneratedAt: "dirty" },
          geometryData: null,
        },
      },
    };
  });
  // Editing an upstream op must re-point downstream sources (an emboss on a
  // chamfer rebuilds against the edited chamfer, not its stale snapshot).
  const relinked = commitEntryEdit(newHistory, entryId);
  const activeIdx =
    state.activeHistoryId != null
      ? relinked.findIndex((h) => h.id === state.activeHistoryId)
      : relinked.length - 1;
  const items = replayUpTo(
    relinked,
    activeIdx !== -1 ? activeIdx : relinked.length - 1,
  );
  saveTimeline(relinked, state.activeHistoryId);
  return Object.assign(
    { items, history: withOrphanFlags(relinked) },
    withUndo(state),
  );
}

export const createHistoryEntryEditsSlice = (set) => ({
  // Update the amount / angleRad on an existing chamfer-or-fillet history
  // entry, then replay history so the regenerator reflects the new values.
  // `regeneratedAt` is reset (different from any valid printPrecision) and
  // `geometryData` is cleared so regenerateItemsForResolution's skip-check
  // misses, forcing a fresh tessellation with the new parameters.
  // Replace a committed chamfer/fillet entry's FULL payload in place — the
  // overlay Edit flow's commit (re-picked selection and/or new params, with the
  // freshly computed geometry).  Downstream sources relink; the entry itself
  // stays clean (its payload is fresh — see commitEntryEdit).
  updateChamferEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "chamfer") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches,
          },
        };
      });
      const relinked = commitEntryEdit(newHistory, entryId);
      // Editing views the PRE-chamfer step (beginChamferEdit) — land back on
      // the edited entry so the freshly committed result is what's on screen
      // (null = the tip, matching restoreToHistory's convention).
      const activeIdx = relinked.findIndex((h) => h.id === entryId);
      const newActive = activeIdx === relinked.length - 1 ? null : entryId;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, newActive);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
          activeHistoryId: newActive,
        },
        withUndo(state),
      );
    }),
  updateChamferParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "chamfer") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              regenerator: {
                ...r,
                ...params,
                regeneratedAt: "dirty",
              },
              geometryData: null,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
        },
        withUndo(state),
      );
    }),
  // Update the distance on an existing push/pull history entry, then replay so
  // the regenerator rebuilds with the new value.  Mirrors updateChamferParams:
  // `regeneratedAt` is reset and `geometryData` cleared so the skip-check in
  // regenerateItemsForResolution misses and re-tessellates.
  updatePushPullParams: (entryId, params) =>
    set((state) => withEditedParams(state, entryId, "pushpull", params)),
  // Edit a committed shell's wall thickness from its timeline step.
  updateShellParams: (entryId, params) =>
    set((state) => withEditedParams(state, entryId, "shell", params)),
  // Edit a committed simplify's deviation / triangle count from its timeline
  // step.
  updateSimplifyParams: (entryId, params) =>
    set((state) => withEditedParams(state, entryId, "simplify", params)),
  // Edit a committed conversion's tolerance from its timeline step.
  updateConvertParams: (entryId, params) =>
    set((state) => withEditedParams(state, entryId, "meshToSurfaces", params)),
  // Update a committed hole step in place with re-edited params (geometry
  // already rebuilt by commitHole).  `patch` = { hole, position, centerOffset,
  // geometryData, regeneratedAt }.
  updateHoleEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        const r = inst.patches?.regenerator;
        if (r?.kind !== "hole") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: {
                ...r,
                hole: patch.hole,
                centerOffset: patch.centerOffset,
                basePosition: patch.basePosition,
                regeneratedAt: patch.regeneratedAt,
              },
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  // Update a committed emboss step in place with re-edited params (geometry +
  // stamp already rebuilt by commitEmboss).  `patch` = { regenerator, position,
  // geometryData }.
  updateEmbossEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "emboss") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: patch.regenerator,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      // Editing views the PRE-emboss step (beginEmbossEdit) — land back on the
      // edited entry so the freshly committed result is what's on screen (null
      // = the tip, matching restoreToHistory's convention).
      const activeIdx = relinked.findIndex((h) => h.id === entryId);
      const newActive = activeIdx === relinked.length - 1 ? null : entryId;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, newActive);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
          activeHistoryId: newActive,
        },
        withUndo(state),
      );
    }),
  // Replace a committed texture entry's payload in place — the tool's edit
  // commit.  Mirrors updateEmbossEntry.
  updateTextureEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "texture") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: patch.regenerator,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      // Editing views the PRE-texture step (beginTextureEdit) — land back on the
      // edited entry so the freshly committed result is what's on screen (null
      // = the tip, matching restoreToHistory's convention).
      const activeIdx = relinked.findIndex((h) => h.id === entryId);
      const newActive = activeIdx === relinked.length - 1 ? null : entryId;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, newActive);
      return Object.assign(
        {
          items,
          history: withOrphanFlags(relinked),
          activeHistoryId: newActive,
        },
        withUndo(state),
      );
    }),
  // Edit a committed draft step in place (angle/flip/faces changed, geometry
  // already rebuilt).  Mirrors updateEmbossEntry.
  updateDraftEntry: (entryId, patch) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "draft") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            patches: {
              ...inst.patches,
              position: patch.position,
              geometryData: patch.geometryData,
              regenerator: patch.regenerator,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  // Update an existing push/pull history entry's patches in place — used by
  // PushPullOverlay's retarget confirm (geometry already rebuilt against the
  // new face selection).
  retargetPushPullEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "modify") return entry;
        if (inst.patches?.regenerator?.kind !== "pushpull") return entry;
        return { ...entry, instruction: { ...inst, patches } };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  // Update a revolve (sweep) step's parameters.  A revolve is a CREATE entry
  // (it adds a new solid), so its recipe lives on inst.item, not inst.patches.
  updateRevolveParams: (entryId, params) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        const r = inst.item?.regenerator;
        if (r?.kind !== "revolve") return entry;
        return {
          ...entry,
          instruction: {
            ...inst,
            item: {
              ...inst.item,
              regenerator: { ...r, ...params, regeneratedAt: "dirty" },
              geometryData: null,
            },
          },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  // Replace a revolve step's item recipe in place (re-picked profile/axis) —
  // used by the sweep retarget confirm.  `patches` carries the new regenerator,
  // geometryData and position to merge onto the CREATE entry's item.
  retargetRevolveEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "revolve") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  // Pipe and loft are CREATE entries like revolve, but with no editable
  // parameters — only re-picking their inputs.  Mirrors retargetRevolveEntry.
  retargetPipeEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "pipe") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
  retargetLoftEntry: (entryId, patches) =>
    set((state) => {
      const newHistory = state.history.map((entry) => {
        if (entry.id !== entryId) return entry;
        const inst = entry.instruction;
        if (inst?.type !== "create") return entry;
        if (inst.item?.regenerator?.kind !== "loft") return entry;
        return {
          ...entry,
          instruction: { ...inst, item: { ...inst.item, ...patches } },
        };
      });
      // Editing an upstream op must re-point downstream sources (an emboss on a
      // chamfer rebuilds against the edited chamfer, not its stale snapshot).
      const relinked = commitEntryEdit(newHistory, entryId);
      const activeIdx =
        state.activeHistoryId != null
          ? relinked.findIndex((h) => h.id === state.activeHistoryId)
          : relinked.length - 1;
      const items = replayUpTo(
        relinked,
        activeIdx !== -1 ? activeIdx : relinked.length - 1,
      );
      saveTimeline(relinked, state.activeHistoryId);
      return Object.assign(
        { items, history: withOrphanFlags(relinked) },
        withUndo(state),
      );
    }),
});
