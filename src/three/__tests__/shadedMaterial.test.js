// The raster views (shaded, transparent, wireframe) draw a body from its colour
// and transparency alone.  Metalness, roughness, clearcoat and specular are for
// the path-traced render only, so two bodies of one colour look alike in the
// working views however different their finishes.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark" }) },
}));

import {
  CONE_FRAGMENT_SHADER,
  CYLINDER_FRAGMENT_SHADER,
  SPHERE_FRAGMENT_SHADER,
  TORUS_FRAGMENT_SHADER,
  applyMaterialToMesh,
  createMaterial,
  shadedMaterial,
} from "../objectMaterials.js";

const FINISH = [
  "metalness",
  "roughness",
  "clearcoat",
  "clearcoatRoughness",
  "specularIntensity",
  "shininess",
];
const finishOf = (m) => FINISH.filter((k) => k in m);

const chrome = {
  color: "#cc3344",
  metalness: 1,
  roughness: 0.02,
  clearcoat: 1,
  clearcoatRoughness: 0,
  opacity: 1,
};
const rubber = { ...chrome, metalness: 0, roughness: 1, clearcoat: 0 };

describe("a body in the raster views", () => {
  it("is drawn from its colour alone, whatever its finish", () => {
    const shiny = createMaterial({ type: "cube" }, "#cc3344", chrome);
    const matt = createMaterial({ type: "csg" }, "#cc3344", rubber);
    for (const m of [shiny, matt]) {
      expect(m.type).toBe("MeshLambertMaterial");
      expect(finishOf(m)).toEqual([]);
      expect(m.color.getHexString()).toBe("cc3344");
    }
  });

  it("keeps its transparency", () => {
    const m = createMaterial({ type: "cube" }, "#ffffff", {
      ...chrome,
      opacity: 0.4,
    });
    expect(m.opacity).toBe(0.4);
    expect(m.transparent).toBe(true);
    // A see-through body must not hide what is behind it in the depth buffer.
    expect(m.depthWrite).toBe(false);
    expect(shadedMaterial("#ffffff").transparent).toBe(false);
  });

  it("previews a material edit as colour and transparency only", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      shadedMaterial("#ffffff"),
    );
    applyMaterialToMesh(mesh, { type: "cube" }, { ...chrome, opacity: 0.5 });
    expect(mesh.material.color.getHexString()).toBe("cc3344");
    expect(mesh.material.opacity).toBe(0.5);
    expect(finishOf(mesh.material)).toEqual([]);
  });

  it("the analytic primitives carry no specular highlight either", () => {
    for (const src of [
      SPHERE_FRAGMENT_SHADER,
      CYLINDER_FRAGMENT_SHADER,
      TORUS_FRAGMENT_SHADER,
      CONE_FRAGMENT_SHADER,
    ]) {
      // The highlight was a Phong reflection term.
      expect(src).not.toMatch(/reflect\s*\(/);
      expect(src).toMatch(/vec3 col = uColor \* \([^)]*\) \+ uEmissive;/);
    }
  });
});
