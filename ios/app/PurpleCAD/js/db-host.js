// Runs in the database thread's JavaScriptCore context, after codec.js: the
// desktop's electron/kvStore.cjs, unchanged, over the system SQLite
// (DbHost.swift's __sqlite).  kvStore uses this much of better-sqlite3:
// prepare().run/get/all, exec, pragma and transaction -- given here with
// better-sqlite3's semantics (get gives undefined for no row; a transaction
// rolls back when its function throws).
(function (g) {
  const native = g.__sqlite;
  class Statement {
    constructor(db, sql) {
      this.h = native.prepare(db.h, sql);
    }
    run(...params) {
      return native.step(this.h, params, 0);
    }
    get(...params) {
      const row = native.step(this.h, params, 1);
      return row === null ? undefined : row;
    }
    all(...params) {
      return native.step(this.h, params, -1);
    }
  }
  class Database {
    constructor(file) {
      this.h = native.open(file);
    }
    pragma(source) {
      native.exec(this.h, `PRAGMA ${source}`);
    }
    exec(sql) {
      native.exec(this.h, sql);
      return this;
    }
    prepare(sql) {
      return new Statement(this, sql);
    }
    transaction(fn) {
      const db = this;
      return function (...args) {
        native.exec(db.h, "BEGIN");
        try {
          const result = fn.apply(this, args);
          native.exec(db.h, "COMMIT");
          return result;
        } catch (e) {
          native.exec(db.h, "ROLLBACK");
          throw e;
        }
      };
    }
  }

  const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";
  const modules = {
    path: { dirname, join: (...parts) => parts.join("/") },
    fs: { mkdirSync: (p) => native.mkdir(p) },
    "better-sqlite3": Database,
  };
  const require = (name) => {
    if (!(name in modules)) throw new Error(`db-host: cannot require ${name}`);
    return modules[name];
  };
  const module = { exports: {} };
  new Function("module", "exports", "require", "__dirname", "__filename",
               g.__kvStoreSource)(module, module.exports, require, "/db",
                                  "/db/kvStore.cjs");
  const kv = module.exports;
  kv.init(g.__dbFile);

  // The renderer's three persistence messages (electron-shim.js).
  g.__db = (method, payload) => {
    const arg = g.PurpleCodec.decode(payload);
    const result =
      method === "bootstrap" ? kv.bootstrap()
      : method === "loadProject" ? kv.projectData(arg)
      : kv.call(arg);
    return g.PurpleCodec.encode(result);
  };
})(globalThis);
