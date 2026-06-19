// SQLite-backed key/value store for the renderer's persisted data (timeline,
// variables, folders, material, snap settings, camera state).  It replaces the
// renderer's localStorage: the data now lives in a real database file under the
// app's userData directory.  Access stays synchronous (better-sqlite3 + a
// sendSync IPC bridge) so callers keep their localStorage-style semantics.

const path = require("path");

let stmts = null;

function init(userDataDir) {
  if (stmts) return;
  // Require lazily so a missing/unbuilt native module degrades to a warning in
  // main rather than crashing the whole app at load time.
  const Database = require("better-sqlite3");
  const db = new Database(path.join(userDataDir, "cad.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  stmts = {
    get: db.prepare("SELECT value FROM kv WHERE key = ?"),
    set: db.prepare(
      "INSERT INTO kv (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ),
    del: db.prepare("DELETE FROM kv WHERE key = ?"),
  };
}

const get = (key) => (stmts ? (stmts.get.get(key)?.value ?? null) : null);
const set = (key, value) => {
  if (stmts) stmts.set.run(key, String(value));
};
const remove = (key) => {
  if (stmts) stmts.del.run(key);
};

module.exports = { init, get, set, remove };
