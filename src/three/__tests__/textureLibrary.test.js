// Texture library: import round-trip through the settings-backed store and
// the import-size guard.  Default generators need a canvas, so they're
// covered by the e2e texture-library spec, not here.
import { describe, it, expect } from "vitest";
import {
  loadUserLibrary,
  saveUserLibrary,
  importSizeWarning,
  DEFAULT_TEXTURES,
} from "../textureLibrary.js";

describe("user library persistence", () => {
  it("round-trips entries through the settings store", () => {
    const entries = [
      { id: "user-1", name: "Leather", dataURL: "data:image/png;base64,a" },
      { id: "user-2", name: "Bark", dataURL: "data:image/png;base64,b" },
    ];
    saveUserLibrary(entries);
    expect(loadUserLibrary()).toEqual(entries);
    saveUserLibrary([]);
    expect(loadUserLibrary()).toEqual([]);
  });
});

describe("importSizeWarning", () => {
  it("accepts comfortable sizes silently", () => {
    expect(
      importSizeWarning({ width: 512, height: 512, bytes: 200 * 1024 }),
    ).toBe(null);
    expect(
      importSizeWarning({ width: 1024, height: 1024, bytes: 900 * 1024 }),
    ).toBe(null);
  });

  it("warns on large pixel counts or heavy files", () => {
    expect(
      importSizeWarning({ width: 2048, height: 2048, bytes: 500 * 1024 }),
    ).toMatch(/large/);
    expect(
      importSizeWarning({ width: 800, height: 800, bytes: 3 * 1024 * 1024 }),
    ).toMatch(/large/);
  });
});

describe("default catalogue", () => {
  it("covers the three requested families with unique ids", () => {
    const cats = new Set(DEFAULT_TEXTURES.map((t) => t.category));
    expect(cats).toEqual(new Set(["Animal scales", "Fabric", "Industrial"]));
    expect(new Set(DEFAULT_TEXTURES.map((t) => t.id)).size).toBe(
      DEFAULT_TEXTURES.length,
    );
  });
});
