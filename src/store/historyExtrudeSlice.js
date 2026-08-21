// Extrude-specific timeline mutations: retargeting an extrude (or a whole
// multi-area group, or a fused extrudeUnion/extrudeCut body) onto a different
// profile set, and editing depths.  These are separated from the generic entry
// edits because they rewrite the prism RECIPES embedded in a fused body's
// regenerator, not just an entry's params.  Split out of historySlice.js.

import {
  replayUpTo,
  withOrphanFlags,
  saveTimeline,
  withUndo,
  markCsgDirty,
  rewriteCreatedItem,
  dirtyAllEntries,
  maxItemId,
} from "./internals.js";
import {
  buildBrushTransform,
  shiftUnionAnchorForRetarget,
} from "../three/csgUtils.js";
export const createHistoryExtrudeSlice = (set) => ({
  retargetExtrude: (extrudeId, newProfile, newDepth, startOffset = 0) =>
    set((state) => {
      const apply = (item) =>
        Object.assign({}, item, {
          profile: newProfile,
          depth: newDepth,
          // A zero offset is the default; persist it so retargeting can also
          // clear a previously-set start offset.
          startOffset: startOffset || undefined,
          position: newProfile.position,
          rotation: newProfile.rotation,
        });
      // If this prism anchors a union (it's `inputIds[0]` of a boolean
      // regenerator), the union's re-localisation anchor must move with it —
      // see shiftUnionAnchorForRetarget.
      const oldExtrude = state.items.find((item) => item.id === extrudeId);
      const delta =
        oldExtrude?.type === "extrude"
          ? (() => {
              const before = buildBrushTransform(oldExtrude).position;
              const after = buildBrushTransform(apply(oldExtrude)).position;
              return {
                x: after.x - before.x,
                y: after.y - before.y,
                z: after.z - before.z,
              };
            })()
          : null;
      const shiftAnchors = (item) =>
        delta ? shiftUnionAnchorForRetarget(item, extrudeId, delta) : item;
      // markCsgDirty: a retargeted prism may feed a union (a boss, or one of a
      // multi-area extrude's prisms), which must rebuild against the new profile.
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          item.id === extrudeId ? apply(item) : shiftAnchors(item),
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) => {
          const rewritten = rewriteCreatedItem(entry, extrudeId, apply);
          if (rewritten !== entry) return rewritten;
          const inst = entry.instruction;
          if (inst?.type === "create" && inst.item?.regenerator) {
            const next = shiftAnchors(inst.item);
            if (next !== inst.item)
              return { ...entry, instruction: { ...inst, item: next } };
          }
          if (inst?.type === "modify" && inst.patches?.regenerator) {
            const next = shiftAnchors(inst.patches);
            if (next !== inst.patches)
              return { ...entry, instruction: { ...inst, patches: next } };
          }
          return entry;
        }),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),
  // Edit an extrude's depth in place: rewrite its CREATE entry rather than
  // appending a "Modified" step, and dirty downstream CSG so the regen pass
  // recalculates the timeline at the new depth (mirrors how setVariables
  // edits a sketch's create entry).
  setExtrudeDepth: (id, depth) =>
    set((state) => {
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          item.id === id ? Object.assign({}, item, { depth }) : item,
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) =>
          rewriteCreatedItem(entry, id, (item) =>
            Object.assign({}, item, { depth }),
          ),
        ),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),
  // Set ONE distance on every prism of a multi-area extrude group at once —
  // the group is resized as a unit, not per-prism.
  setExtrudeGroupDepth: (ids, depth) =>
    set((state) => {
      const idSet = new Set(ids);
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          idSet.has(item.id) ? Object.assign({}, item, { depth }) : item,
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) => {
          const inst = entry.instruction;
          if (
            inst?.type === "createGroup" &&
            inst.items?.some((it) => idSet.has(it.id))
          ) {
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                items: inst.items.map((it) =>
                  idSet.has(it.id) ? Object.assign({}, it, { depth }) : it,
                ),
              }),
            });
          }
          return entry;
        }),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),
  // Retarget a whole multi-area extrude group to a new set of profiles.  The
  // group's createGroup step is rebuilt to one prism per new profile (reusing
  // the old prism ids where possible, allocating fresh ones for added regions),
  // and the downstream union's inputIds are swapped to the new prisms (host
  // solids in its inputs are kept).  Marking it dirty makes the regen pass
  // rebuild the fused body.  Replaying the rewritten history reconciles
  // added/removed prisms in the live scene without leaving orphans.
  retargetGroup: (oldPrismIds, newProfiles, depth, startOffset = 0) =>
    set((state) => {
      const oldSet = new Set(oldPrismIds);
      let maxId = maxItemId(state.history);
      const newPrisms = newProfiles.map((profile, i) => {
        const id = i < oldPrismIds.length ? oldPrismIds[i] : ++maxId;
        return {
          id,
          name: `Extrude ${id}`,
          type: "extrude",
          children: [],
          parentId: null,
          profile,
          depth,
          ...(startOffset ? { startOffset } : null),
          position: profile.position,
          rotation: profile.rotation,
          scale: { x: 1, y: 1, z: 1 },
        };
      });
      const newIds = newPrisms.map((p) => p.id);
      // Swap the dropped prism ids for the kept set inside ANY boolean inputIds
      // reachable from a regenerator — the union itself, but also the boolean
      // buried in a chamfer / fillet's frozen `source` snapshot (and chained
      // chamfers, which nest source-within-source).  Without this a chamfer on
      // the union rebuilds its source at the OLD region count and keeps showing
      // the dropped region.  Returns the same ref when nothing changed.
      const rewriteRegen = (regen) => {
        if (!regen) return regen;
        let next = regen;
        if (
          regen.kind === "boolean" &&
          (regen.inputIds || []).some((id) => oldSet.has(id))
        ) {
          const hosts = (regen.inputIds || []).filter((id) => !oldSet.has(id));
          next = {
            ...next,
            inputIds: [...newIds, ...hosts],
            regeneratedAt: "dirty",
          };
        }
        if (next.source?.regenerator) {
          const srcRegen = rewriteRegen(next.source.regenerator);
          if (srcRegen !== next.source.regenerator) {
            next = {
              ...next,
              source: { ...next.source, regenerator: srcRegen },
              regeneratedAt: "dirty",
            };
          }
        }
        return next;
      };
      const newHistory = state.history.map((entry) => {
        const inst = entry.instruction;
        if (
          inst?.type === "createGroup" &&
          inst.items?.some((it) => oldSet.has(it.id))
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, inst, { items: newPrisms }),
          });
        }
        if (inst?.type === "create" && inst.item?.regenerator) {
          const nr = rewriteRegen(inst.item.regenerator);
          if (nr !== inst.item.regenerator)
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                item: Object.assign({}, inst.item, { regenerator: nr }),
              }),
            });
        }
        if (inst?.type === "modify" && inst.patches?.regenerator) {
          const nr = rewriteRegen(inst.patches.regenerator);
          if (nr !== inst.patches.regenerator)
            return Object.assign({}, entry, {
              instruction: Object.assign({}, inst, {
                patches: Object.assign({}, inst.patches, { regenerator: nr }),
              }),
            });
        }
        return entry;
      });
      // Old prism ids may appear in later entries' hiddenIds (the union step
      // onward, since the union consumes them) — swap them for the new ids
      // so the retargeted prisms stay hidden from the same step.
      const finalHistory = newHistory.map((entry) => {
        const hidden = entry.hiddenIds || [];
        if (!hidden.some((id) => oldSet.has(id))) return entry;
        const kept = hidden.filter((id) => !oldSet.has(id));
        return { ...entry, hiddenIds: [...new Set([...kept, ...newIds])] };
      });
      const dirtied = dirtyAllEntries(finalHistory);
      const activeIdx =
        state.activeHistoryId !== null
          ? dirtied.findIndex((h) => h.id === state.activeHistoryId)
          : dirtied.length - 1;
      const items = markCsgDirty(replayUpTo(dirtied, activeIdx));
      saveTimeline(dirtied, state.activeHistoryId);
      return {
        ...withUndo(state),
        items,
        history: withOrphanFlags(dirtied),
      };
    }),
  // Edit a FUSED extrude (extrudeUnion / extrudeCut csg item) in place: rebuild
  // its embedded prism recipes (regenerator.extrudeDefs) from a new set of
  // profiles + depth, keeping the same csg item and timeline entry.  Unlike
  // retargetGroup the prisms aren't store items, so there are no createGroup /
  // hiddenId / inputId swaps — just rewrite the defs and dirty downstream.
  retargetFusedExtrude: (itemId, newProfiles, depth, startOffset = 0) =>
    set((state) => {
      const target = state.items.find((i) => i.id === itemId);
      const oldRegen = target?.regenerator;
      if (!oldRegen?.extrudeDefs?.length) return {};
      const isCut = oldRegen.kind === "extrudeCut";
      const oldDefs = oldRegen.extrudeDefs;
      // Reuse the old defs' ids where the count matches; allocate fresh ids for
      // any added profiles so downstream references stay stable.
      let maxId = maxItemId(state.history);
      const newDefs = newProfiles.map((profile, i) => {
        const id = i < oldDefs.length ? oldDefs[i].id : ++maxId;
        return {
          id,
          name: `${isCut ? "Extrude Cut" : "Extrude"} ${id}`,
          type: "extrude",
          children: [],
          profile,
          depth,
          ...(startOffset ? { startOffset } : null),
          ...(isCut ? { isCut: true } : null),
          position: profile.position,
          rotation: profile.rotation,
          scale: { x: 1, y: 1, z: 1 },
        };
      });
      const setDefs = (regen) => ({
        ...regen,
        extrudeDefs: newDefs,
        regeneratedAt: "dirty",
      });
      const updatedItems = markCsgDirty(
        state.items.map((item) =>
          item.id === itemId
            ? { ...item, regenerator: setDefs(item.regenerator) }
            : item,
        ),
      );
      const newHistory = dirtyAllEntries(
        state.history.map((entry) => {
          const inst = entry.instruction;
          if (
            inst?.type === "create" &&
            inst.item?.id === itemId &&
            inst.item.regenerator?.extrudeDefs
          )
            return {
              ...entry,
              instruction: {
                ...inst,
                item: {
                  ...inst.item,
                  regenerator: setDefs(inst.item.regenerator),
                },
              },
            };
          return entry;
        }),
      );
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        ...withUndo(state),
        items: updatedItems,
        history: withOrphanFlags(newHistory),
      };
    }),
});
