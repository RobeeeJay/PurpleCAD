// Unified key/value persistence facade.  In Electron it's backed by a SQLite
// database in the main process (synchronous IPC, so callers keep their
// localStorage-style synchronous semantics).  In a plain browser it falls back
// to localStorage; under node/vitest (no window, no localStorage) it uses an
// in-memory map so the store still loads and persists within a test run.

const memory = new Map();

function electronApi() {
  return typeof window !== "undefined" && window.electronAPI?.kvGet
    ? window.electronAPI
    : null;
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

export function kvGet(key) {
  const api = electronApi();
  if (api) return api.kvGet(key);
  if (hasLocalStorage()) return localStorage.getItem(key);
  return memory.has(key) ? memory.get(key) : null;
}

export function kvSet(key, value) {
  const api = electronApi();
  if (api) api.kvSet(key, String(value));
  else if (hasLocalStorage()) localStorage.setItem(key, String(value));
  else memory.set(key, String(value));
}

export function kvRemove(key) {
  const api = electronApi();
  if (api) api.kvRemove(key);
  else if (hasLocalStorage()) localStorage.removeItem(key);
  else memory.delete(key);
}

// One-time copy of any pre-existing localStorage data into SQLite, so users
// upgrading from the localStorage build don't lose their timeline/settings.
// Runs at module load (before the store's load-at-init calls) and guards itself
// with a flag in the database so it only migrates once.
const MIGRATION_KEYS = [
  "cad-timeline",
  "cad-variables",
  "cad-folders",
  "cad-material",
  "cad-snap",
  "cad-camera-state",
];

(function migrateFromLocalStorage() {
  const api = electronApi();
  if (!api || !hasLocalStorage()) return;
  if (api.kvGet("__kv_migrated__")) return;
  for (const key of MIGRATION_KEYS) {
    const v = localStorage.getItem(key);
    if (v != null && api.kvGet(key) == null) api.kvSet(key, v);
  }
  api.kvSet("__kv_migrated__", "1");
})();
