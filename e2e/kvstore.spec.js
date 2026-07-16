import { test, expect } from "@playwright/test";
import { launchApp } from "./launch.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../electron/kvStore.cjs",
);

// Direct main-process tests for electron/kvStore.cjs (better-sqlite3 is built
// for Electron's ABI, so plain-node vitest can't load it — Playwright's
// app.evaluate runs in the real main process instead).  Covers the CRUD +
// per-project round-trip surface that only one indirect e2e touched before.

let app;

test.beforeAll(async () => {
  app = await launchApp();
  const page = await app.firstWindow();
  await page.locator(".toolbar").waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

const inMain = (fn) => app.evaluate(fn, KV_PATH);

test("project CRUD, per-project round-trip, duplicate, cascade delete", async () => {
  const result = await inMain((_electron, kvPath) => {
    // Playwright's evaluate sandbox has no `require`; go through the main
    // process's module loader with an absolute path.
    const kv = process.mainModule.require(kvPath);
    const out = {};

    // Create seeds an empty timeline so the project opens with a valid scene.
    const pid = kv.createProject("KV Test");
    out.seededTimeline = kv.getTimeline(pid)?.history?.length === 1;

    kv.renameProject(pid, "KV Renamed");
    out.renamed = kv.listProjects().find((p) => p.id === pid)?.name;

    // Per-project data round-trips.
    const history = [
      {
        id: 0,
        label: "Scene created",
        itemId: null,
        instruction: { type: "scene_created" },
        hiddenIds: [],
      },
      {
        id: 1,
        label: "Added",
        itemId: 7,
        instruction: { type: "create", item: { id: 7, type: "cube" } },
        hiddenIds: [],
      },
    ];
    kv.saveTimeline(pid, { history, activeHistoryId: 1 });
    kv.saveVariables(pid, [{ name: "wall", value: "2.5" }]);
    kv.saveFolders(pid, [{ id: "f1", name: "Parts", itemIds: [7] }]);
    kv.saveMaterial(pid, {
      defaultMaterial: { color: "#ff0000" },
      materialPresets: [{ name: "Red", color: "#ff0000" }],
    });
    kv.saveCamera(pid, "cam-state-blob");

    out.timeline = kv.getTimeline(pid);
    out.variables = kv.getVariables(pid);
    out.folders = kv.getFolders(pid);
    out.material = kv.getMaterial(pid);
    out.camera = kv.getCamera(pid);

    // Duplicate copies everything under a new id, named "<name> copy".
    const dupId = kv.duplicateProject(pid);
    out.dupDistinct = dupId !== pid;
    out.dupName = kv.listProjects().find((p) => p.id === dupId)?.name;
    out.dupTimeline = kv.getTimeline(dupId);
    out.dupVariables = kv.getVariables(dupId);
    out.dupCamera = kv.getCamera(dupId);

    // Deleting the original cascades its rows; the duplicate keeps its copy.
    kv.deleteProject(pid);
    out.goneAfterDelete = kv.getTimeline(pid) === null;
    out.dupSurvives = kv.getTimeline(dupId)?.history?.length === 2;
    kv.deleteProject(dupId);

    return out;
  });

  expect(result.seededTimeline).toBe(true);
  expect(result.renamed).toBe("KV Renamed");
  expect(result.timeline.history).toHaveLength(2);
  expect(result.timeline.activeHistoryId).toBe(1);
  expect(result.variables).toEqual([{ name: "wall", value: "2.5" }]);
  expect(result.folders).toEqual([{ id: "f1", name: "Parts", itemIds: [7] }]);
  expect(result.material.defaultMaterial).toEqual({ color: "#ff0000" });
  expect(result.material.materialPresets).toEqual([
    { name: "Red", color: "#ff0000" },
  ]);
  expect(result.camera).toBe("cam-state-blob");
  expect(result.dupDistinct).toBe(true);
  expect(result.dupName).toBe("KV Renamed copy");
  expect(result.dupTimeline.history).toEqual(result.timeline.history);
  expect(result.dupTimeline.activeHistoryId).toBe(1);
  expect(result.dupVariables).toEqual(result.variables);
  expect(result.dupCamera).toBe("cam-state-blob");
  expect(result.goneAfterDelete).toBe(true);
  expect(result.dupSurvives).toBe(true);
});

test("settings round-trip and active project tracking", async () => {
  const result = await inMain((_electron, kvPath) => {
    const kv = process.mainModule.require(kvPath);
    kv.settingSet("kv-test-key", "42");
    const got = kv.settingGet("kv-test-key");
    kv.settingRemove("kv-test-key");
    const removed = kv.settingGet("kv-test-key");

    const prevActive = kv.getActiveProjectId();
    const pid = kv.createProject("Active Test");
    kv.setActiveProjectId(pid);
    const active = kv.getActiveProjectId();
    kv.setActiveProjectId(prevActive);
    kv.deleteProject(pid);
    return { got, removed, active, pid };
  });
  expect(result.got).toBe("42");
  expect(result.removed).toBe(null);
  expect(result.active).toBe(result.pid);
});
