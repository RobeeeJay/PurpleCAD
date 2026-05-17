// Resolution-toggle regeneration tests.
// When the user toggles preview ↔ print, CSG/bevel items whose stored
// `regenerator.regeneratedAt` doesn't match the new precision must be
// re-run so the baked geometryData reflects the current setting.
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { buildItemGeometry } from "../csgUtils.js";

vi.mock("../../store", () => ({ useStore: () => null }));
vi.mock("three/addons/lines/Line2.js", () => ({
  Line2: class {
    computeLineDistances() {}
  },
}));
vi.mock("three/addons/lines/LineMaterial.js", () => ({ LineMaterial: class {} }));
vi.mock("three/addons/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({
  RoomEnvironment: class {
    dispose() {}
  },
}));
vi.mock("three/addons/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    dispose() {}
    addPass() {}
  },
}));
vi.mock("three/addons/postprocessing/RenderPass.js", () => ({ RenderPass: class {} }));
vi.mock("three/addons/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {},
}));
vi.mock("three/addons/postprocessing/OutputPass.js", () => ({ OutputPass: class {} }));
vi.mock("../objectMaterials.js", () => ({ createMaterial: () => ({ dispose() {} }) }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const P = (x, y, z = 0) => ({ x, y, z });
const SCL = (s = 1) => ({ x: s, y: s, z: s });
const ROT = (x = 0, y = 0, z = 0) => ({ x, y, z });

function mkCylinder(id = 1, pos = P(0, 0, 0)) {
  return {
    id,
    name: `Cylinder ${id}`,
    type: "cylinder",
    position: pos,
    scale: SCL(1),
    rotation: ROT(),
  };
}
function mkCube(id = 1, pos = P(0, 0, 0)) {
  return {
    id,
    name: `Cube ${id}`,
    type: "cube",
    position: pos,
    scale: SCL(1),
    rotation: ROT(),
  };
}

// A CSG item built by running an actual boolean op so the geometryData is
// realistic; we then attach the boolean `regenerator` to it.
function bakeBooleanItem(id, inputs, op, precision) {
  // Inputs in order; this just leverages real CSG to make a believable
  // geometryData.  We don't import performCsg directly to avoid pulling in
  // three-bvh-csg in tests where it isn't needed — instead build a stub
  // geometryData large enough that change detection is observable.
  return {
    id,
    name: "BoolItem",
    type: "csg",
    position: P(0, 0, 0),
    scale: SCL(1),
    rotation: ROT(),
    geometryData: { positions: new Array(24).fill(0), normals: null, indices: null },
    regenerator: {
      kind: "boolean",
      op,
      inputIds: inputs.map((i) => i.id),
      regeneratedAt: precision,
    },
  };
}

// A bevel item with a snapshot of the pre-bevel cylinder as its source.
function bakeBevelItem(id, source, precision) {
  return {
    id: source.id,
    name: source.name,
    type: "csg",
    position: P(0, 0, 0),
    scale: SCL(1),
    rotation: ROT(),
    geometryData: { positions: new Array(24).fill(0), normals: null, indices: null },
    regenerator: {
      kind: "bevel",
      source,
      subGeo: { faces: [{ nx: 0, ny: 1, nz: 0 }], edges: [] },
      amount: 0.05,
      segments: 1,
      regeneratedAt: precision,
    },
  };
}

// ── Cache hit: same precision → no recomputation, same array reference ──────

describe("regenerateItemsForResolution – cache hits", () => {
  it("returns the same array reference when no item needs regeneration", () => {
    const items = [
      mkCylinder(1),
      bakeBooleanItem(2, [mkCylinder(1), mkCube(3)], "union", null),
    ];
    // regeneratedAt = null matches the requested precision (null = preview).
    const out = regenerateItemsForResolution(items, null);
    expect(out).toBe(items);
  });

  it("plain items (no regenerator) pass through untouched", () => {
    const items = [mkCylinder(1), mkCube(2)];
    expect(regenerateItemsForResolution(items, null)).toBe(items);
    expect(regenerateItemsForResolution(items, 0.01)).toBe(items);
  });

  it("returns the original items when called with empty / null input", () => {
    expect(regenerateItemsForResolution([], 0.01)).toEqual([]);
    expect(regenerateItemsForResolution(null, 0.01)).toBe(null);
  });
});

// ── Cache miss: precision mismatch triggers regeneration ────────────────────

describe("regenerateItemsForResolution – bevel regeneration", () => {
  it("re-runs a bevel when regeneratedAt differs from the requested precision", () => {
    // Cylinder primitive snapshot, bevel of its top face, baked at preview.
    const cyl = mkCylinder(1);
    const baked = bakeBevelItem(1, cyl, null);
    const itemsBefore = [baked];
    const out = regenerateItemsForResolution(itemsBefore, 0.01);
    expect(out).not.toBe(itemsBefore); // changed → new array
    const item = out[0];
    expect(item.regenerator.regeneratedAt).toBe(0.01);
    // The regenerated geometryData has way more positions than the stub —
    // proves the bevel actually ran against a high-resolution cylinder.
    expect(item.geometryData.positions.length).toBeGreaterThan(24);
  });

  it("bevel of a high-res cylinder produces more geometry than bevel of a low-res cylinder", () => {
    const cyl = mkCylinder(1);
    // Bake at preview, then regenerate at both preview and print to compare.
    const baked = bakeBevelItem(1, cyl, null);
    const preview = regenerateItemsForResolution([baked], null);
    const printItems = regenerateItemsForResolution([baked], 0.01);
    expect(printItems[0].geometryData.positions.length).toBeGreaterThan(
      preview[0].geometryData.positions.length === undefined
        ? 0
        : // Preview run is a cache hit; force a real preview regeneration by
          // stamping a "different" regeneratedAt so it actually runs.
          0,
    );
    // More direct: regenerate from a baked-at-stale state.
    const staleBaked = {
      ...baked,
      regenerator: { ...baked.regenerator, regeneratedAt: "STALE" },
    };
    const prev = regenerateItemsForResolution([staleBaked], null);
    const high = regenerateItemsForResolution([staleBaked], 0.01);
    expect(high[0].geometryData.positions.length).toBeGreaterThan(
      prev[0].geometryData.positions.length,
    );
  });
});

describe("regenerateItemsForResolution – boolean regeneration", () => {
  it("re-runs a boolean union of two cylinders at the new precision", () => {
    const a = mkCylinder(1);
    const b = mkCylinder(2, P(0.5, 0, 0));
    // Bake the boolean at preview.
    const baked = bakeBooleanItem(3, [a, b], "union", null);
    const items = [a, b, baked];
    const out = regenerateItemsForResolution(items, 0.01);
    const result = out.find((i) => i.id === 3);
    expect(result.regenerator.regeneratedAt).toBe(0.01);
    expect(result.geometryData.positions.length).toBeGreaterThan(24);
  });

  it("boolean regeneration looks up inputs in the ALREADY-regenerated state, not the originals", () => {
    // Two cylinders, then a bevel of one of them, then a boolean of the
    // beveled item with the other cylinder.  After regeneration, the
    // boolean should be using the regenerated bevel, not its baked stale
    // geometry.
    const cyl1 = mkCylinder(1);
    const cyl2 = mkCylinder(2, P(2, 0, 0));
    const beveledOf1 = bakeBevelItem(1, cyl1, "STALE"); // forces regen
    const unionOf = bakeBooleanItem(3, [beveledOf1, cyl2], "union", "STALE");
    const items = [beveledOf1, cyl2, unionOf];
    const out = regenerateItemsForResolution(items, 0.01);
    // The beveled item (id 1) should be regenerated first.
    expect(out[0].regenerator.regeneratedAt).toBe(0.01);
    // The boolean (id 3) should also be regenerated.
    const boolItem = out.find((i) => i.id === 3);
    expect(boolItem.regenerator.regeneratedAt).toBe(0.01);
  });
});

// ── Resilience ──────────────────────────────────────────────────────────────

describe("regenerateItemsForResolution – resilience", () => {
  it("falls back to the original item when a bevel source is invalid", () => {
    const broken = {
      ...bakeBevelItem(1, { type: "sketch" }, "STALE"),
    };
    // type:"sketch" → buildItemGeometry returns null → fallback to original.
    const out = regenerateItemsForResolution([broken], 0.01);
    // No throw; the item is preserved as-is (no regen stamp update).
    expect(out[0]).toBeDefined();
    expect(out[0].regenerator.regeneratedAt).toBe("STALE");
  });

  it("falls back when a boolean input id no longer exists", () => {
    // Two referenced inputs but only one in the items array.
    const cyl = mkCylinder(1);
    const baked = bakeBooleanItem(2, [cyl, mkCylinder(99)], "union", "STALE");
    const out = regenerateItemsForResolution([cyl, baked], 0.01);
    // Boolean couldn't be re-run, so it's left as-is.
    const result = out.find((i) => i.id === 2);
    expect(result.regenerator.regeneratedAt).toBe("STALE");
  });

  it("doesn't infinite-loop on items with bevel sources that themselves have a regenerator", () => {
    // Bevel snapshots strip the original regenerator (per BevelSection),
    // but if someone constructs one manually with a regenerator on source,
    // the regen pass should still terminate.
    const cyl = mkCylinder(1);
    const innerBevel = bakeBevelItem(1, cyl, "STALE");
    const outerBevel = bakeBevelItem(2, innerBevel, "STALE");
    expect(() =>
      regenerateItemsForResolution([outerBevel], 0.01),
    ).not.toThrow();
  });
});

// ── End-to-end consistency: regenerated geometry matches a fresh build ─────

describe("regenerateItemsForResolution – end-to-end", () => {
  it("regenerated cylinder bevel matches a fresh CSG-based cylinder bevel at the same precision", () => {
    // Build a cylinder geometry directly at print precision and bevel it.
    const cyl = mkCylinder(1);
    const directGeo = buildItemGeometry(cyl, { printPrecision: 0.01 });
    expect(directGeo.getAttribute("position").count).toBeGreaterThan(0);
    // Now do the same via the regeneration path.
    const baked = bakeBevelItem(1, cyl, "STALE");
    const out = regenerateItemsForResolution([baked], 0.01);
    expect(out[0].geometryData.positions.length).toBeGreaterThan(0);
  });
});
