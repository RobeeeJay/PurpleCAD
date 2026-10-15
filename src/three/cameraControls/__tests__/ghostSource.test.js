// Ghosting the body under a tool preview.  It must put every material setting
// back exactly, and flag the mesh so the render-mode sync leaves it alone --
// four of the six previews that carried their own copy didn't, so a render-
// mode pass mid-preview popped the body back opaque over the preview.
import { describe, it, expect } from "vitest";
import { createGhost } from "../ghostSource.js";

const body = (material) => ({
  material,
  children: [{ visible: true }, { visible: false }],
  userData: {},
});

describe("createGhost", () => {
  it("fades the body, flags it, and restores it exactly", () => {
    const mesh = body({ opacity: 0.8, transparent: false, depthWrite: true });
    const { ghost, unghost } = createGhost({ current: { 7: mesh } });
    ghost(7);
    expect(mesh.material).toMatchObject({
      opacity: 0.12,
      transparent: true,
      depthWrite: false,
    });
    expect(mesh.children.map((c) => c.visible)).toEqual([false, false]);
    expect(mesh.userData.ghosted, "flag for the render-mode sync").toBe(true);

    unghost();
    expect(mesh.material).toMatchObject({
      opacity: 0.8,
      transparent: false,
      depthWrite: true,
    });
    expect(mesh.children.map((c) => c.visible)).toEqual([true, false]);
    expect(mesh.userData.ghosted).toBeUndefined();
  });

  it("fades a shader material through its opacity uniform", () => {
    const mesh = body({
      opacity: 1,
      transparent: false,
      depthWrite: true,
      uniforms: { uOpacity: { value: 0.9 } },
    });
    const { ghost, unghost } = createGhost({ current: { 3: mesh } });
    ghost(3);
    expect(mesh.material.uniforms.uOpacity.value).toBe(0.12);
    expect(mesh.material.opacity).toBe(1);
    unghost();
    expect(mesh.material.uniforms.uOpacity.value).toBe(0.9);
  });

  it("restores the first body when a second is ghosted", () => {
    const a = body({ opacity: 1, transparent: false, depthWrite: true });
    const b = body({ opacity: 1, transparent: false, depthWrite: true });
    const { ghost } = createGhost({ current: { 1: a, 2: b } });
    ghost(1);
    ghost(2);
    expect(a.material.opacity).toBe(1);
    expect(a.userData.ghosted).toBeUndefined();
    expect(b.userData.ghosted).toBe(true);
  });
});
