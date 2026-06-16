import { describe, it, expect } from "vitest";
import { resolveItemMaterial } from "../objectMaterials.js";

const DEFAULT = { color: "#777777" };

describe("resolveItemMaterial", () => {
  const red = { color: "#ff0000" };
  const source = { id: 1, type: "cube", material: red };
  const clone = {
    id: 2,
    type: "csg",
    regenerator: { kind: "pattern3d", patternType: "mirror", sourceId: 1 },
  };

  it("returns an item's own material when it isn't a pattern clone", () => {
    expect(resolveItemMaterial(source, [source], DEFAULT)).toBe(red);
  });

  it("falls back to the default when an item has no material", () => {
    const plain = { id: 3, type: "cube" };
    expect(resolveItemMaterial(plain, [plain], DEFAULT)).toBe(DEFAULT);
  });

  it("inherits the source object's material for a pattern3d clone", () => {
    expect(resolveItemMaterial(clone, [source, clone], DEFAULT)).toBe(red);
  });

  it("tracks the source: a changed source material flows to the clone", () => {
    const blue = { color: "#0000ff" };
    const recolored = { ...source, material: blue };
    expect(resolveItemMaterial(clone, [recolored, clone], DEFAULT)).toBe(blue);
  });

  it("uses the default when the clone's source has no material", () => {
    const plainSource = { id: 1, type: "cube" };
    expect(resolveItemMaterial(clone, [plainSource, clone], DEFAULT)).toBe(
      DEFAULT,
    );
  });

  it("falls back to the default when the source is missing", () => {
    expect(resolveItemMaterial(clone, [clone], DEFAULT)).toBe(DEFAULT);
  });
});
