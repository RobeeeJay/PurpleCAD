// JIT timeline solid cache: leak-safe / double-free-safe ownership.

import { describe, it, expect, vi, beforeEach } from "vitest";

const released = [];
vi.mock("../occClient.js", () => ({
  releaseShape: (id) => {
    released.push(id);
    return Promise.resolve(null);
  },
}));

import {
  getSolid,
  setSolid,
  releaseSolid,
  clearSolids,
  pruneSolids,
  cachedSolidCount,
} from "../solidCache.js";

beforeEach(() => {
  clearSolids();
  released.length = 0;
});

describe("solidCache", () => {
  it("returns a cached solid only when the precision matches", () => {
    setSolid(1, 100, 0.05);
    expect(getSolid(1, 0.05)).toBe(100);
    expect(getSolid(1, 0.1)).toBe(null); // precision changed → miss
    expect(getSolid(2, 0.05)).toBe(null); // never cached
  });

  it("releases the prior id when an item is re-cached (no leak)", () => {
    setSolid(1, 100, 0.05);
    setSolid(1, 101, 0.02); // recompute at a finer precision
    expect(released).toContain(100);
    expect(getSolid(1, 0.02)).toBe(101);
    expect(cachedSolidCount()).toBe(1);
  });

  it("does not release when the same id is re-set", () => {
    setSolid(1, 100, 0.05);
    setSolid(1, 100, 0.05);
    expect(released).not.toContain(100);
  });

  it("releaseSolid frees and forgets one item", () => {
    setSolid(1, 100, 0.05);
    setSolid(2, 200, 0.05);
    releaseSolid(1);
    expect(released).toEqual([100]);
    expect(getSolid(1, 0.05)).toBe(null);
    expect(getSolid(2, 0.05)).toBe(200);
  });

  it("pruneSolids releases only the entries no longer present", () => {
    setSolid(1, 100, 0.05);
    setSolid(2, 200, 0.05);
    setSolid(3, 300, 0.05);
    pruneSolids(new Set([1, 3])); // entry 2 was deleted from the timeline
    expect(released).toEqual([200]);
    expect(getSolid(1, 0.05)).toBe(100);
    expect(getSolid(2, 0.05)).toBe(null);
    expect(getSolid(3, 0.05)).toBe(300);
    expect(cachedSolidCount()).toBe(2);
  });

  it("clearSolids releases every held id", () => {
    setSolid(1, 100, 0.05);
    setSolid(2, 200, 0.05);
    clearSolids();
    expect(released.sort()).toEqual([100, 200]);
    expect(cachedSolidCount()).toBe(0);
  });
});
