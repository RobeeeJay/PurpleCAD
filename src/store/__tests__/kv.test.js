// The db facade's node fallback: no window + no localStorage means an in-memory
// map, so persistence still round-trips within a test run (and the store can
// load at import without throwing).  A single implicit project (id 1) is used.

import { describe, it, expect } from "vitest";
import * as db from "../db.js";

describe("db facade (in-memory fallback)", () => {
  it("round-trips settings and clears on remove", () => {
    const key = "s-" + Math.random();
    db.settingSet(key, JSON.stringify({ a: 1 }));
    expect(JSON.parse(db.settingGet(key))).toEqual({ a: 1 });
    db.settingRemove(key);
    expect(db.settingGet(key)).toBe(null);
  });

  it("has an active project and lists it", () => {
    expect(db.getActiveProjectId()).toBeTruthy();
    expect(db.listProjects().length).toBeGreaterThan(0);
  });

  it("round-trips per-project timeline / variables / material", () => {
    db.saveTimeline({ history: [{ id: 0 }], activeHistoryId: null });
    expect(db.getTimeline().history[0].id).toBe(0);
    db.saveVariables([{ name: "x", value: "1" }]);
    expect(db.getVariables()[0].name).toBe("x");
    db.saveMaterial({
      defaultMaterial: { color: "#fff" },
      materialPresets: [],
    });
    expect(db.getMaterial().defaultMaterial.color).toBe("#fff");
  });

  it("isolates data between projects", () => {
    const id = db.createProject("Second");
    db.saveVariables([{ name: "only-in-2" }], id);
    expect(db.getVariables(id)[0].name).toBe("only-in-2");
    expect(db.getVariables(1).some((v) => v.name === "only-in-2")).toBe(false);
  });
});
