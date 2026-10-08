import { unpackHistory } from "./geometryPack.js";
// Project-aware persistence facade.  In Electron it's backed by the normalised
// SQLite database in the main process; in a plain browser it falls back to
// localStorage; under node/vitest it uses an in-memory map.  The fallbacks keep
// a single implicit project (id 1) so the store still loads and persists there.
//
// The Electron path is LOAD-ONCE, WRITE-THROUGH: initDb() fetches the settings,
// the project list and the active project's data before the store is created,
// reads come from that cache, and writes update it at once and go to the main
// process asynchronously.  Every call here used to be synchronous IPC, which an
// iPad web view has no equivalent of.  A project that isn't the active one is
// loaded with loadProject() before anything reads it (a project switch).
//
// Per-project getters/setters operate on the CURRENT active project, tracked in
// `activeProjectId` here and switched by the project store.

const memory = new Map();

function api() {
  return typeof window !== "undefined" && window.electronAPI?.dbBootstrap
    ? window.electronAPI
    : null;
}
function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

// ── Fallback (browser localStorage / node memory) primitives ─────────────────
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

// ── The Electron cache ───────────────────────────────────────────────────────
// { settings: Map, projects: [...], data: Map<pid, projectData> }, set by
// initDb(); null on the fallback paths.
let cache = null;

// While the window unloads, a write sent asynchronously can be lost with it,
// so writes then go through the one synchronous channel (where the host has
// one -- an iPad host flushes from its own app lifecycle instead).
let unloading = false;
const send = (name, arg) => {
  const a = api();
  if (unloading && a.dbCallSync) {
    a.dbCallSync(name, arg);
    return;
  }
  a.dbCall(name, arg).catch((err) =>
    console.error(`[db] ${name} failed:`, err),
  );
};

const projectData = (pid) => {
  const d = cache.data.get(pid);
  if (!d)
    throw new Error(`project ${pid} isn't loaded -- call loadProject first`);
  return d;
};

// Load the persisted state the store starts from.  Must resolve before the
// store module is imported: the store reads settings and the active project
// as it is created.
export async function initDb() {
  const a = api();
  if (!a) return;
  const b = await a.dbBootstrap();
  cache = {
    settings: new Map(Object.entries(b.settings || {})),
    projects: b.projects || [],
    data: new Map([[b.activeProjectId, b.project]]),
  };
  activeProjectId = b.activeProjectId;
}

// Make a project's data readable (before switching to it).
export async function loadProject(id) {
  if (!cache || cache.data.has(id)) return;
  cache.data.set(id, await api().dbLoadProject(id));
}

// ── Settings (global) ────────────────────────────────────────────────────────
export function settingGet(key) {
  if (cache) return cache.settings.get(key) ?? null;
  return lsRaw(`setting:${key}`);
}
export function settingSet(key, value) {
  if (cache) {
    cache.settings.set(key, String(value));
    send("db:settingSet", { key, value: String(value) });
  } else lsSet(`setting:${key}`, String(value));
}
export function settingRemove(key) {
  if (cache) {
    cache.settings.delete(key);
    send("db:settingRemove", key);
  } else lsRemove(`setting:${key}`);
}

// ── Active project ───────────────────────────────────────────────────────────
let activeProjectId = (() => {
  const stored = lsRaw("setting:active_project_id");
  return stored != null ? Number(stored) : 1;
})();

export const getActiveProjectId = () => activeProjectId;
export function setActiveProjectId(id) {
  flushTimelineSave();
  activeProjectId = id;
  if (cache) send("db:setActiveProjectId", id);
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
  if (cache) return cache.projects.slice();
  return fallbackProjects();
}
const refreshProjects = async () => {
  cache.projects = (await api().dbCall("db:listProjects")) || [];
};
export async function createProject(name) {
  if (cache) {
    const id = await api().dbCall("db:createProject", name || "Untitled");
    await refreshProjects();
    return id;
  }
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
export async function duplicateProject(id) {
  flushTimelineSave();
  if (cache) {
    const newId = await api().dbCall("db:duplicateProject", id);
    await refreshProjects();
    return newId;
  }
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
  if (cache) {
    cache.projects = cache.projects.map((p) =>
      p.id === id ? { ...p, name } : p,
    );
    send("db:renameProject", { id, name });
    return;
  }
  const list = fallbackProjects();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.name = name;
    jSet("projects", list);
  }
}
export function deleteProject(id) {
  flushTimelineSave();
  if (cache) {
    cache.projects = cache.projects.filter((p) => p.id !== id);
    cache.data.delete(id);
    send("db:deleteProject", id);
    return;
  }
  jSet(
    "projects",
    fallbackProjects().filter((p) => p.id !== id),
  );
  for (const t of ["timeline", "variables", "folders", "material", "camera"])
    lsRemove(`p${id}:${t}`);
}
export function setThumbnail(id, thumbnail) {
  if (cache) {
    cache.projects = cache.projects.map((p) =>
      p.id === id ? { ...p, thumbnail } : p,
    );
    send("db:setThumbnail", { id, thumbnail });
    return;
  }
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
// step and re-saves) collapses to one write ~150 ms later, so the renderer
// never pays the IPC clone + SQLite rewrite of a big document per step.  The
// cache is updated at once, so reads never see a stale timeline; unloading
// flushes the pending write synchronously so nothing is lost on quit.
let pendingTimelineSave = null; // { pid, data, timer }

export function flushTimelineSave() {
  if (!pendingTimelineSave) return;
  const { pid: savePid, data, timer } = pendingTimelineSave;
  clearTimeout(timer);
  pendingTimelineSave = null;
  send("db:saveTimeline", { pid: savePid, data });
}

if (typeof window !== "undefined")
  window.addEventListener("beforeunload", () => {
    unloading = true;
    flushTimelineSave();
  });

export function getTimeline(id) {
  const raw = cache
    ? projectData(pid(id)).timeline
    : jGet(`p${pid(id)}:timeline`, null);
  if (raw?.history) return { ...raw, history: unpackHistory(raw.history) };
  return raw;
}
export function saveTimeline(data, id) {
  const savePid = pid(id); // resolve NOW -- a project switch must not re-target it
  if (!cache) {
    jSet(`p${savePid}:timeline`, data);
    return;
  }
  if (cache.data.has(savePid)) cache.data.get(savePid).timeline = data;
  if (pendingTimelineSave && pendingTimelineSave.pid !== savePid)
    flushTimelineSave();
  if (pendingTimelineSave) clearTimeout(pendingTimelineSave.timer);
  pendingTimelineSave = {
    pid: savePid,
    data,
    timer: setTimeout(flushTimelineSave, 150),
  };
}
// The rest of a project's data: read from the cache, written through.
const field = (name, key, dflt) => ({
  get: (id) =>
    cache ? (projectData(pid(id))[name] ?? dflt()) : jGet(key(pid(id)), dflt()),
  save: (data, id) => {
    const p = pid(id);
    if (!cache) return jSet(key(p), data);
    if (cache.data.has(p)) cache.data.get(p)[name] = data;
    send(`db:save${name[0].toUpperCase()}${name.slice(1)}`, { pid: p, data });
  },
});
const variables = field(
  "variables",
  (p) => `p${p}:variables`,
  () => [],
);
const folders = field(
  "folders",
  (p) => `p${p}:folders`,
  () => [],
);
const material = field(
  "material",
  (p) => `p${p}:material`,
  () => ({ defaultMaterial: null, materialPresets: [] }),
);
export const getVariables = variables.get;
export const saveVariables = variables.save;
export const getFolders = folders.get;
export const saveFolders = folders.save;
export function getMaterial(id) {
  // The database answers null for a project that never saved one; the
  // fallback answers the empty default -- callers handle both.
  return cache ? projectData(pid(id)).material : material.get(id);
}
export const saveMaterial = material.save;
export function getCamera(id) {
  if (cache) return projectData(pid(id)).camera ?? null;
  return lsRaw(`p${pid(id)}:camera`);
}
export function saveCamera(state, id) {
  const p = pid(id);
  if (!cache) return lsSet(`p${p}:camera`, String(state));
  if (cache.data.has(p)) cache.data.get(p).camera = String(state);
  send("db:saveCamera", { pid: p, state: String(state) });
}
export function clearCamera(id) {
  const p = pid(id);
  if (!cache) return lsRemove(`p${p}:camera`);
  if (cache.data.has(p)) cache.data.get(p).camera = null;
  send("db:clearCamera", p);
}
