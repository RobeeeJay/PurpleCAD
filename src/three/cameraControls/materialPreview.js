// Live preview for MaterialDialog: mutates already-built mesh materials
// in place (via applyMaterialToMesh) so color/finish edits show instantly,
// without going through the store/rebuild pipeline. `target` is either
// "default" (every item without its own item.material override) or an
// item id (that item only).

import { useStore } from "../../store";
import { applyMaterialToMesh } from "../objectMaterials.js";

export function createMaterialPreviewHelpers({ objectsRef, itemsRef }) {
  const previewMaterial = (target, materialProps) => {
    const items = itemsRef.current;
    if (target === "default") {
      items.forEach((item) => {
        if (item.material) return;
        const mesh = objectsRef.current[item.id];
        if (mesh) applyMaterialToMesh(mesh, item, materialProps);
      });
      return;
    }
    const item = items.find((i) => i.id === target);
    const mesh = objectsRef.current[target];
    if (item && mesh) applyMaterialToMesh(mesh, item, materialProps);
  };

  // Re-applies the committed values, undoing an in-progress preview (Cancel).
  const restoreMaterialPreview = (target) => {
    const { defaultMaterial } = useStore.getState();
    const items = itemsRef.current;
    if (target === "default") {
      items.forEach((item) => {
        if (item.material) return;
        const mesh = objectsRef.current[item.id];
        if (mesh) applyMaterialToMesh(mesh, item, defaultMaterial);
      });
      return;
    }
    const item = items.find((i) => i.id === target);
    const mesh = objectsRef.current[target];
    if (item && mesh)
      applyMaterialToMesh(mesh, item, item.material ?? defaultMaterial);
  };

  return { previewMaterial, restoreMaterialPreview };
}
