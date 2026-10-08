// The Electron persistence path: load once, read from the cache, write through
// asynchronously.  It replaced ~25 synchronous IPC calls, which an iPad web
// view has no equivalent of, so nothing here may block on the host -- except
// the writes made while the window unloads, which an async message can lose.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// A host bridge recording every call, over a two-project database.
function fakeHost() {
  const calls = [];
  const projects = {
    1: {
      timeline: { history: [{ id: 0 }], activeHistoryId: null },
      variables: [{ name: "W", value: "10" }],
      folders: [],
      material: null,
      camera: "cam-1",
    },
    2: {
      timeline: { history: [{ id: 0 }, { id: 1 }], activeHistoryId: null },
      variables: [],
      folders: [{ id: "folder-1" }],
      material: null,
      camera: null,
    },
  };
  return {
    calls,
    electronAPI: {
      dbBootstrap: async () => ({
        settings: { snap: '{"snapEnabled":true}' },
        projects: [
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ],
        activeProjectId: 1,
        project: projects[1],
      }),
      dbLoadProject: async (pid) => {
        calls.push(["load", pid]);
        return projects[pid];
      },
      dbCall: async (name, arg) => {
        calls.push(["async", name, arg]);
        if (name === "db:createProject") return 3;
        if (name === "db:listProjects")
          return [
            { id: 3, name: arg ?? "New" },
            { id: 1, name: "One" },
          ];
        return true;
      },
      dbCallSync: (name, arg) => {
        calls.push(["sync", name, arg]);
        return true;
      },
    },
  };
}

let host;
let db;
let listeners;
beforeEach(async () => {
  vi.resetModules();
  host = fakeHost();
  listeners = {};
  globalThis.window = {
    electronAPI: host.electronAPI,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  db = await import("../db.js");
  await db.initDb();
});

afterAll(() => {
  delete globalThis.window;
});

describe("the Electron persistence cache", () => {
  it("answers reads from what it loaded, without calling the host", () => {
    expect(db.getActiveProjectId()).toBe(1);
    expect(db.settingGet("snap")).toBe('{"snapEnabled":true}');
    expect(db.getVariables()[0].name).toBe("W");
    expect(db.getCamera()).toBe("cam-1");
    expect(db.listProjects().map((p) => p.name)).toEqual(["One", "Two"]);
    expect(host.calls).toEqual([]);
  });

  it("writes update the cache at once and go to the host asynchronously", () => {
    db.settingSet("snap", "x");
    db.saveVariables([{ name: "H" }]);
    expect(db.settingGet("snap")).toBe("x");
    expect(db.getVariables()[0].name).toBe("H");
    expect(host.calls).toEqual([
      ["async", "db:settingSet", { key: "snap", value: "x" }],
      ["async", "db:saveVariables", { pid: 1, data: [{ name: "H" }] }],
    ]);
  });

  it("refuses to read a project it hasn't loaded, and reads it once loaded", async () => {
    expect(() => db.getFolders(2)).toThrow(/isn't loaded/);
    await db.loadProject(2);
    expect(db.getFolders(2)).toEqual([{ id: "folder-1" }]);
    expect(host.calls).toEqual([["load", 2]]);
  });

  it("coalesces timeline saves, but a read sees the newest at once", async () => {
    db.saveTimeline({ history: [{ id: 0 }, { id: 5 }] });
    db.saveTimeline({ history: [{ id: 0 }, { id: 6 }] });
    expect(db.getTimeline().history.map((h) => h.id)).toEqual([0, 6]);
    expect(host.calls).toEqual([]);
    db.flushTimelineSave();
    expect(host.calls).toEqual([
      [
        "async",
        "db:saveTimeline",
        { pid: 1, data: { history: [{ id: 0 }, { id: 6 }] } },
      ],
    ]);
  });

  it("while the window unloads, the pending save and later writes go synchronously", () => {
    db.saveTimeline({ history: [{ id: 0 }, { id: 7 }] });
    listeners.beforeunload();
    db.setThumbnail(1, "data:thumb");
    expect(host.calls.map(([kind, name]) => `${kind} ${name}`)).toEqual([
      "sync db:saveTimeline",
      "sync db:setThumbnail",
    ]);
  });

  // An iPad app is backgrounded, never unloaded, and may be killed in the
  // background: the coalesced save has to go out as the page is hidden, not
  // 150 ms later.  It goes asynchronously -- the host stays awake for it.
  it("a hidden page sends the pending save at once", () => {
    db.saveTimeline({ history: [{ id: 0 }, { id: 8 }] });
    globalThis.document = { visibilityState: "visible" };
    listeners.visibilitychange();
    expect(host.calls).toEqual([]);
    globalThis.document.visibilityState = "hidden";
    listeners.visibilitychange();
    delete globalThis.document;
    expect(host.calls.map(([kind, name]) => `${kind} ${name}`)).toEqual([
      "async db:saveTimeline",
    ]);
  });

  it("creating a project waits for the host's id and its new list", async () => {
    const id = await db.createProject("Fresh");
    expect(id).toBe(3);
    expect(db.listProjects().map((p) => p.id)).toEqual([3, 1]);
  });
});
