// applyHiddenSelectionVisibility: a hidden object reveals at 25% opacity while
// selected, and hides again when unselected.

import { describe, it, expect } from "vitest";
import {
  applyHiddenSelectionVisibility,
  finalizeVisibility,
} from "../objectMaterials.js";

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

describe("finalizeVisibility (solo)", () => {
  const setup = () => {
    const meshes = { 1: mkMesh(1), 2: mkMesh(2), 3: mkMesh(3) };
    meshes[1].visible = true;
    meshes[2].visible = true;
    meshes[3].visible = false; // a hidden item
    return {
      objectsRef: { current: meshes },
      itemsRef: {
        current: [
          { id: 1, visible: true, type: "csg" },
          { id: 2, visible: true, type: "csg" },
          { id: 3, visible: false, type: "csg" },
        ],
      },
      meshes,
    };
  };

  it("shows only the soloed item (even if hidden) and hides the rest", () => {
    const { objectsRef, itemsRef, meshes } = setup();
    finalizeVisibility(objectsRef, itemsRef, [], 3);
    expect(meshes[3].visible).toBe(true); // soloed, despite being hidden
    expect(meshes[1].visible).toBe(false);
    expect(meshes[2].visible).toBe(false);
  });

  it("falls back to normal visibility when no item is soloed", () => {
    const { objectsRef, itemsRef, meshes } = setup();
    finalizeVisibility(objectsRef, itemsRef, [], null);
    // Non-solo: the hidden-selection pass only touches hidden items.
    expect(meshes[3].visible).toBe(false);
  });

  it("ignores a stale solo id whose mesh is gone (scene not left blank)", () => {
    const { objectsRef, itemsRef, meshes } = setup();
    finalizeVisibility(objectsRef, itemsRef, [], 99);
    // No mesh matches 99 → behaves like non-solo, visible items stay visible.
    expect(meshes[1].visible).toBe(true);
    expect(meshes[2].visible).toBe(true);
  });
});
