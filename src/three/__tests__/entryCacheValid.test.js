// Phase 0 JIT timeline: the incremental-recompute predicate that lets
// recalculateTimeline reuse a step's cache instead of forcing a rebuild.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({});
  return { useStore };
});
vi.mock("./occClient.js", () => ({}));

import { entryCacheValid } from "../regenerateOrchestrator.js";

const geom = { positions: [0, 0, 0], indices: [0] };

describe("entryCacheValid", () => {
  it("reuses a regenerated step whose cache matches the current precision", () => {
    const entry = { id: "h", instruction: {} };
    const item = { geometryData: geom, regenerator: { regeneratedAt: 0.05 } };
    expect(entryCacheValid(entry, item, 0.05)).toBe(true);
  });

  it("rebuilds when the entry is flagged dirty", () => {
    const entry = { id: "h", dirty: true, instruction: {} };
    const item = { geometryData: geom, regenerator: { regeneratedAt: 0.05 } };
    expect(entryCacheValid(entry, item, 0.05)).toBe(false);
  });

  it("rebuilds when the cache was tessellated at a different precision", () => {
    const entry = { id: "h", instruction: {} };
    const item = { geometryData: geom, regenerator: { regeneratedAt: 0.1 } };
    expect(entryCacheValid(entry, item, 0.05)).toBe(false);
  });

  it("rebuilds when there is no cached geometry yet", () => {
    const entry = { id: "h", instruction: {} };
    const item = { regenerator: { regeneratedAt: 0.05 } };
    expect(entryCacheValid(entry, item, 0.05)).toBe(false);
  });

  it("reuses static import/split geometry that carries no recipe", () => {
    const entry = { id: "h", instruction: {} };
    const item = { geometryData: geom }; // no regenerator
    expect(entryCacheValid(entry, item, 0.05)).toBe(true);
  });
});
