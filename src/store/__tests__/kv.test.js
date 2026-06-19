// The kv facade's node fallback: no window + no localStorage means an in-memory
// map, so persistence still round-trips within a test run (and the store can
// load at import without throwing).

import { describe, it, expect } from "vitest";
import { kvGet, kvSet, kvRemove } from "../kv.js";

describe("kv facade (in-memory fallback)", () => {
  it("returns null for missing keys", () => {
    expect(kvGet("nope-" + Math.random())).toBe(null);
  });

  it("round-trips set/get and clears on remove", () => {
    const key = "kv-test-" + Math.random();
    kvSet(key, JSON.stringify({ a: 1 }));
    expect(JSON.parse(kvGet(key))).toEqual({ a: 1 });
    kvRemove(key);
    expect(kvGet(key)).toBe(null);
  });

  it("coerces non-string values to strings on write", () => {
    const key = "kv-num-" + Math.random();
    kvSet(key, 42);
    expect(kvGet(key)).toBe("42");
  });
});
