// Default material (applied to newly-created objects, persisted) + the
// Material dialog's target/presets. Per-object overrides live on
// item.material as a permanent property — editing one rewrites the item's
// create entry in place rather than adding a timeline step (mirrors
// reparentItem), so material is not a versioned operation in the history.

import { DEFAULT_MATERIAL } from "../three/materialPresets.js";
import {
  loadMaterialSettings,
  saveMaterialSettings,
  withOrphanFlags,
  saveTimeline,
} from "./internals.js";

const persistedMaterial = loadMaterialSettings();

export const materialInitial = {
  defaultMaterial: persistedMaterial.defaultMaterial ?? {
    ...DEFAULT_MATERIAL,
  },
  materialPresets: persistedMaterial.materialPresets,

  // null | "default" | itemId — drives MaterialDialog's target + mode.
  materialDialogTarget: null,
};

let nextPresetId = 1;

export const createMaterialSlice = (set) => ({
  setMaterialDialogTarget: (target) => set({ materialDialogTarget: target }),

  setDefaultMaterial: (material) =>
    set((state) => {
      saveMaterialSettings(material, state.materialPresets);
      return { defaultMaterial: material };
    }),

  // Material is a permanent feature of the object, not a timeline operation:
  // update the live item and bake it into the entry that created the item
  // (create or createGroup) so it survives replay/reload — no new history
  // entry, no cursor move.
  setItemMaterial: (id, material) =>
    set((state) => {
      const items = state.items.map((i) =>
        i.id === id ? Object.assign({}, i, { material }) : i,
      );
      const history = state.history.map((entry) => {
        const inst = entry.instruction;
        if (inst?.type === "create" && inst.item?.id === id) {
          return {
            ...entry,
            instruction: { ...inst, item: { ...inst.item, material } },
          };
        }
        if (
          inst?.type === "createGroup" &&
          inst.items?.some((it) => it.id === id)
        ) {
          return {
            ...entry,
            instruction: {
              ...inst,
              items: inst.items.map((it) =>
                it.id === id ? { ...it, material } : it,
              ),
            },
          };
        }
        return entry;
      });
      saveTimeline(history, state.activeHistoryId);
      return { items, history: withOrphanFlags(history) };
    }),

  addMaterialPreset: (name, material) =>
    set((state) => {
      const presets = [
        ...state.materialPresets,
        { id: `preset-${nextPresetId++}`, name, material: { ...material } },
      ];
      saveMaterialSettings(state.defaultMaterial, presets);
      return { materialPresets: presets };
    }),

  removeMaterialPreset: (id) =>
    set((state) => {
      const presets = state.materialPresets.filter((p) => p.id !== id);
      saveMaterialSettings(state.defaultMaterial, presets);
      return { materialPresets: presets };
    }),
});
