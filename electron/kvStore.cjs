// SQLite-backed persistent store for the renderer.  Normalised, multi-project
// schema: a `settings` table for global app prefs, and one row-per-element
// tables (timeline_entry / variable / folder / material_preset / camera_state)
// linked to a `projects` row.  The renderer keeps its blob-shaped in-memory data
// and this module does the row<->object (de)serialisation, so the store code is
// unchanged.  Access stays synchronous (better-sqlite3 + sendSync IPC bridge) so
// callers keep their localStorage-style semantics.

const path = require("path");

let db = null;
let stmts = null;

function init(userDataDir) {
  if (db) return;
  // Require lazily so a missing/unbuilt native module degrades to a warning in
  // main rather than crashing the whole app at load time.
  const Database = require("better-sqlite3");
  db = new Database(path.join(userDataDir, "cad.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      thumbnail TEXT,
      active_history_id INTEGER,
      default_material TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline_entry (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      entry_id INTEGER,
      entry TEXT NOT NULL,
      PRIMARY KEY (project_id, seq)
    );
    CREATE TABLE IF NOT EXISTS variable (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      name TEXT,
      value TEXT NOT NULL,
      PRIMARY KEY (project_id, seq)
    );
    CREATE TABLE IF NOT EXISTS folder (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      folder_id TEXT,
      name TEXT,
      data TEXT NOT NULL,
      PRIMARY KEY (project_id, seq)
    );
    CREATE TABLE IF NOT EXISTS material_preset (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (project_id, seq)
    );
    CREATE TABLE IF NOT EXISTS camera_state (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      state TEXT NOT NULL
    );
  `);

  stmts = {
    settingGet: db.prepare("SELECT value FROM settings WHERE key = ?"),
    settingSet: db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ),
    settingDel: db.prepare("DELETE FROM settings WHERE key = ?"),

    projList: db.prepare(
      "SELECT id, name, thumbnail, updated_at AS updatedAt, created_at AS createdAt " +
        "FROM projects ORDER BY updated_at DESC, id DESC",
    ),
    projInsert: db.prepare(
      "INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)",
    ),
    projRename: db.prepare("UPDATE projects SET name = ? WHERE id = ?"),
    projDelete: db.prepare("DELETE FROM projects WHERE id = ?"),
    projThumb: db.prepare("UPDATE projects SET thumbnail = ? WHERE id = ?"),
    projTouch: db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?"),
    projActiveHist: db.prepare(
      "SELECT active_history_id AS v FROM projects WHERE id = ?",
    ),
    projSetActiveHist: db.prepare(
      "UPDATE projects SET active_history_id = ? WHERE id = ?",
    ),
    projDefaultMat: db.prepare(
      "SELECT default_material AS v FROM projects WHERE id = ?",
    ),
    projSetDefaultMat: db.prepare(
      "UPDATE projects SET default_material = ? WHERE id = ?",
    ),

    tlSelect: db.prepare(
      "SELECT entry FROM timeline_entry WHERE project_id = ? ORDER BY seq",
    ),
    tlDelete: db.prepare("DELETE FROM timeline_entry WHERE project_id = ?"),
    tlInsert: db.prepare(
      "INSERT INTO timeline_entry (project_id, seq, entry_id, entry) VALUES (?, ?, ?, ?)",
    ),

    varSelect: db.prepare(
      "SELECT value FROM variable WHERE project_id = ? ORDER BY seq",
    ),
    varDelete: db.prepare("DELETE FROM variable WHERE project_id = ?"),
    varInsert: db.prepare(
      "INSERT INTO variable (project_id, seq, name, value) VALUES (?, ?, ?, ?)",
    ),

    folSelect: db.prepare(
      "SELECT data FROM folder WHERE project_id = ? ORDER BY seq",
    ),
    folDelete: db.prepare("DELETE FROM folder WHERE project_id = ?"),
    folInsert: db.prepare(
      "INSERT INTO folder (project_id, seq, folder_id, name, data) VALUES (?, ?, ?, ?, ?)",
    ),

    matSelect: db.prepare(
      "SELECT data FROM material_preset WHERE project_id = ? ORDER BY seq",
    ),
    matDelete: db.prepare("DELETE FROM material_preset WHERE project_id = ?"),
    matInsert: db.prepare(
      "INSERT INTO material_preset (project_id, seq, data) VALUES (?, ?, ?)",
    ),

    camGet: db.prepare("SELECT state FROM camera_state WHERE project_id = ?"),
    camSet: db.prepare(
      "INSERT INTO camera_state (project_id, state) VALUES (?, ?) " +
        "ON CONFLICT(project_id) DO UPDATE SET state = excluded.state",
    ),
    camDel: db.prepare("DELETE FROM camera_state WHERE project_id = ?"),
  };

  migrateLegacy();
  ensureActiveProject();
}

// ── Settings ────────────────────────────────────────────────────────────────
const settingGet = (key) =>
  stmts ? (stmts.settingGet.get(key)?.value ?? null) : null;
const settingSet = (key, value) => {
  if (stmts) stmts.settingSet.run(key, String(value));
};
const settingRemove = (key) => {
  if (stmts) stmts.settingDel.run(key);
};

// ── Projects ────────────────────────────────────────────────────────────────
const now = () => Date.now();
const touch = (pid) => stmts.projTouch.run(now(), pid);

function listProjects() {
  return stmts ? stmts.projList.all() : [];
}

function createProject(name) {
  if (!stmts) return null;
  const t = now();
  const id = Number(
    stmts.projInsert.run(name || "Untitled", t, t).lastInsertRowid,
  );
  // Seed an empty timeline so a fresh project opens with a valid scene.
  saveTimeline(id, {
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
  });
  return id;
}

function renameProject(id, name) {
  if (stmts) stmts.projRename.run(name, id);
}
function deleteProject(id) {
  if (stmts) stmts.projDelete.run(id);
}
function setThumbnail(id, dataUrl) {
  if (stmts) stmts.projThumb.run(dataUrl ?? null, id);
}

const getActiveProjectId = () => {
  const v = settingGet("active_project_id");
  return v == null ? null : Number(v);
};
const setActiveProjectId = (id) => settingSet("active_project_id", String(id));

// Guarantee at least one project + a valid active id (called after migration).
function ensureActiveProject() {
  if (!stmts) return;
  const rows = stmts.projList.all();
  if (rows.length === 0) {
    setActiveProjectId(createProject("Untitled"));
    return;
  }
  const active = getActiveProjectId();
  if (active == null || !rows.some((r) => r.id === active))
    setActiveProjectId(rows[0].id);
}

// ── Per-project data ────────────────────────────────────────────────────────
function getTimeline(pid) {
  if (!stmts) return null;
  const rows = stmts.tlSelect.all(pid);
  if (rows.length === 0) return null;
  return {
    history: rows.map((r) => JSON.parse(r.entry)),
    activeHistoryId: stmts.projActiveHist.get(pid)?.v ?? null,
  };
}

function saveTimeline(pid, { history, activeHistoryId }) {
  if (!stmts) return;
  db.transaction(() => {
    stmts.tlDelete.run(pid);
    (history || []).forEach((entry, seq) =>
      stmts.tlInsert.run(pid, seq, entry?.id ?? null, JSON.stringify(entry)),
    );
    stmts.projSetActiveHist.run(activeHistoryId ?? null, pid);
    touch(pid);
  })();
}

function getVariables(pid) {
  if (!stmts) return [];
  return stmts.varSelect.all(pid).map((r) => JSON.parse(r.value));
}
function saveVariables(pid, variables) {
  if (!stmts) return;
  db.transaction(() => {
    stmts.varDelete.run(pid);
    (variables || []).forEach((v, seq) =>
      stmts.varInsert.run(pid, seq, v?.name ?? null, JSON.stringify(v)),
    );
    touch(pid);
  })();
}

function getFolders(pid) {
  if (!stmts) return [];
  return stmts.folSelect.all(pid).map((r) => JSON.parse(r.data));
}
function saveFolders(pid, folders) {
  if (!stmts) return;
  db.transaction(() => {
    stmts.folDelete.run(pid);
    (folders || []).forEach((f, seq) =>
      stmts.folInsert.run(
        pid,
        seq,
        f?.id != null ? String(f.id) : null,
        f?.name ?? null,
        JSON.stringify(f),
      ),
    );
    touch(pid);
  })();
}

function getMaterial(pid) {
  if (!stmts) return { defaultMaterial: null, materialPresets: [] };
  const dm = stmts.projDefaultMat.get(pid)?.v ?? null;
  return {
    defaultMaterial: dm ? JSON.parse(dm) : null,
    materialPresets: stmts.matSelect.all(pid).map((r) => JSON.parse(r.data)),
  };
}
function saveMaterial(pid, { defaultMaterial, materialPresets }) {
  if (!stmts) return;
  db.transaction(() => {
    stmts.projSetDefaultMat.run(
      defaultMaterial ? JSON.stringify(defaultMaterial) : null,
      pid,
    );
    stmts.matDelete.run(pid);
    (materialPresets || []).forEach((p, seq) =>
      stmts.matInsert.run(pid, seq, JSON.stringify(p)),
    );
    touch(pid);
  })();
}

function getCamera(pid) {
  return stmts ? (stmts.camGet.get(pid)?.state ?? null) : null;
}
function saveCamera(pid, state) {
  if (stmts) stmts.camSet.run(pid, String(state));
}
function clearCamera(pid) {
  if (stmts) stmts.camDel.run(pid);
}

// ── One-time migration from the legacy kv(key,value) blob table ──────────────
function migrateLegacy() {
  if (!stmts || settingGet("__kv_migrated__")) return;
  const hasKv = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kv'")
    .get();
  const kvGet = hasKv
    ? (k) =>
        db.prepare("SELECT value FROM kv WHERE key = ?").get(k)?.value ?? null
    : () => null;

  const pid = createProject("Untitled");
  setActiveProjectId(pid);

  const snap = kvGet("cad-snap");
  if (snap != null) settingSet("snap", snap);

  const timeline = safeParse(kvGet("cad-timeline"));
  if (timeline && Array.isArray(timeline.history) && timeline.history.length > 0)
    saveTimeline(pid, {
      history: timeline.history,
      activeHistoryId: timeline.activeHistoryId ?? null,
    });

  const vars = safeParse(kvGet("cad-variables"));
  if (Array.isArray(vars)) saveVariables(pid, vars);

  const folders = safeParse(kvGet("cad-folders"));
  if (Array.isArray(folders)) saveFolders(pid, folders);

  const material = safeParse(kvGet("cad-material"));
  if (material)
    saveMaterial(pid, {
      defaultMaterial: material.defaultMaterial ?? null,
      materialPresets: Array.isArray(material.materialPresets)
        ? material.materialPresets
        : [],
    });

  const cam = kvGet("cad-camera-state");
  if (cam != null) saveCamera(pid, cam);

  settingSet("__kv_migrated__", "1");
}

function safeParse(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  init,
  settingGet,
  settingSet,
  settingRemove,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  setThumbnail,
  getActiveProjectId,
  setActiveProjectId,
  getTimeline,
  saveTimeline,
  getVariables,
  saveVariables,
  getFolders,
  saveFolders,
  getMaterial,
  saveMaterial,
  getCamera,
  saveCamera,
  clearCamera,
};
