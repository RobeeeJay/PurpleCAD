// Shared material defaults + built-in presets for the Material toolbar.
// `defaultMaterial` (persisted, store/internals.js) seeds new objects;
// per-item overrides live at item.material with this same shape.

export const DEFAULT_MATERIAL = {
  color: "#cccccc",
  metalness: 0.3,
  roughness: 0.5,
  opacity: 1,
  clearcoat: 0,
  clearcoatRoughness: 0,
};

// Built-in starting points shown alongside any user-saved presets in the
// Material dialog.  Not persisted/editable — "Save as preset" adds new
// entries to the user's own list instead.
export const BUILTIN_MATERIAL_PRESETS = [
  { name: "Default", material: { ...DEFAULT_MATERIAL } },
  {
    name: "Matte",
    material: {
      color: "#cccccc",
      metalness: 0,
      roughness: 1,
      opacity: 1,
      clearcoat: 0,
      clearcoatRoughness: 0,
    },
  },
  {
    name: "Glossy Plastic",
    material: {
      color: "#cccccc",
      metalness: 0,
      roughness: 0.2,
      opacity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    },
  },
  {
    name: "Metal",
    material: {
      color: "#c0c0c0",
      metalness: 1,
      roughness: 0.25,
      opacity: 1,
      clearcoat: 0,
      clearcoatRoughness: 0,
    },
  },
  {
    name: "Glass",
    material: {
      color: "#cceeff",
      metalness: 0,
      roughness: 0.05,
      opacity: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0,
    },
  },
  {
    name: "Rubber",
    material: {
      color: "#333333",
      metalness: 0,
      roughness: 0.9,
      opacity: 1,
      clearcoat: 0,
      clearcoatRoughness: 0,
    },
  },
];
