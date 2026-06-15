// applyHiddenSelectionVisibility: a hidden object reveals at 25% opacity while
// selected, and hides again when unselected.

import { describe, it, expect } from "vitest";
import { applyHiddenSelectionVisibility } from "../objectMaterials.js";

const mkMesh = (id) => ({
  userData: { itemId: id },
  visible: false,
  material: {
    opacity: 1,
    transparent: false,
    depthWrite: true,
    needsUpdate: false,
  },
});

describe("applyHiddenSelectionVisibility", () => {
  it("reveals a hidden selected object at 25% opacity, hides when unselected", () => {
    const meshes = { 1: mkMesh(1), 2: mkMesh(2) };
    const objectsRef = { current: meshes };
    const itemsRef = {
      current: [
        { id: 1, visible: false, type: "csg" },
        { id: 2, visible: false, type: "csg" },
      ],
    };

    applyHiddenSelectionVisibility(objectsRef, itemsRef, [1]);
    expect(meshes[1].visible).toBe(true);
    expect(meshes[1].material.opacity).toBe(0.25);
    expect(meshes[1].material.transparent).toBe(true);
    expect(meshes[2].visible).toBe(false);

    applyHiddenSelectionVisibility(objectsRef, itemsRef, []);
    expect(meshes[1].visible).toBe(false);
  });

  it("leaves visible objects and sketches untouched", () => {
    const meshes = { 1: mkMesh(1), 2: mkMesh(2) };
    meshes[1].visible = true; // a visible object
    const objectsRef = { current: meshes };
    const itemsRef = {
      current: [
        { id: 1, visible: true, type: "csg" },
        { id: 2, visible: false, type: "sketch" }, // hidden sketch
      ],
    };

    applyHiddenSelectionVisibility(objectsRef, itemsRef, [1, 2]);
    expect(meshes[1].visible).toBe(true);
    expect(meshes[1].material.opacity).toBe(1);
    expect(meshes[2].visible).toBe(false); // sketch skipped
  });
});
