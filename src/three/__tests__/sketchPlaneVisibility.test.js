// The sketch reference plane is hidden in the 3D view and revealed only on
// objects-list hover (or while it's the active drawing surface in sketch mode).

import { describe, it, expect } from "vitest";
import { updateSketchPlaneVisibility } from "../objectMaterials.js";

const mkScene = (items) => {
  const objectsRef = { current: {} };
  items.forEach((it) => {
    objectsRef.current[it.id] = { visible: true, userData: { itemId: it.id } };
  });
  const itemsRef = { current: items };
  return { objectsRef, itemsRef };
};

describe("updateSketchPlaneVisibility", () => {
  const sketch = { id: 1, type: "sketch", visible: true };
  const box = { id: 2, type: "cube", visible: true };

  it("hides the sketch plane when nothing is hovered", () => {
    const { objectsRef, itemsRef } = mkScene([sketch, box]);
    updateSketchPlaneVisibility(objectsRef, itemsRef, null, false, null);
    expect(objectsRef.current[1].visible).toBe(false);
  });

  it("reveals the sketch plane while it is hovered", () => {
    const { objectsRef, itemsRef } = mkScene([sketch, box]);
    updateSketchPlaneVisibility(objectsRef, itemsRef, 1, false, null);
    expect(objectsRef.current[1].visible).toBe(true);
  });

  it("keeps the active sketch visible in sketch mode without hover", () => {
    const { objectsRef, itemsRef } = mkScene([sketch, box]);
    updateSketchPlaneVisibility(objectsRef, itemsRef, null, true, 1);
    expect(objectsRef.current[1].visible).toBe(true);
  });

  it("never shows a sketch the user has hidden, even on hover", () => {
    const hidden = { id: 1, type: "sketch", visible: false };
    const { objectsRef, itemsRef } = mkScene([hidden]);
    updateSketchPlaneVisibility(objectsRef, itemsRef, 1, false, null);
    expect(objectsRef.current[1].visible).toBe(false);
  });

  it("leaves non-sketch meshes untouched", () => {
    const { objectsRef, itemsRef } = mkScene([sketch, box]);
    objectsRef.current[2].visible = true;
    updateSketchPlaneVisibility(objectsRef, itemsRef, 1, false, null);
    expect(objectsRef.current[2].visible).toBe(true);
  });
});
