// Multi-project management: create/switch keeps per-project data isolated, the
// active project's data is reloaded into the store on switch, and delete
// refuses the last project + re-switches when the active one is removed.  Backed
// by the db.js in-memory fallback (single implicit project + more via create).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createProjectSlice, projectInitial } from "../projectSlice.js";
import * as db from "../db.js";

const makeStore = () =>
  create((set, get) => ({
    ...projectInitial,
    items: [],
    history: [],
    activeHistoryId: null,
    variables: [],
    folders: [],
    defaultMaterial: {},
    materialPresets: [],
    cameraResetTrigger: 0,
    ...createProjectSlice(set, get),
  }));

describe("projectSlice", () => {
  let store;
  const g = () => store.getState();

  beforeEach(() => {
    store = makeStore();
  });

  it("creates a project and switches the active id to it", async () => {
    const before = g().activeProjectId;
    await g().createProject("Alpha");
    expect(g().activeProjectId).not.toBe(before);
    expect(db.getActiveProjectId()).toBe(g().activeProjectId);
    expect(g().projects.some((p) => p.name === "Alpha")).toBe(true);
  });

  it("keeps per-project data isolated and restores it on switch", async () => {
    await g().createProject("A");
    const a = g().activeProjectId;
    db.saveVariables([{ name: "only_a", value: "1" }]);

    await g().createProject("B");
    const b = g().activeProjectId;
    // B starts empty; the store was reloaded from B's data on switch.
    expect(g().variables.find((v) => v.name === "only_a")).toBeUndefined();
    db.saveVariables([{ name: "only_b", value: "2" }]);

    await g().switchProject(a);
    expect(g().activeProjectId).toBe(a);
    expect(g().variables.map((v) => v.name)).toContain("only_a");
    expect(g().variables.map((v) => v.name)).not.toContain("only_b");

    await g().switchProject(b);
    expect(g().variables.map((v) => v.name)).toContain("only_b");
  });

  it("bumps cameraResetTrigger on switch", async () => {
    await g().createProject("A");
    const t = g().cameraResetTrigger;
    await g().createProject("B");
    expect(g().cameraResetTrigger).toBeGreaterThan(t);
  });

  it("renames a project", async () => {
    await g().createProject("Old");
    const id = g().activeProjectId;
    g().renameProject(id, "New");
    expect(g().projects.find((p) => p.id === id).name).toBe("New");
  });

  it("delete re-switches when removing the active project", async () => {
    await g().createProject("A");
    await g().createProject("B");
    const b = g().activeProjectId;
    g().deleteProject(b);
    expect(g().activeProjectId).not.toBe(b);
    expect(g().projects.some((p) => p.id === b)).toBe(false);
  });

  it("refuses to delete the last remaining project", () => {
    // Collapse to a single project first.
    while (g().projects.length > 1) g().deleteProject(g().projects[0].id);
    const only = g().projects[0].id;
    g().deleteProject(only);
    expect(g().projects.length).toBe(1);
    expect(g().projects[0].id).toBe(only);
  });
});
