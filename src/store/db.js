import { unpackHistory } from "./geometryPack.js";
// Project-aware persistence facade.  In Electron it's backed by the normalised
// SQLite database in the main process (synchronous IPC).  In a plain browser it
// falls back to localStorage; under node/vitest it uses an in-memory map.  The
// fallbacks keep a single implicit project (id 1) so the store still loads and
// persists there.
//
// Per-project getters/setters operate on the CURRENT active project, tracked in
// `activeProjectId` here and switched by the project store.

const memory = new Map();

function api() {
  return typeof window !== "undefined" && window.electronAPI?.settingGet
    ? window.electronAPI
    : null;
}
function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

// ── Fallback (browser localStorage / node memory) primitives ─────────────────
const lsGet = (k) => (hasLocalStorage() ? localStorage.getItem(k) : null);
const lsSet = (k, v) => {
  if (hasLocalStorage()) localStorage.setItem(k, v);
  else memory.set(k, v);
};
const lsRaw = (k) =>
  hasLocalStorage() ? localStorage.getItem(k) : (memory.get(k) ?? null);
const lsRemove = (k) => {
  if (hasLocalStorage()) localStorage.removeItem(k);
  else memory.delete(k);
};
const jGet = (k, dflt) => {
  try {
    const raw = lsRaw(k);
    return raw == null ? dflt : JSON.parse(raw);
  } catch {
    return dflt;
  }
};
const jSet = (k, v) => lsSet(k, JSON.stringify(v));

// ── Settings (global) ────────────────────────────────────────────────────────
export function settingGet(key) {
  const a = api();
  if (a) return a.settingGet(key);
  return lsRaw(`setting:${key}`);
}
export function settingSet(key, value) {
  const a = api();
  if (a) a.settingSet(key, String(value));
  else lsSet(`setting:${key}`, String(value));
}
export function settingRemove(key) {
  const a = api();
  if (a) a.settingRemove(key);
  else lsRemove(`setting:${key}`);
}

// ── Active project ───────────────────────────────────────────────────────────
let activeProjectId = (() => {
  const a = api();
  if (a) return a.projGetActive();
  const stored = lsRaw("setting:active_project_id");
  return stored != null ? Number(stored) : 1;
})();

export const getActiveProjectId = () => activeProjectId;
export function setActiveProjectId(id) {
  flushTimelineSave();
  activeProjectId = id;
  const a = api();
  if (a) a.projSetActive(id);
  else lsSet("setting:active_project_id", String(id));
}

// ── Projects ─────────────────────────────────────────────────────────────────
function fallbackProjects() {
  const list = jGet("projects", null);
  if (list && list.length) return list;
  const seed = [{ id: 1, name: "Untitled", thumbnail: null }];
  jSet("projects", seed);
  return seed;
}
export function listProjects() {
  const a = api();
  if (a) return a.projListProjects() || [];
  return fallbackProjects();
}
export function createProject(name) {
  const a = api();
  if (a) return a.projCreate(name || "Untitled");
  const list = fallbackProjects();
  const id = Math.max(0, ...list.map((p) => p.id)) + 1;
  list.unshift({ id, name: name || "Untitled", thumbnail: null });
  jSet("projects", list);
  saveTimeline(
    {
      history: [
        {
          id: 0,
          label: "Scene created",
          itemId: null,
          instruction: { type: "scene_created" },
          hiddenIds: [],
          _orphaned: false,
        },
      ],
      activeHistoryId: null,
    },
    id,
  );
  return id;
}
// Copy a project and all its per-project data; returns the new id.  The
// fallback path replays the copy through the generic get/save helpers.
export function duplicateProject(id) {
  flushTimelineSave();
  const a = api();
  if (a) return a.projDuplicate(id);
  const list = fallbackProjects();
  const src = list.find((p) => p.id === id);
  if (!src) return null;
  const newId = Math.max(0, ...list.map((p) => p.id)) + 1;
  list.unshift({
    id: newId,
    name: `${src.name} copy`,
    thumbnail: src.thumbnail,
  });
  jSet("projects", list);
  saveTimeline(getTimeline(id), newId);
  saveVariables(getVariables(id), newId);
  saveFolders(getFolders(id), newId);
  saveMaterial(getMaterial(id), newId);
  const cam = getCamera(id);
  if (cam != null) saveCamera(cam, newId);
  return newId;
}
export function renameProject(id, name) {
  const a = api();
  if (a) return a.projRename(id, name);
  const list = fallbackProjects();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.name = name;
    jSet("projects", list);
  }
}
export function deleteProject(id) {
  flushTimelineSave();
  const a = api();
  if (a) return a.projDelete(id);
  jSet(
    "projects",
    fallbackProjects().filter((p) => p.id !== id),
  );
  for (const t of ["timeline", "variables", "folders", "material", "camera"])
    lsRemove(`p${id}:${t}`);
}
export function setThumbnail(id, thumbnail) {
  const a = api();
  if (a) return a.projSetThumbnail(id, thumbnail);
  const list = fallbackProjects();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.thumbnail = thumbnail;
    jSet("projects", list);
  }
}

// ── Per-project data (current active project unless a pid is passed) ──────────
const pid = (id) => (id == null ? activeProjectId : id);

// Timeline saves COALESCE: a burst of mutations (each gizmo release appends a
// step and re-saves) collapses to one async write ~150 ms later, so the
// renderer never blocks on the IPC clone + SQLite rewrite of a big document.
// Anything that READS or re-points the timeline flushes the pending save
// first, and beforeunload flushes synchronously so nothing is lost on quit.
let pendingTimelineSave = null; // { pid, data, timer }

export function flushTimelineSave() {
  if (!pendingTimelineSave) return;
  const { pid: savePid, data, timer } = pendingTimelineSave;
  clearTimeout(timer);
  pendingTimelineSave = null;
  const a = api();
  if (a) a.dbSaveTimeline(savePid, data);
  else jSet(`p${savePid}:timeline`, data);
}

if (typeof window !== "undefined")
  window.addEventListener("beforeunload", flushTimelineSave);

export function getTimeline(id) {
  flushTimelineSave();
  const a = api();
  const raw = a ? a.dbGetTimeline(pid(id)) : jGet(`p${pid(id)}:timeline`, null);
  if (raw?.history) return { ...raw, history: unpackHistory(raw.history) };
  return raw;
}
export function saveTimeline(data, id) {
  const a = api();
  if (!a?.dbSaveTimelineAsync) {
    // Fallback paths (node/browser) stay synchronous — cheap there.
    if (a) a.dbSaveTimeline(pid(id), data);
    else jSet(`p${pid(id)}:timeline`, data);
    return;
  }
  const savePid = pid(id); // resolve NOW — a project switch must not re-target it
  if (pendingTimelineSave) clearTimeout(pendingTimelineSave.timer);
  pendingTimelineSave = {
    pid: savePid,
    data,
    timer: setTimeout(() => {
      const send = pendingTimelineSave;
      pendingTimelineSave = null;
      api()?.dbSaveTimelineAsync(send.pid, send.data);
    }, 150),
  };
}
export function getVariables(id) {
  const a = api();
  if (a) return a.dbGetVariables(pid(id)) || [];
  return jGet(`p${pid(id)}:variables`, []);
}
export function saveVariables(data, id) {
  const a = api();
  if (a) a.dbSaveVariables(pid(id), data);
  else jSet(`p${pid(id)}:variables`, data);
}
export function getFolders(id) {
  const a = api();
  if (a) return a.dbGetFolders(pid(id)) || [];
  return jGet(`p${pid(id)}:folders`, []);
}
export function saveFolders(data, id) {
  const a = api();
  if (a) a.dbSaveFolders(pid(id), data);
  else jSet(`p${pid(id)}:folders`, data);
}
export function getMaterial(id) {
  const a = api();
  if (a) return a.dbGetMaterial(pid(id));
  return jGet(`p${pid(id)}:material`, {
    defaultMaterial: null,
    materialPresets: [],
  });
}
export function saveMaterial(data, id) {
  const a = api();
  if (a) a.dbSaveMaterial(pid(id), data);
  else jSet(`p${pid(id)}:material`, data);
}
export function getCamera(id) {
  const a = api();
  if (a) return a.dbGetCamera(pid(id));
  return lsRaw(`p${pid(id)}:camera`);
}
export function saveCamera(state, id) {
  const a = api();
  if (a) a.dbSaveCamera(pid(id), String(state));
  else lsSet(`p${pid(id)}:camera`, String(state));
}
export function clearCamera(id) {
  const a = api();
  if (a) a.dbClearCamera(pid(id));
  else lsRemove(`p${pid(id)}:camera`);
}
