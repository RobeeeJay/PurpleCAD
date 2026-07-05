// Phase 0 of the JIT timeline: per-entry cache invalidation helpers.  Each
// history entry carries a `dirty` flag that the JIT evaluator clears on
// recompute; these helpers set it per the spec's forward-invalidation rules.

import { describe, it, expect } from "vitest";
import { dirtyEntriesFrom, dirtyAllEntries } from "../internals.js";

const hist = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `h${i}`, instruction: {} }));

describe("dirtyEntriesFrom", () => {
  it("marks the given index and everything after it dirty, leaving earlier clean", () => {
    const out = dirtyEntriesFrom(hist(5), 2);
    expect(out.map((e) => !!e.dirty)).toEqual([false, false, true, true, true]);
  });

  it("clamps a negative index to 0 (dirty all)", () => {
    const out = dirtyEntriesFrom(hist(3), -4);
    expect(out.every((e) => e.dirty)).toBe(true);
  });

  it("returns the SAME array reference when nothing changed", () => {
    const already = hist(3).map((e) => ({ ...e, dirty: true }));
    expect(dirtyEntriesFrom(already, 1)).toBe(already);
  });

  it("preserves each entry's other fields", () => {
    const h = [{ id: "a", instruction: { type: "create" }, hiddenIds: [7] }];
    const out = dirtyEntriesFrom(h, 0);
    expect(out[0]).toMatchObject({
      id: "a",
      instruction: { type: "create" },
      hiddenIds: [7],
      dirty: true,
    });
  });
});

describe("dirtyAllEntries", () => {
  it("marks the entire timeline dirty (resolution toggle)", () => {
    const out = dirtyAllEntries(hist(4));
    expect(out.every((e) => e.dirty)).toBe(true);
  });
});
