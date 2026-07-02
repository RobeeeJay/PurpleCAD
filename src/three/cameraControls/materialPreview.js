// Live preview for MaterialDialog: mutates already-built mesh materials
// in place (via applyMaterialToMesh) so color/finish edits show instantly,
// without going through the store/rebuild pipeline. `target` is either
// "default" (every item without its own item.material override) or an
// item id (that item only).

import { useStore } from "../../store";
import { applyMaterialToMesh } from "../objectMaterials.js";

// A pattern/mirror clone of `sourceId` — inherits that object's material, so a
// preview of the source must also re-skin the clone.
const tracksSource = (item, sourceId) =>
  item.regenerator?.kind === "pattern3d" &&
  item.regenerator.sourceId === sourceId;

// Does this item render with the DEFAULT material? (no own material, and — for a
// clone — its source has no own material either, so it falls through to default).
const usesDefault = (item, items) => {
  if (item.material) return false;
  if (item.regenerator?.kind === "pattern3d") {
    const src = items.find((i) => i.id === item.regenerator.sourceId);
    if (src?.material) return false;
  }
  return true;
};

export function createMaterialPreviewHelpers({ objectsRef, itemsRef }) {
  const previewMaterial = (target, materialProps) => {
    const items = itemsRef.current;
    if (target === "default") {
      items.forEach((item) => {
        if (!usesDefault(item, items)) return;
        const mesh = objectsRef.current[item.id];
        if (mesh) applyMaterialToMesh(mesh, item, materialProps);
      });
      return;
    }
    // The edited item plus every clone tracking it (so mirrors/patterns update
    // live as the source's material is dragged).
    items.forEach((item) => {
      if (item.id !== target && !tracksSource(item, target)) return;
      const mesh = objectsRef.current[item.id];
      if (mesh) applyMaterialToMesh(mesh, item, materialProps);
    });
  };

  // Re-applies the committed values, undoing an in-progress preview (Cancel).
  const restoreMaterialPreview = (target) => {
    const { defaultMaterial } = useStore.getState();
    const items = itemsRef.current;
    if (target === "default") {
      items.forEach((item) => {
        if (!usesDefault(item, items)) return;
        const mesh = objectsRef.current[item.id];
        if (mesh) applyMaterialToMesh(mesh, item, defaultMaterial);
      });
      return;
    }
    const committed =
      items.find((i) => i.id === target)?.material ?? defaultMaterial;
    items.forEach((item) => {
      if (item.id !== target && !tracksSource(item, target)) return;
      const mesh = objectsRef.current[item.id];
      if (mesh) applyMaterialToMesh(mesh, item, committed);
    });
  };

  return { previewMaterial, restoreMaterialPreview };
}
